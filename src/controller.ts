import {
  addColumn,
  buildView,
  createDraft,
  deleteColumn,
  deleteDraft,
  hideCard,
  moveCard,
  promoteDraft,
  reconcile,
  renameColumn,
  sessionCardId,
} from './boardModel';
import type { BoardStore } from './boardStore';
import type { CliClient } from './cliClient';
import type { Board, Session, ToHost, ToWebview } from './types';

const START_GRACE_MS = 60_000;
const NO_CLI_ERROR = '找不到 claude 命令，请在设置 claudeKanban.claudePath 中指定路径';

export interface Ui {
  attach(shortId: string, name: string, cwd: string): void;
  pickFolder(): Promise<string | null>;
  confirm(message: string): Promise<boolean>;
  showError(message: string): void;
  showInfo(message: string): void;
}

type Cli = Pick<CliClient, 'listSessions' | 'startSession' | 'stopSession'>;

export interface ControllerDeps {
  cli: Cli | null;
  store: Pick<BoardStore, 'load' | 'save'>;
  ui: Ui;
  post: (m: ToWebview) => void;
  defaultCwd: () => string;
  newId: () => string;
  now: () => number;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Controller {
  private board: Board;
  private sessions: Session[] = [];
  private error: string | null = null;
  private cli: Cli | null;
  private readonly justStarted = new Map<string, number>();
  private readonly starting = new Set<string>();

  constructor(private readonly d: ControllerDeps) {
    this.cli = d.cli;
    const { board, recovered } = d.store.load();
    this.board = board;
    if (recovered) d.ui.showInfo('看板数据文件损坏，已备份并重置为空看板');
  }

  get waitingCount(): number {
    return this.sessions.filter((s) => s.status === 'waiting').length;
  }

  setCli(cli: Cli | null): void {
    this.cli = cli;
  }

  setBoard(b: Board): void {
    this.board = b;
    this.post();
  }

  async refresh(): Promise<void> {
    if (!this.cli) {
      this.error = NO_CLI_ERROR;
      this.post();
      return;
    }
    let pruneMissing = true;
    try {
      this.sessions = await this.cli.listSessions();
      this.error = null;
    } catch (e) {
      this.error = `状态可能过期：${messageOf(e)}`;
      pruneMissing = false;
    }
    const cutoff = this.d.now() - START_GRACE_MS;
    for (const [id, at] of this.justStarted) if (at < cutoff) this.justStarted.delete(id);
    this.commit(reconcile(this.board, this.sessions, { pruneMissing, keep: new Set(this.justStarted.keys()) }), false);
    this.post();
  }

  async handle(msg: ToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.post();
        return;
      case 'move':
        this.commit(moveCard(this.board, msg.cardId, msg.toColumnId, msg.index));
        return;
      case 'attach': {
        const s = this.sessionFor(msg.cardId);
        if (!s) return;
        if (s.kind === 'interactive') this.d.ui.showInfo('这个 session 在别的终端里直接运行，无法 attach');
        else this.d.ui.attach(s.shortId, s.name, s.cwd);
        return;
      }
      case 'stop': {
        const s = this.sessionFor(msg.cardId);
        if (!s || !this.cli) return;
        try {
          await this.cli.stopSession(s.shortId);
        } catch (e) {
          this.d.ui.showError(`停止失败：${messageOf(e)}`);
        }
        await this.refresh();
        return;
      }
      case 'hide':
        this.commit(hideCard(this.board, msg.cardId));
        return;
      case 'addColumn':
        this.commit(addColumn(this.board, `c-${this.d.newId()}`, msg.title));
        return;
      case 'renameColumn':
        this.commit(renameColumn(this.board, msg.columnId, msg.title));
        return;
      case 'deleteColumn': {
        const col = this.board.columns.find((c) => c.id === msg.columnId);
        if (!col) return;
        if (col.cardIds.length > 0) {
          const ok = await this.d.ui.confirm(`删除列「${col.title}」？其中 ${col.cardIds.length} 张卡片会移回未归类。`);
          if (!ok) return;
        }
        this.commit(deleteColumn(this.board, msg.columnId));
        return;
      }
      case 'createDraft': {
        const title = msg.title.trim();
        if (!title) return;
        const cwd = msg.cwd.trim() || this.d.defaultCwd();
        this.commit(createDraft(this.board, this.d.newId(), { title, prompt: msg.prompt, cwd }));
        return;
      }
      case 'startDraft':
        await this.startDraft(msg.draftId);
        return;
      case 'deleteDraft':
        this.commit(deleteDraft(this.board, msg.draftId));
        return;
      case 'pickCwd': {
        const cwd = await this.d.ui.pickFolder();
        if (cwd) this.d.post({ type: 'cwdPicked', cwd });
        return;
      }
    }
  }

  private async startDraft(draftId: string): Promise<void> {
    const draft = this.board.drafts[draftId];
    if (!draft || this.starting.has(draftId)) return;
    if (!this.cli) {
      this.d.ui.showError(NO_CLI_ERROR);
      return;
    }
    this.starting.add(draftId);
    try {
      const prompt = draft.prompt.trim() ? draft.prompt : draft.title;
      const shortId = await this.cli.startSession({ name: draft.title, prompt, cwd: draft.cwd });
      this.justStarted.set(sessionCardId(shortId), this.d.now());
      this.commit(promoteDraft(this.board, draftId, shortId));
    } catch (e) {
      this.d.ui.showError(`启动失败：${messageOf(e)}`);
      return;
    } finally {
      this.starting.delete(draftId);
    }
    await this.refresh();
  }

  private sessionFor(cardId: string): Session | undefined {
    return this.sessions.find((s) => sessionCardId(s.shortId) === cardId);
  }

  private commit(next: Board, post = true): void {
    if (next === this.board) return;
    this.board = next;
    this.d.store.save(next);
    if (post) this.post();
  }

  private post(): void {
    this.d.post({
      type: 'state',
      view: buildView(this.board, this.sessions, new Set(this.justStarted.keys())),
      error: this.error,
      defaultCwd: this.d.defaultCwd(),
    });
  }
}
