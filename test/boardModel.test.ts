import { describe, expect, it } from 'vitest';
import {
  DONE_ID,
  INBOX_ID,
  addColumn,
  buildView,
  completeCard,
  createDraft,
  defaultBoard,
  deleteColumn,
  deleteDraft,
  markStarting,
  moveCard,
  promoteDraft,
  reconcile,
  renameColumn,
  sessionBadge,
  sessionCardId,
  toggleColumn,
} from '../src/boardModel';
import type { Board, Session } from '../src/types';

function session(shortId: string, over: Partial<Session> = {}): Session {
  return {
    sessionId: `${shortId}-0000-0000-0000-000000000000`,
    shortId,
    name: `name-${shortId}`,
    cwd: `/Users/me/proj-${shortId}`,
    status: 'busy',
    state: 'working',
    waitingFor: null,
    kind: 'background',
    pid: 1,
    startedAt: 1000,
    ...over,
  };
}

/** Builds a board; inbox and done are added around the given middle columns. */
function board(
  cols: { inbox?: string[]; done?: string[]; middle?: [string, string[]][] } = {},
  extra: Partial<Board> = {},
): Board {
  return {
    version: 1,
    columns: [
      { id: INBOX_ID, title: '未归类', cardIds: cols.inbox ?? [], collapsed: false },
      ...(cols.middle ?? []).map(([id, cardIds]) => ({ id, title: id.toUpperCase(), cardIds, collapsed: false })),
      { id: DONE_ID, title: '已完成', cardIds: cols.done ?? [], collapsed: true },
    ],
    drafts: {},
    starting: {},
    ...extra,
  };
}

const ids = (b: Board) => Object.fromEntries(b.columns.map((c) => [c.id, c.cardIds]));
const prune = { pruneMissing: true, startedAfter: 0 };

describe('defaultBoard', () => {
  it('has the inbox first and a collapsed done column last', () => {
    expect(defaultBoard()).toEqual({
      version: 1,
      columns: [
        { id: 'inbox', title: '未归类', cardIds: [], collapsed: false },
        { id: 'done', title: '已完成', cardIds: [], collapsed: true },
      ],
      drafts: {},
      starting: {},
    });
  });
});

describe('sessionBadge', () => {
  const s = (over: Partial<Session>) => session('aaaaaaaa', over);
  it.each([
    ['blocked task (Claude asked a question)', s({ status: 'idle', state: 'blocked' }), '等待你回复', 'waiting'],
    ['permission / input prompt', s({ status: 'waiting', state: null, kind: 'interactive' }), '等待输入', 'waiting'],
    ['working', s({ status: 'busy', state: 'working' }), '运行中', 'running'],
    ['interactive busy', s({ status: 'busy', state: null, kind: 'interactive' }), '运行中', 'running'],
    ['finished turn, ready for review', s({ status: 'idle', state: 'done' }), '待查看', 'review'],
    ['done while process stopped', s({ status: null, state: 'done' }), '待查看', 'review'],
    ['interrupted by shutdown', s({ status: null, state: 'failed' }), '已中断', 'failed'],
    ['stopped state', s({ status: null, state: 'stopped' }), '已停止', 'stopped'],
    ['no process, no state', s({ status: null, state: null }), '已停止', 'stopped'],
    ['interactive idle', s({ status: 'idle', state: null, kind: 'interactive' }), '空闲', 'idle'],
    ['unknown future state', s({ status: 'idle', state: 'paused' }), 'paused', 'unknown'],
  ] as const)('%s → %s', (_name, sess, label, tone) => {
    expect(sessionBadge(sess, false)).toEqual({ label, tone });
  });

  it('shows 启动中 for a just-started session whose process is not reported yet', () => {
    expect(sessionBadge(session('aaaaaaaa', { status: null, state: null }), true)).toEqual({ label: '启动中', tone: 'running' });
  });

  it('a waiting prompt wins over a just-started mark', () => {
    expect(sessionBadge(session('aaaaaaaa', { status: 'waiting' }), true).tone).toBe('waiting');
  });
});

describe('reconcile', () => {
  it('appends unseen sessions to the end of the inbox', () => {
    const b = board({ inbox: ['s:aaaaaaaa'] });
    const out = reconcile(b, [session('aaaaaaaa'), session('bbbbbbbb')], prune);
    expect(ids(out).inbox).toEqual(['s:aaaaaaaa', 's:bbbbbbbb']);
  });

  it('does not re-add sessions already placed in any column, including done', () => {
    const b = board({ middle: [['doing', ['s:aaaaaaaa']]], done: ['s:bbbbbbbb'] });
    const out = reconcile(b, [session('aaaaaaaa'), session('bbbbbbbb')], prune);
    expect(out).toBe(b);
  });

  it('prunes session cards whose session is gone, keeping drafts', () => {
    const b = board({ inbox: ['s:gone0000', 'd:draft1'], done: ['s:gone1111'] }, { drafts: { draft1: { title: 't', prompt: 'p', cwd: '/x' } } });
    const out = reconcile(b, [], prune);
    expect(ids(out)).toEqual({ inbox: ['d:draft1'], done: [] });
  });

  it('never prunes when pruneMissing is false (CLI failure)', () => {
    const b = board({ inbox: ['s:gone0000'] });
    expect(reconcile(b, [], { pruneMissing: false, startedAfter: 0 })).toBe(b);
  });

  it('keeps a just-started card within the grace period and drops it after', () => {
    const b = board({ middle: [['doing', ['s:new00000']]] }, { starting: { 's:new00000': 5000 } });
    expect(ids(reconcile(b, [], { pruneMissing: true, startedAfter: 4000 })).doing).toEqual(['s:new00000']);
    const late = reconcile(b, [], { pruneMissing: true, startedAfter: 6000 });
    expect(ids(late).doing).toEqual([]);
    expect(late.starting).toEqual({});
  });

  it('clears the start mark once the session reports a process status', () => {
    const b = board({ inbox: ['s:aaaaaaaa', 's:bbbbbbbb'] }, { starting: { 's:aaaaaaaa': 5000, 's:bbbbbbbb': 5000 } });
    const out = reconcile(b, [session('aaaaaaaa', { status: 'busy' }), session('bbbbbbbb', { status: null })], prune);
    expect(out.starting).toEqual({ 's:bbbbbbbb': 5000 });
  });
});

describe('buildView', () => {
  it('renders cards with badge, detail, actions and per-column waiting counts', () => {
    const b = board(
      { inbox: ['d:draft1', 's:aaaaaaaa', 's:gone0000'], middle: [['doing', ['s:bbbbbbbb', 's:cccccccc']]] },
      { drafts: { draft1: { title: 'Fix login', prompt: 'please fix', cwd: '/Users/me/app' } } },
    );
    const view = buildView(b, [
      session('aaaaaaaa', { status: 'idle', state: 'blocked' }),
      session('bbbbbbbb', { kind: 'interactive', status: 'waiting', state: null, waitingFor: 'input needed' }),
      session('cccccccc', { status: null, state: 'failed' }),
    ]);
    expect(view.waitingCount).toBe(2);
    expect(view.columns.map((c) => [c.id, c.builtIn, c.collapsed, c.waitingCount, c.cards.map((x) => x.id)])).toEqual([
      ['inbox', true, false, 1, ['d:draft1', 's:aaaaaaaa']],
      ['doing', false, false, 1, ['s:bbbbbbbb', 's:cccccccc']],
      ['done', true, true, 0, []],
    ]);
    const [draft, a] = view.columns[0]!.cards;
    expect(draft).toEqual({
      id: 'd:draft1', type: 'draft', title: 'Fix login', cwd: '/Users/me/app', folder: 'app', badge: null, detail: null,
      interactive: false, startedAt: null, canStop: false, canResume: false, prompt: 'please fix',
    });
    expect(a).toMatchObject({ type: 'session', folder: 'proj-aaaaaaaa', badge: { tone: 'waiting' }, canStop: true, canResume: false });
    const [bCard, cCard] = view.columns[1]!.cards;
    expect(bCard).toMatchObject({ interactive: true, detail: 'input needed', canStop: false, canResume: false });
    expect(cCard).toMatchObject({ badge: { label: '已中断', tone: 'failed' }, canStop: false, canResume: true });
  });
});

describe('column and card operations', () => {
  const b = board({ inbox: ['s:a', 's:b', 's:c'], middle: [['doing', ['s:d']]] });

  it('moves a card between columns at an index, including into done', () => {
    expect(ids(moveCard(b, 's:b', 'doing', 0))).toEqual({ inbox: ['s:a', 's:c'], doing: ['s:b', 's:d'], done: [] });
    expect(ids(moveCard(b, 's:b', DONE_ID, 0)).done).toEqual(['s:b']);
  });

  it('reorders within a column and clamps the index', () => {
    expect(ids(moveCard(b, 's:a', INBOX_ID, 2)).inbox).toEqual(['s:b', 's:c', 's:a']);
    expect(ids(moveCard(b, 's:a', 'doing', 99)).doing).toEqual(['s:d', 's:a']);
    expect(ids(moveCard(b, 's:a', 'doing', -5)).doing).toEqual(['s:a', 's:d']);
  });

  it('ignores moves to an unknown column or of an unknown card', () => {
    expect(moveCard(b, 's:a', 'nope', 0)).toBe(b);
    expect(moveCard(b, 's:zzz', 'doing', 0)).toBe(b);
  });

  it('adds new columns before done', () => {
    const added = addColumn(b, 'c-1', '  Review  ');
    expect(added.columns.map((c) => c.id)).toEqual(['inbox', 'doing', 'c-1', 'done']);
    expect(added.columns[2]).toEqual({ id: 'c-1', title: 'Review', cardIds: [], collapsed: false });
    expect(addColumn(b, 'c-2', '   ')).toBe(b);
  });

  it('renames and deletes user columns; built-in columns are protected', () => {
    expect(renameColumn(b, 'doing', 'Doing!').columns[1]!.title).toBe('Doing!');
    expect(renameColumn(b, INBOX_ID, 'x')).toBe(b);
    expect(renameColumn(b, DONE_ID, 'x')).toBe(b);
    expect(renameColumn(b, 'doing', '  ')).toBe(b);
    expect(ids(deleteColumn(b, 'doing'))).toEqual({ inbox: ['s:a', 's:b', 's:c', 's:d'], done: [] });
    expect(deleteColumn(b, INBOX_ID)).toBe(b);
    expect(deleteColumn(b, DONE_ID)).toBe(b);
  });

  it('toggles a column between collapsed and expanded', () => {
    const collapsed = toggleColumn(b, 'doing');
    expect(collapsed.columns[1]!.collapsed).toBe(true);
    expect(toggleColumn(collapsed, 'doing').columns[1]!.collapsed).toBe(false);
    expect(toggleColumn(b, DONE_ID).columns.at(-1)!.collapsed).toBe(false);
    expect(toggleColumn(b, 'nope')).toBe(b);
  });

  it('completes a card by moving it to the top of done', () => {
    const once = completeCard(b, 's:b');
    expect(ids(completeCard(once, 's:d'))).toEqual({ inbox: ['s:a', 's:c'], doing: [], done: ['s:d', 's:b'] });
  });

  it('creates a draft at the top of the inbox and deletes it', () => {
    const withDraft = createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' });
    expect(withDraft.columns[0]!.cardIds[0]).toBe('d:x1');
    expect(withDraft.drafts.x1).toEqual({ title: 'T', prompt: 'P', cwd: '/w' });
    const removed = deleteDraft(withDraft, 'x1');
    expect(removed.drafts).toEqual({});
    expect(ids(removed)).toEqual(ids(b));
  });

  it('promotes a draft into a session card in the same slot and records the start time', () => {
    const withDraft = moveCard(createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' }), 'd:x1', 'doing', 1);
    const promoted = promoteDraft(withDraft, 'x1', 'f8475127', 7000);
    expect(ids(promoted).doing).toEqual(['s:d', 's:f8475127']);
    expect(promoted.drafts).toEqual({});
    expect(promoted.starting).toEqual({ 's:f8475127': 7000 });
  });

  it('promoteDraft removes a duplicate that a racing refresh already put in the inbox', () => {
    const withDraft = moveCard(createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' }), 'd:x1', 'doing', 0);
    const raced = reconcile(withDraft, [session('f8475127')], { pruneMissing: false, startedAfter: 0 });
    expect(ids(raced).inbox).toContain('s:f8475127');
    const promoted = promoteDraft(raced, 'x1', 'f8475127', 7000);
    expect(ids(promoted)).toEqual({ inbox: ['s:a', 's:b', 's:c'], doing: ['s:f8475127', 's:d'], done: [] });
  });

  it('marks a resumed session as starting so it is not shown as stopped meanwhile', () => {
    expect(markStarting(b, 's:a', 9000).starting).toEqual({ 's:a': 9000 });
  });

  it('builds session card ids from short ids', () => {
    expect(sessionCardId('f8475127')).toBe('s:f8475127');
  });
});
