import type { Board, Column, Draft, Session, Tone, View, ViewCard } from './types';

export const INBOX_ID = 'inbox';
export const DONE_ID = 'done';
export const INBOX_TITLE = 'Inbox';
export const DONE_TITLE = 'Done';

export function defaultBoard(): Board {
  return {
    version: 1,
    columns: [
      { id: INBOX_ID, title: INBOX_TITLE, cardIds: [], collapsed: false },
      { id: DONE_ID, title: DONE_TITLE, cardIds: [], collapsed: true },
    ],
    drafts: {},
    starting: {},
  };
}

export function sessionCardId(shortId: string): string {
  return `s:${shortId}`;
}

const draftCardId = (draftId: string) => `d:${draftId}`;
const isSessionCard = (cardId: string) => cardId.startsWith('s:');
const isBuiltIn = (columnId: string) => columnId === INBOX_ID || columnId === DONE_ID;

/**
 * `status` is process activity (busy / idle / waiting, null when no process runs);
 * `state` is the task state background sessions report (working / blocked / done / failed / stopped).
 * A session that ends its turn with a question is `idle` + `blocked`, so `state` decides first.
 */
export function sessionBadge(s: Session, justStarted: boolean): { label: string; tone: Tone } {
  if (s.status === 'waiting') return { label: 'Needs input', tone: 'waiting' };
  if (s.state === 'blocked') return { label: 'Waiting for you', tone: 'waiting' };
  if (s.status === null && justStarted) return { label: 'Starting', tone: 'running' };
  if (s.state === 'working' || (s.state === null && (s.status === 'busy' || s.status === 'working'))) {
    return { label: 'Running', tone: 'running' };
  }
  if (s.state === 'done' || (s.state === null && s.status === 'done')) return { label: 'Ready for review', tone: 'review' };
  if (s.state === 'failed') return { label: 'Interrupted', tone: 'failed' };
  if (s.state === 'stopped' || (s.state === null && s.status === null)) return { label: 'Stopped', tone: 'stopped' };
  if (s.state === null && s.status === 'idle') return { label: 'Idle', tone: 'idle' };
  return { label: s.state ?? s.status ?? 'Unknown', tone: 'unknown' };
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

export function reconcile(board: Board, sessions: Session[], opts: { pruneMissing: boolean; startedAfter: number }): Board {
  const live = new Set(sessions.map((s) => sessionCardId(s.shortId)));
  let changed = false;

  let columns = board.columns;
  let starting = board.starting;
  if (opts.pruneMissing) {
    const reported = new Set(sessions.filter((s) => s.status !== null).map((s) => sessionCardId(s.shortId)));
    const keptStarting = Object.fromEntries(
      Object.entries(starting).filter(([id, at]) => at >= opts.startedAfter && !reported.has(id)),
    );
    if (Object.keys(keptStarting).length !== Object.keys(starting).length) {
      changed = true;
      starting = keptStarting;
    }
    columns = columns.map((c) => {
      const kept = c.cardIds.filter((id) => !isSessionCard(id) || live.has(id) || id in starting);
      if (kept.length === c.cardIds.length) return c;
      changed = true;
      return { ...c, cardIds: kept };
    });
  }

  const placed = new Set(columns.flatMap((c) => c.cardIds));
  const unseen = sessions.map((s) => sessionCardId(s.shortId)).filter((id) => !placed.has(id));
  if (unseen.length > 0) {
    changed = true;
    columns = columns.map((c) => (c.id === INBOX_ID ? { ...c, cardIds: [...c.cardIds, ...unseen] } : c));
  }

  return changed ? { ...board, columns, starting } : board;
}

function sessionCard(id: string, s: Session, justStarted: boolean): ViewCard {
  const background = s.kind !== 'interactive';
  return {
    id,
    type: 'session',
    title: s.name,
    cwd: s.cwd,
    folder: folderOf(s.cwd),
    badge: sessionBadge(s, justStarted),
    detail: s.waitingFor,
    interactive: !background,
    startedAt: s.startedAt,
    canStop: background && s.status !== null,
    canResume: background && s.status === null && !justStarted,
  };
}

function draftCard(id: string, d: Draft): ViewCard {
  return {
    id,
    type: 'draft',
    title: d.title,
    cwd: d.cwd,
    folder: folderOf(d.cwd),
    badge: null,
    detail: null,
    interactive: false,
    startedAt: null,
    canStop: false,
    canResume: false,
    prompt: d.prompt,
  };
}

export function buildView(board: Board, sessions: Session[]): View {
  const byCard = new Map(sessions.map((s) => [sessionCardId(s.shortId), s]));
  let waitingCount = 0;
  const columns = board.columns.map((c) => {
    const cards: ViewCard[] = [];
    for (const id of c.cardIds) {
      const s = byCard.get(id);
      const draft = id.startsWith('d:') ? board.drafts[id.slice(2)] : undefined;
      if (s) cards.push(sessionCard(id, s, id in board.starting));
      else if (draft) cards.push(draftCard(id, draft));
    }
    const columnWaiting = cards.filter((x) => x.badge?.tone === 'waiting').length;
    waitingCount += columnWaiting;
    return { id: c.id, title: c.title, builtIn: isBuiltIn(c.id), collapsed: c.collapsed, waitingCount: columnWaiting, cards };
  });
  return { columns, waitingCount };
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

export function completeCard(b: Board, cardId: string): Board {
  return moveCard(b, cardId, DONE_ID, 0);
}

export function addColumn(b: Board, id: string, title: string): Board {
  const t = title.trim();
  if (!t || b.columns.some((c) => c.id === id)) return b;
  const doneAt = b.columns.findIndex((c) => c.id === DONE_ID);
  const at = doneAt === -1 ? b.columns.length : doneAt;
  return withColumns(b, [...b.columns.slice(0, at), { id, title: t, cardIds: [], collapsed: false }, ...b.columns.slice(at)]);
}

export function renameColumn(b: Board, columnId: string, title: string): Board {
  const t = title.trim();
  if (!t || isBuiltIn(columnId) || !b.columns.some((c) => c.id === columnId)) return b;
  return withColumns(b, b.columns.map((c) => (c.id === columnId ? { ...c, title: t } : c)));
}

export function deleteColumn(b: Board, columnId: string): Board {
  const doomed = b.columns.find((c) => c.id === columnId);
  if (!doomed || isBuiltIn(columnId)) return b;
  const columns = b.columns
    .filter((c) => c.id !== columnId)
    .map((c) => (c.id === INBOX_ID ? { ...c, cardIds: [...c.cardIds, ...doomed.cardIds] } : c));
  return withColumns(b, columns);
}

export function toggleColumn(b: Board, columnId: string): Board {
  if (!b.columns.some((c) => c.id === columnId)) return b;
  return withColumns(b, b.columns.map((c) => (c.id === columnId ? { ...c, collapsed: !c.collapsed } : c)));
}

export function createDraft(b: Board, draftId: string, d: Draft): Board {
  const columns = b.columns.map((c) => (c.id === INBOX_ID ? { ...c, cardIds: [draftCardId(draftId), ...c.cardIds] } : c));
  return { ...b, columns, drafts: { ...b.drafts, [draftId]: d } };
}

export function deleteDraft(b: Board, draftId: string): Board {
  const { [draftId]: _removed, ...drafts } = b.drafts;
  return { ...b, columns: removeCardEverywhere(b.columns, draftCardId(draftId)), drafts };
}

export function markStarting(b: Board, cardId: string, at: number): Board {
  return { ...b, starting: { ...b.starting, [cardId]: at } };
}

export function promoteDraft(b: Board, draftId: string, shortId: string, startedAt: number): Board {
  const from = draftCardId(draftId);
  const to = sessionCardId(shortId);
  const columns = removeCardEverywhere(b.columns, to).map((c) =>
    c.cardIds.includes(from) ? { ...c, cardIds: c.cardIds.map((id) => (id === from ? to : id)) } : c,
  );
  const { [draftId]: _removed, ...drafts } = b.drafts;
  return { ...b, columns, drafts, starting: { ...b.starting, [to]: startedAt } };
}
