import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { DONE_ID, DONE_TITLE, INBOX_ID, INBOX_TITLE, defaultBoard } from './boardModel';
import type { Board, Column, Draft } from './types';

const WATCH_DEBOUNCE_MS = 100;

function isDraft(x: unknown): x is Draft {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Record<string, unknown>;
  return typeof d.title === 'string' && typeof d.prompt === 'string' && typeof d.cwd === 'string';
}

export function normalizeBoard(raw: unknown): Board | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;

  const drafts: Record<string, Draft> = {};
  if (typeof r.drafts === 'object' && r.drafts !== null) {
    for (const [id, d] of Object.entries(r.drafts as Record<string, unknown>)) {
      if (isDraft(d)) drafts[id] = { title: d.title, prompt: d.prompt, cwd: d.cwd };
    }
  }

  const seenCards = new Set<string>();
  const validCard = (id: unknown): id is string => {
    if (typeof id !== 'string' || seenCards.has(id)) return false;
    const ok = id.startsWith('s:') ? id.length > 2 : id.startsWith('d:') ? id.slice(2) in drafts : false;
    if (ok) seenCards.add(id);
    return ok;
  };

  const seenColumns = new Set<string>();
  let inbox: Column | null = null;
  let done: Column | null = null;
  const others: Column[] = [];
  for (const c of Array.isArray(r.columns) ? r.columns : []) {
    if (typeof c !== 'object' || c === null) continue;
    const col = c as Record<string, unknown>;
    if (typeof col.id !== 'string' || typeof col.title !== 'string' || seenColumns.has(col.id)) continue;
    seenColumns.add(col.id);
    const cardIds = (Array.isArray(col.cardIds) ? col.cardIds : []).filter(validCard);
    const collapsed = typeof col.collapsed === 'boolean' ? col.collapsed : col.id === DONE_ID;
    if (col.id === INBOX_ID) inbox = { id: INBOX_ID, title: INBOX_TITLE, cardIds, collapsed };
    else if (col.id === DONE_ID) done = { id: DONE_ID, title: DONE_TITLE, cardIds, collapsed };
    else others.push({ id: col.id, title: col.title, cardIds, collapsed });
  }
  done ??= { id: DONE_ID, title: DONE_TITLE, cardIds: [], collapsed: true };

  // Version-1 boards before the done column had a "hidden" list; those cards now live in done.
  const formerlyHidden = (Array.isArray(r.hidden) ? r.hidden : []).filter(
    (id): id is string => typeof id === 'string' && id.startsWith('s:') && validCard(id),
  );
  if (formerlyHidden.length > 0) done = { ...done, cardIds: [...done.cardIds, ...formerlyHidden] };

  const starting: Record<string, number> = {};
  if (typeof r.starting === 'object' && r.starting !== null) {
    for (const [id, at] of Object.entries(r.starting as Record<string, unknown>)) {
      if (id.startsWith('s:') && typeof at === 'number' && Number.isFinite(at)) starting[id] = at;
    }
  }

  return {
    version: 1,
    columns: [inbox ?? { id: INBOX_ID, title: INBOX_TITLE, cardIds: [], collapsed: false }, ...others, done],
    drafts,
    starting,
  };
}

export class BoardStore {
  private lastJson: string | null = null;

  constructor(private readonly filePath: string) {}

  load(): { board: Board; recovered: boolean } {
    if (!existsSync(this.filePath)) return { board: defaultBoard(), recovered: false };
    const text = readFileSync(this.filePath, 'utf8');
    let board: Board | null = null;
    try {
      board = normalizeBoard(JSON.parse(text));
    } catch {
      board = null;
    }
    if (board) {
      this.lastJson = text;
      return { board, recovered: false };
    }
    renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    return { board: defaultBoard(), recovered: true };
  }

  save(board: Board): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const json = JSON.stringify(board, null, 2);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, json);
    renameSync(tmp, this.filePath);
    this.lastJson = json;
  }

  watch(onExternalChange: (b: Board) => void): { dispose(): void } {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const name = basename(this.filePath);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = watch(dir, (_event, filename) => {
      if (filename !== name) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!existsSync(this.filePath)) return;
        const text = readFileSync(this.filePath, 'utf8');
        if (text === this.lastJson) return;
        try {
          const board = normalizeBoard(JSON.parse(text));
          if (!board) return;
          this.lastJson = text;
          onExternalChange(board);
        } catch {
          // A partially written file from another window; the next event will carry the full write.
        }
      }, WATCH_DEBOUNCE_MS);
    });
    return {
      dispose: () => {
        clearTimeout(timer);
        watcher.close();
      },
    };
  }
}
