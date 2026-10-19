export interface Session {
  sessionId: string;
  shortId: string;
  name: string;
  cwd: string;
  /** Process activity from the CLI: busy / idle / waiting / … (null when the process is not running). */
  status: string | null;
  /** Task state from the CLI (background sessions): working / blocked / done / failed / stopped / … */
  state: string | null;
  /** What the session is waiting for, e.g. "input needed". */
  waitingFor: string | null;
  kind: string;
  pid: number | null;
  startedAt: number | null;
}

export interface Column {
  id: string;
  title: string;
  cardIds: string[];
  collapsed: boolean;
}

export interface Draft {
  title: string;
  prompt: string;
  cwd: string;
}

export interface Board {
  version: 1;
  /** Always starts with the inbox column and ends with the done column. */
  columns: Column[];
  drafts: Record<string, Draft>;
  /** cardId → ms timestamp of a session this board just started; shared by all windows via board.json. */
  starting: Record<string, number>;
}

export type Tone = 'running' | 'waiting' | 'idle' | 'review' | 'failed' | 'stopped' | 'unknown';

export interface ViewCard {
  id: string;
  type: 'session' | 'draft';
  title: string;
  cwd: string;
  folder: string;
  badge: { label: string; tone: Tone } | null;
  /** Extra line under the title, e.g. what the session is waiting for. */
  detail: string | null;
  interactive: boolean;
  startedAt: number | null;
  /** Session process is running and can be stopped. */
  canStop: boolean;
  /** Background session whose process is not running (stopped, shut down) and can be respawned. */
  canResume: boolean;
  prompt?: string;
}

export interface ViewColumn {
  id: string;
  title: string;
  /** Built-in columns (Inbox, Done) cannot be renamed or deleted. */
  builtIn: boolean;
  collapsed: boolean;
  waitingCount: number;
  cards: ViewCard[];
}

export interface View {
  columns: ViewColumn[];
  waitingCount: number;
}

export type ToHost =
  | { type: 'ready' }
  | { type: 'move'; cardId: string; toColumnId: string; index: number }
  | { type: 'attach' | 'stop' | 'complete' | 'resume'; cardId: string }
  | { type: 'toggleColumn'; columnId: string }
  | { type: 'addColumn'; title: string }
  | { type: 'renameColumn'; columnId: string; title: string }
  | { type: 'deleteColumn'; columnId: string }
  | { type: 'createDraft'; title: string; prompt: string; cwd: string }
  | { type: 'startDraft' | 'deleteDraft'; draftId: string }
  | { type: 'pickCwd' };

export type ToWebview =
  | { type: 'state'; view: View; error: string | null; defaultCwd: string }
  | { type: 'cwdPicked'; cwd: string };
