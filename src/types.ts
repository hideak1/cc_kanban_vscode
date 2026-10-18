export interface Session {
  sessionId: string;
  shortId: string;
  name: string;
  cwd: string;
  status: string | null;
  kind: string;
  pid: number | null;
  startedAt: number | null;
}

export interface Column {
  id: string;
  title: string;
  cardIds: string[];
}

export interface Draft {
  title: string;
  prompt: string;
  cwd: string;
}

export interface Board {
  version: 1;
  columns: Column[];
  drafts: Record<string, Draft>;
  hidden: string[];
  /** cardId → ms timestamp of a session this board just started; shared by all windows via board.json. */
  starting: Record<string, number>;
}

export type Tone = 'running' | 'waiting' | 'idle' | 'done' | 'stopped' | 'unknown';

export interface ViewCard {
  id: string;
  type: 'session' | 'draft';
  title: string;
  cwd: string;
  folder: string;
  badge: { label: string; tone: Tone } | null;
  interactive: boolean;
  startedAt: number | null;
  prompt?: string;
}

export interface ViewColumn {
  id: string;
  title: string;
  removable: boolean;
  cards: ViewCard[];
}

export interface View {
  columns: ViewColumn[];
  waitingCount: number;
}

export type ToHost =
  | { type: 'ready' }
  | { type: 'move'; cardId: string; toColumnId: string; index: number }
  | { type: 'attach' | 'stop' | 'hide'; cardId: string }
  | { type: 'addColumn'; title: string }
  | { type: 'renameColumn'; columnId: string; title: string }
  | { type: 'deleteColumn'; columnId: string }
  | { type: 'createDraft'; title: string; prompt: string; cwd: string }
  | { type: 'startDraft' | 'deleteDraft'; draftId: string }
  | { type: 'pickCwd' };

export type ToWebview =
  | { type: 'state'; view: View; error: string | null; defaultCwd: string }
  | { type: 'cwdPicked'; cwd: string };
