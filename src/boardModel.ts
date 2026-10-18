import type { Board, Column, Draft, Session, Tone, View, ViewCard } from './types';

export const INBOX_ID = 'inbox';
const INBOX_TITLE = '未归类';

export function defaultBoard(): Board {
  return { version: 1, columns: [{ id: INBOX_ID, title: INBOX_TITLE, cardIds: [] }], drafts: {}, hidden: [] };
}

export function sessionCardId(shortId: string): string {
  return `s:${shortId}`;
}

const draftCardId = (draftId: string) => `d:${draftId}`;
const isSessionCard = (cardId: string) => cardId.startsWith('s:');

export function statusBadge(status: string | null): { label: string; tone: Tone } {
  switch (status) {
    case 'working':
    case 'busy':
      return { label: '运行中', tone: 'running' };
    case 'waiting':
      return { label: '等待输入', tone: 'waiting' };
    case 'idle':
      return { label: '空闲', tone: 'idle' };
    case 'done':
      return { label: '完成', tone: 'done' };
    case null:
      return { label: '已停止', tone: 'stopped' };
    default:
      return { label: status, tone: 'unknown' };
  }
}

function folderOf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts.at(-1) ?? cwd;
}

function withColumns(b: Board, columns: Column[]): Board {
  return { ...b, columns };
}

function removeCardEverywhere(columns: Column[], cardId: string): Column[] {
  return columns.map((c) => (c.cardIds.includes(cardId) ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) } : c));
}

export function reconcile(
  board: Board,
  sessions: Session[],
  opts: { pruneMissing: boolean; keep: Set<string> },
): Board {
  const live = new Set(sessions.map((s) => sessionCardId(s.shortId)));
  let changed = false;

  let columns = board.columns;
  let hidden = board.hidden;
  if (opts.pruneMissing) {
    columns = columns.map((c) => {
      const kept = c.cardIds.filter((id) => !isSessionCard(id) || live.has(id) || opts.keep.has(id));
      if (kept.length === c.cardIds.length) return c;
      changed = true;
      return { ...c, cardIds: kept };
    });
    const keptHidden = hidden.filter((id) => live.has(id));
    if (keptHidden.length !== hidden.length) {
      changed = true;
      hidden = keptHidden;
    }
  }

  const placed = new Set(columns.flatMap((c) => c.cardIds));
  const hiddenSet = new Set(hidden);
  const unseen = sessions
    .map((s) => sessionCardId(s.shortId))
    .filter((id) => !placed.has(id) && !hiddenSet.has(id));
  if (unseen.length > 0) {
    changed = true;
    columns = columns.map((c) => (c.id === INBOX_ID ? { ...c, cardIds: [...c.cardIds, ...unseen] } : c));
  }

  return changed ? { ...board, columns, hidden } : board;
}

export function buildView(board: Board, sessions: Session[], justStarted: Set<string> = new Set()): View {
  const byCard = new Map(sessions.map((s) => [sessionCardId(s.shortId), s]));
  const columns = board.columns.map((c) => {
    const cards: ViewCard[] = [];
    for (const id of c.cardIds) {
      const s = byCard.get(id);
      if (s) {
        cards.push({
          id,
          type: 'session',
          title: s.name,
          cwd: s.cwd,
          folder: folderOf(s.cwd),
          badge: s.status === null && justStarted.has(id) ? { label: '启动中', tone: 'running' } : statusBadge(s.status),
          interactive: s.kind === 'interactive',
          startedAt: s.startedAt,
        });
        continue;
      }
      const draft = id.startsWith('d:') ? board.drafts[id.slice(2)] : undefined;
      if (draft) {
        cards.push({
          id,
          type: 'draft',
          title: draft.title,
          cwd: draft.cwd,
          folder: folderOf(draft.cwd),
          badge: null,
          interactive: false,
          startedAt: null,
          prompt: draft.prompt,
        });
      }
    }
    return { id: c.id, title: c.title, removable: c.id !== INBOX_ID, cards };
  });
  return { columns, waitingCount: sessions.filter((s) => s.status === 'waiting').length };
}

export function moveCard(b: Board, cardId: string, toColumnId: string, index: number): Board {
  if (!b.columns.some((c) => c.id === toColumnId)) return b;
  if (!b.columns.some((c) => c.cardIds.includes(cardId))) return b;
  const columns = removeCardEverywhere(b.columns, cardId).map((c) => {
    if (c.id !== toColumnId) return c;
    const at = Math.max(0, Math.min(index, c.cardIds.length));
    return { ...c, cardIds: [...c.cardIds.slice(0, at), cardId, ...c.cardIds.slice(at)] };
  });
  return withColumns(b, columns);
}

export function addColumn(b: Board, id: string, title: string): Board {
  const t = title.trim();
  if (!t || b.columns.some((c) => c.id === id)) return b;
  return withColumns(b, [...b.columns, { id, title: t, cardIds: [] }]);
}

export function renameColumn(b: Board, columnId: string, title: string): Board {
  const t = title.trim();
  if (!t || columnId === INBOX_ID || !b.columns.some((c) => c.id === columnId)) return b;
  return withColumns(b, b.columns.map((c) => (c.id === columnId ? { ...c, title: t } : c)));
}

export function deleteColumn(b: Board, columnId: string): Board {
  const doomed = b.columns.find((c) => c.id === columnId);
  if (!doomed || columnId === INBOX_ID) return b;
  const columns = b.columns
    .filter((c) => c.id !== columnId)
    .map((c) => (c.id === INBOX_ID ? { ...c, cardIds: [...c.cardIds, ...doomed.cardIds] } : c));
  return withColumns(b, columns);
}

export function createDraft(b: Board, draftId: string, d: Draft): Board {
  const columns = b.columns.map((c) => (c.id === INBOX_ID ? { ...c, cardIds: [draftCardId(draftId), ...c.cardIds] } : c));
  return { ...b, columns, drafts: { ...b.drafts, [draftId]: d } };
}

export function deleteDraft(b: Board, draftId: string): Board {
  const { [draftId]: _removed, ...drafts } = b.drafts;
  return { ...b, columns: removeCardEverywhere(b.columns, draftCardId(draftId)), drafts };
}

export function promoteDraft(b: Board, draftId: string, shortId: string): Board {
  const from = draftCardId(draftId);
  const to = sessionCardId(shortId);
  const columns = removeCardEverywhere(b.columns, to).map((c) =>
    c.cardIds.includes(from) ? { ...c, cardIds: c.cardIds.map((id) => (id === from ? to : id)) } : c,
  );
  const { [draftId]: _removed, ...drafts } = b.drafts;
  return { ...b, columns, drafts };
}

export function hideCard(b: Board, cardId: string): Board {
  if (cardId.startsWith('d:')) return deleteDraft(b, cardId.slice(2));
  return {
    ...b,
    columns: removeCardEverywhere(b.columns, cardId),
    hidden: b.hidden.includes(cardId) ? b.hidden : [...b.hidden, cardId],
  };
}
