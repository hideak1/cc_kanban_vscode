import { describe, expect, it } from 'vitest';
import { defaultBoard } from '../src/boardModel';
import { Controller, type Ui } from '../src/controller';
import type { Board, Session, ToWebview } from '../src/types';

function session(shortId: string, over: Partial<Session> = {}): Session {
  return {
    sessionId: `${shortId}-0000`,
    shortId,
    name: `name-${shortId}`,
    cwd: `/w/${shortId}`,
    status: 'busy',
    state: 'working',
    waitingFor: null,
    kind: 'background',
    pid: 1,
    startedAt: 1,
    ...over,
  };
}

function setup(opts: { sessions?: Session[]; board?: Board; recovered?: boolean; noCli?: boolean } = {}) {
  let sessions = opts.sessions ?? [];
  let listError: Error | null = null;
  let stopError: Error | null = null;
  let startResult: string | Error = 'f8475127';
  let clock = 0;
  let idSeq = 0;
  let saved: Board | null = null;
  let saves = 0;
  const posts: ToWebview[] = [];
  const calls: string[] = [];
  let confirmAnswer = true;
  let picked: string | null = '/picked';
  let releaseStart: (() => void) | null = null;
  let holdStart = false;

  const cli = {
    listSessions: async () => {
      calls.push('list');
      if (listError) throw listError;
      return sessions;
    },
    startSession: async (o: { name: string; prompt: string; cwd: string }) => {
      calls.push(`start ${o.name}|${o.prompt}|${o.cwd}`);
      if (holdStart) await new Promise<void>((r) => (releaseStart = r));
      if (startResult instanceof Error) throw startResult;
      return startResult;
    },
    stopSession: async (id: string) => {
      calls.push(`stop ${id}`);
      if (stopError) throw stopError;
    },
    respawnSession: async (id: string) => {
      calls.push(`respawn ${id}`);
    },
  };
  const ui: Ui = {
    attach: (id, name, cwd) => calls.push(`attach ${id}|${name}|${cwd}`),
    pickFolder: async () => picked,
    confirm: async (m) => {
      calls.push(`confirm ${m}`);
      return confirmAnswer;
    },
    showError: (m) => calls.push(`error ${m}`),
    showInfo: (m) => calls.push(`info ${m}`),
  };
  const store = {
    load: () => ({ board: opts.board ?? defaultBoard(), recovered: opts.recovered ?? false }),
    save: (b: Board) => {
      saved = b;
      saves++;
    },
  };
  const c = new Controller({
    cli: opts.noCli ? null : cli,
    store,
    ui,
    post: (m) => posts.push(m),
    defaultCwd: () => '/default',
    newId: () => `id${++idSeq}`,
    now: () => clock,
  });
  return {
    c,
    posts,
    calls,
    get saved() {
      return saved;
    },
    get saves() {
      return saves;
    },
    lastState: () => posts.filter((p) => p.type === 'state').at(-1) as Extract<ToWebview, { type: 'state' }>,
    setSessions: (s: Session[]) => (sessions = s),
    failList: (e: Error | null) => (listError = e),
    failStop: (e: Error | null) => (stopError = e),
    setStart: (r: string | Error) => (startResult = r),
    advance: (ms: number) => (clock += ms),
    answerConfirm: (v: boolean) => (confirmAnswer = v),
    pick: (v: string | null) => (picked = v),
    holdStart: () => (holdStart = true),
    releaseStart: () => releaseStart?.(),
  };
}

/** Card ids per column, excluding the built-in done column (see doneIds). */
const cardIds = (s: ReturnType<typeof setup>) =>
  s.lastState().view.columns.filter((col) => col.id !== 'done').map((col) => col.cards.map((x) => x.id));
const doneIds = (s: ReturnType<typeof setup>) =>
  s.lastState().view.columns.find((col) => col.id === 'done')?.cards.map((x) => x.id);

describe('Controller.refresh', () => {
  it('posts the view and saves only when the board changed', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    expect(s.lastState()).toMatchObject({ error: null, defaultCwd: '/default' });
    expect(cardIds(s)).toEqual([['s:aaaaaaaa']]);
    expect(s.saves).toBe(1);
    await s.c.refresh();
    expect(s.saves).toBe(1);
  });

  it('keeps previous sessions and placements when the CLI fails', async () => {
    const [inbox, done] = defaultBoard().columns;
    const board: Board = { ...defaultBoard(), columns: [inbox!, { id: 'c-1', title: 'A', cardIds: ['s:aaaaaaaa'], collapsed: false }, done!] };
    const s = setup({ sessions: [session('aaaaaaaa')], board });
    await s.c.refresh();
    s.failList(new Error('timeout'));
    await s.c.refresh();
    expect(s.lastState().error).toBe('Status may be out of date: timeout');
    expect(cardIds(s)).toEqual([[], ['s:aaaaaaaa']]);
  });

  it('reports a missing claude binary', async () => {
    const s = setup({ noCli: true });
    await s.c.refresh();
    expect(s.lastState().error).toBe('Cannot find the claude command. Set its path in the claudeKanban.claudePath setting.');
  });

  it('tells the user when a corrupt board was reset', () => {
    const s = setup({ recovered: true });
    expect(s.calls).toContain('info The board data file was corrupt. It was backed up and the board was reset.');
  });

  it('counts waiting sessions', async () => {
    const s = setup({ sessions: [session('aaaaaaaa', { status: 'waiting' }), session('bbbbbbbb')] });
    await s.c.refresh();
    expect(s.c.waitingCount).toBe(1);
  });
});

describe('Controller.handle', () => {
  it('attaches background sessions and explains interactive ones', async () => {
    const s = setup({ sessions: [session('aaaaaaaa'), session('bbbbbbbb', { kind: 'interactive' })] });
    await s.c.refresh();
    await s.c.handle({ type: 'attach', cardId: 's:aaaaaaaa' });
    await s.c.handle({ type: 'attach', cardId: 's:bbbbbbbb' });
    expect(s.calls).toContain('attach aaaaaaaa|name-aaaaaaaa|/w/aaaaaaaa');
    expect(s.calls).toContain('info This session runs directly in another terminal and cannot be attached.');
  });

  it('moves cards and persists', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    await s.c.handle({ type: 'addColumn', title: 'Doing' });
    await s.c.handle({ type: 'move', cardId: 's:aaaaaaaa', toColumnId: 'c-id1', index: 0 });
    expect(cardIds(s)).toEqual([[], ['s:aaaaaaaa']]);
    expect(s.saved?.columns[1]).toEqual({ id: 'c-id1', title: 'Doing', cardIds: ['s:aaaaaaaa'], collapsed: false });
  });

  it('starts a draft and keeps the new card through a refresh that does not list it yet', async () => {
    const s = setup();
    await s.c.handle({ type: 'createDraft', title: 'Fix login', prompt: 'please fix', cwd: '' });
    await s.c.handle({ type: 'addColumn', title: 'Doing' });
    await s.c.handle({ type: 'move', cardId: 'd:id1', toColumnId: 'c-id2', index: 0 });
    await s.c.handle({ type: 'startDraft', draftId: 'id1' });
    expect(s.calls).toContain('start Fix login|please fix|/default');
    expect(cardIds(s)).toEqual([[], []]);
    expect(s.saved?.columns[1]?.cardIds).toEqual(['s:f8475127']);

    s.setSessions([session('f8475127', { status: null })]);
    await s.c.refresh();
    expect(cardIds(s)).toEqual([[], ['s:f8475127']]);
    expect(s.lastState().view.columns[1]!.cards[0]!.badge).toEqual({ label: 'Starting', tone: 'running' });
  });

  it('a second window does not prune a card the first window just started', async () => {
    const a = setup();
    await a.c.handle({ type: 'createDraft', title: 'T', prompt: 'P', cwd: '/w' });
    await a.c.handle({ type: 'addColumn', title: 'Doing' });
    await a.c.handle({ type: 'move', cardId: 'd:id1', toColumnId: 'c-id2', index: 0 });
    await a.c.handle({ type: 'startDraft', draftId: 'id1' });

    const b = setup({ board: a.saved! });
    await b.c.refresh();
    expect(b.saves).toBe(0);
  });

  it('drops a started card that never shows up after the 60s grace period', async () => {
    const s = setup();
    await s.c.handle({ type: 'createDraft', title: 'T', prompt: 'P', cwd: '/w' });
    await s.c.handle({ type: 'startDraft', draftId: 'id1' });
    s.advance(61_000);
    await s.c.refresh();
    expect(s.saved?.columns[0]?.cardIds).toEqual([]);
  });

  it('uses the title as prompt when the prompt is empty', async () => {
    const s = setup();
    await s.c.handle({ type: 'createDraft', title: 'Do it', prompt: '  ', cwd: '/w' });
    await s.c.handle({ type: 'startDraft', draftId: 'id1' });
    expect(s.calls).toContain('start Do it|Do it|/w');
  });

  it('keeps the draft and shows the CLI error when starting fails', async () => {
    const s = setup();
    await s.c.handle({ type: 'createDraft', title: 'T', prompt: 'P', cwd: '/w' });
    s.setStart(new Error('Workspace not trusted.'));
    await s.c.handle({ type: 'startDraft', draftId: 'id1' });
    expect(s.calls).toContain('error Could not start the session: Workspace not trusted.');
    expect(cardIds(s)).toEqual([['d:id1']]);
  });

  it('ignores a second start click while the first is still running', async () => {
    const s = setup();
    await s.c.handle({ type: 'createDraft', title: 'T', prompt: 'P', cwd: '/w' });
    s.holdStart();
    const first = s.c.handle({ type: 'startDraft', draftId: 'id1' });
    await s.c.handle({ type: 'startDraft', draftId: 'id1' });
    s.releaseStart();
    await first;
    expect(s.calls.filter((x) => x.startsWith('start '))).toHaveLength(1);
  });

  it('ignores empty draft titles', async () => {
    const s = setup();
    await s.c.handle({ type: 'createDraft', title: '  ', prompt: 'P', cwd: '/w' });
    expect(s.saves).toBe(0);
  });

  it('asks before deleting a non-empty column and respects a no', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    await s.c.handle({ type: 'addColumn', title: 'Doing' });
    await s.c.handle({ type: 'move', cardId: 's:aaaaaaaa', toColumnId: 'c-id1', index: 0 });
    s.answerConfirm(false);
    await s.c.handle({ type: 'deleteColumn', columnId: 'c-id1' });
    expect(s.calls).toContain('confirm Delete column "Doing"? Its card moves back to Inbox.');
    expect(cardIds(s)).toEqual([[], ['s:aaaaaaaa']]);
    s.answerConfirm(true);
    await s.c.handle({ type: 'deleteColumn', columnId: 'c-id1' });
    expect(cardIds(s)).toEqual([['s:aaaaaaaa']]);
  });

  it('deletes an empty column without asking', async () => {
    const s = setup();
    await s.c.handle({ type: 'addColumn', title: 'Doing' });
    await s.c.handle({ type: 'deleteColumn', columnId: 'c-id1' });
    expect(s.calls.some((x) => x.startsWith('confirm'))).toBe(false);
    expect(s.saved?.columns.map((c) => c.id)).toEqual(['inbox', 'done']);
  });

  it('stops a session then refreshes', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    await s.c.handle({ type: 'stop', cardId: 's:aaaaaaaa' });
    expect(s.calls.slice(-2)).toEqual(['stop aaaaaaaa', 'list']);
  });

  it('completes a running session: moves it to done and stops it', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    await s.c.handle({ type: 'complete', cardId: 's:aaaaaaaa' });
    expect(s.calls.slice(-2)).toEqual(['stop aaaaaaaa', 'list']);
    expect(cardIds(s)).toEqual([[]]);
    expect(doneIds(s)).toEqual(['s:aaaaaaaa']);
  });

  it('completes an already-stopped or interactive session without calling stop', async () => {
    const s = setup({ sessions: [session('aaaaaaaa', { status: null, state: 'done' }), session('bbbbbbbb', { kind: 'interactive', state: null })] });
    await s.c.refresh();
    await s.c.handle({ type: 'complete', cardId: 's:aaaaaaaa' });
    await s.c.handle({ type: 'complete', cardId: 's:bbbbbbbb' });
    expect(s.calls.some((x) => x.startsWith('stop'))).toBe(false);
    expect(doneIds(s)).toEqual(['s:bbbbbbbb', 's:aaaaaaaa']);
  });

  it('keeps the card in done and shows the error when stop fails during complete', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    s.failStop(new Error('no such job'));
    await s.c.handle({ type: 'complete', cardId: 's:aaaaaaaa' });
    expect(s.calls).toContain('error Could not stop the session: no such job');
    expect(doneIds(s)).toEqual(['s:aaaaaaaa']);
  });

  it('resumes a stopped background session with respawn and shows it as starting', async () => {
    const s = setup({ sessions: [session('aaaaaaaa', { status: null, state: 'failed' })] });
    await s.c.refresh();
    await s.c.handle({ type: 'resume', cardId: 's:aaaaaaaa' });
    expect(s.calls.slice(-2)).toEqual(['respawn aaaaaaaa', 'list']);
    expect(s.lastState().view.columns[0]!.cards[0]!.badge).toEqual({ label: 'Starting', tone: 'running' });
  });

  it('toggles a column collapsed and persists it', async () => {
    const s = setup();
    await s.c.handle({ type: 'toggleColumn', columnId: 'done' });
    expect(s.saved?.columns.at(-1)?.collapsed).toBe(false);
    expect(s.lastState().view.columns.at(-1)?.collapsed).toBe(false);
  });

  it('posts the picked folder', async () => {
    const s = setup();
    await s.c.handle({ type: 'pickCwd' });
    expect(s.posts.at(-1)).toEqual({ type: 'cwdPicked', cwd: '/picked' });
    s.pick(null);
    const n = s.posts.length;
    await s.c.handle({ type: 'pickCwd' });
    expect(s.posts.length).toBe(n);
  });

  it('applies a board changed in another window', async () => {
    const s = setup({ sessions: [session('aaaaaaaa')] });
    await s.c.refresh();
    s.c.setBoard({ ...defaultBoard(), columns: [{ id: 'inbox', title: 'Inbox', cardIds: [], collapsed: false }, { id: 'c-x', title: 'X', cardIds: ['s:aaaaaaaa'], collapsed: false }] });
    expect(cardIds(s)).toEqual([[], ['s:aaaaaaaa']]);
  });
});
