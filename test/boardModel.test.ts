import { describe, expect, it } from 'vitest';
import {
  INBOX_ID,
  addColumn,
  buildView,
  createDraft,
  defaultBoard,
  deleteColumn,
  deleteDraft,
  hideCard,
  moveCard,
  promoteDraft,
  reconcile,
  renameColumn,
  sessionCardId,
  statusBadge,
} from '../src/boardModel';
import type { Board, Session } from '../src/types';

function session(shortId: string, over: Partial<Session> = {}): Session {
  return {
    sessionId: `${shortId}-0000-0000-0000-000000000000`,
    shortId,
    name: `name-${shortId}`,
    cwd: `/Users/me/proj-${shortId}`,
    status: 'working',
    kind: 'background',
    pid: 1,
    startedAt: 1000,
    ...over,
  };
}

function board(columns: [string, string[]][], extra: Partial<Board> = {}): Board {
  return {
    version: 1,
    columns: columns.map(([id, cardIds]) => ({ id, title: id === INBOX_ID ? '未归类' : id.toUpperCase(), cardIds })),
    drafts: {},
    hidden: [],
    starting: {},
    ...extra,
  };
}

const ids = (b: Board) => Object.fromEntries(b.columns.map((c) => [c.id, c.cardIds]));
const noKeep = { pruneMissing: true, startedAfter: 0 };

describe('defaultBoard', () => {
  it('has only the inbox column', () => {
    expect(defaultBoard()).toEqual({ version: 1, columns: [{ id: 'inbox', title: '未归类', cardIds: [] }], drafts: {}, hidden: [], starting: {} });
  });
});

describe('reconcile', () => {
  it('appends unseen sessions to the end of the inbox', () => {
    const b = board([[INBOX_ID, ['s:aaaaaaaa']], ['doing', []]]);
    const out = reconcile(b, [session('aaaaaaaa'), session('bbbbbbbb')], noKeep);
    expect(ids(out)).toEqual({ inbox: ['s:aaaaaaaa', 's:bbbbbbbb'], doing: [] });
  });

  it('does not re-add placed or hidden sessions', () => {
    const b = board([[INBOX_ID, []], ['doing', ['s:aaaaaaaa']]], { hidden: ['s:bbbbbbbb'] });
    const out = reconcile(b, [session('aaaaaaaa'), session('bbbbbbbb')], noKeep);
    expect(ids(out)).toEqual({ inbox: [], doing: ['s:aaaaaaaa'] });
  });

  it('prunes session cards whose session is gone when pruneMissing is true', () => {
    const b = board([[INBOX_ID, ['s:gone0000', 'd:draft1']], ['doing', ['s:aaaaaaaa']]], {
      drafts: { draft1: { title: 't', prompt: 'p', cwd: '/x' } },
    });
    const out = reconcile(b, [session('aaaaaaaa')], noKeep);
    expect(ids(out)).toEqual({ inbox: ['d:draft1'], doing: ['s:aaaaaaaa'] });
  });

  it('keeps a just-started session card that is not listed yet (start time stored in the board)', () => {
    const b = board([[INBOX_ID, []], ['doing', ['s:new00000']]], { starting: { 's:new00000': 5000 } });
    const out = reconcile(b, [], { pruneMissing: true, startedAfter: 4000 });
    expect(ids(out)).toEqual({ inbox: [], doing: ['s:new00000'] });
    expect(out.starting).toEqual({ 's:new00000': 5000 });
  });

  it('prunes a started card and its start mark once the grace period has passed', () => {
    const b = board([[INBOX_ID, []], ['doing', ['s:new00000']]], { starting: { 's:new00000': 5000 } });
    const out = reconcile(b, [], { pruneMissing: true, startedAfter: 6000 });
    expect(ids(out)).toEqual({ inbox: [], doing: [] });
    expect(out.starting).toEqual({});
  });

  it('clears the start mark once the session reports a real status', () => {
    const b = board([[INBOX_ID, ['s:aaaaaaaa', 's:bbbbbbbb']]], { starting: { 's:aaaaaaaa': 5000, 's:bbbbbbbb': 5000 } });
    const out = reconcile(b, [session('aaaaaaaa', { status: 'busy' }), session('bbbbbbbb', { status: null })], {
      pruneMissing: true,
      startedAfter: 0,
    });
    expect(out.starting).toEqual({ 's:bbbbbbbb': 5000 });
  });

  it('never prunes when pruneMissing is false (CLI failure)', () => {
    const b = board([[INBOX_ID, ['s:gone0000']]], { hidden: ['s:gone1111'] });
    const out = reconcile(b, [], { pruneMissing: false, startedAfter: 0 });
    expect(out).toEqual(b);
  });

  it('drops hidden entries for sessions that no longer exist', () => {
    const b = board([[INBOX_ID, []]], { hidden: ['s:gone0000', 's:aaaaaaaa'] });
    const out = reconcile(b, [session('aaaaaaaa')], noKeep);
    expect(out.hidden).toEqual(['s:aaaaaaaa']);
  });

  it('returns the same object when nothing changed', () => {
    const b = board([[INBOX_ID, ['s:aaaaaaaa']]]);
    expect(reconcile(b, [session('aaaaaaaa')], noKeep)).toBe(b);
  });
});

describe('statusBadge', () => {
  it.each([
    ['working', '运行中', 'running'],
    ['busy', '运行中', 'running'],
    ['waiting', '等待输入', 'waiting'],
    ['idle', '空闲', 'idle'],
    ['done', '完成', 'done'],
    [null, '已停止', 'stopped'],
    ['foo', 'foo', 'unknown'],
  ] as const)('%s → %s', (status, label, tone) => {
    expect(statusBadge(status)).toEqual({ label, tone });
  });
});

describe('buildView', () => {
  it('renders session and draft cards, skipping missing sessions', () => {
    const b = board([[INBOX_ID, ['d:draft1', 's:aaaaaaaa', 's:gone0000']], ['doing', ['s:bbbbbbbb']]], {
      drafts: { draft1: { title: 'Fix login', prompt: 'please fix', cwd: '/Users/me/app' } },
    });
    const view = buildView(b, [
      session('aaaaaaaa', { status: 'waiting' }),
      session('bbbbbbbb', { kind: 'interactive', status: null }),
    ]);
    expect(view.waitingCount).toBe(1);
    expect(view.columns.map((c) => [c.id, c.removable, c.cards.map((x) => x.id)])).toEqual([
      ['inbox', false, ['d:draft1', 's:aaaaaaaa']],
      ['doing', true, ['s:bbbbbbbb']],
    ]);
    const [draft, a] = view.columns[0]!.cards;
    expect(draft).toEqual({
      id: 'd:draft1', type: 'draft', title: 'Fix login', cwd: '/Users/me/app', folder: 'app',
      badge: null, interactive: false, startedAt: null, prompt: 'please fix',
    });
    expect(a).toMatchObject({ type: 'session', title: 'name-aaaaaaaa', folder: 'proj-aaaaaaaa', badge: { tone: 'waiting' }, interactive: false, startedAt: 1000 });
    expect(view.columns[1]!.cards[0]).toMatchObject({ interactive: true, badge: { label: '已停止', tone: 'stopped' } });
  });
});

describe('buildView with just-started sessions', () => {
  it('shows 启动中 instead of 已停止 for a just-started session with null status', () => {
    const b = board([[INBOX_ID, ['s:aaaaaaaa', 's:bbbbbbbb']]], { starting: { 's:aaaaaaaa': 5000 } });
    const view = buildView(b, [session('aaaaaaaa', { status: null }), session('bbbbbbbb', { status: null })]);
    expect(view.columns[0]!.cards.map((c) => c.badge)).toEqual([
      { label: '启动中', tone: 'running' },
      { label: '已停止', tone: 'stopped' },
    ]);
  });
});

describe('column and card operations', () => {
  const b = board([[INBOX_ID, ['s:a', 's:b', 's:c']], ['doing', ['s:d']]]);

  it('moves a card between columns at an index', () => {
    expect(ids(moveCard(b, 's:b', 'doing', 0))).toEqual({ inbox: ['s:a', 's:c'], doing: ['s:b', 's:d'] });
  });

  it('reorders within a column', () => {
    expect(ids(moveCard(b, 's:a', INBOX_ID, 2))).toEqual({ inbox: ['s:b', 's:c', 's:a'], doing: ['s:d'] });
  });

  it('clamps the index', () => {
    expect(ids(moveCard(b, 's:a', 'doing', 99))).toEqual({ inbox: ['s:b', 's:c'], doing: ['s:d', 's:a'] });
    expect(ids(moveCard(b, 's:a', 'doing', -5))).toEqual({ inbox: ['s:b', 's:c'], doing: ['s:a', 's:d'] });
  });

  it('ignores moves to an unknown column or of an unknown card', () => {
    expect(moveCard(b, 's:a', 'nope', 0)).toBe(b);
    expect(moveCard(b, 's:zzz', 'doing', 0)).toBe(b);
  });

  it('adds, renames and deletes columns; inbox is protected', () => {
    const added = addColumn(b, 'c-1', '  Review  ');
    expect(added.columns.at(-1)).toEqual({ id: 'c-1', title: 'Review', cardIds: [] });
    expect(addColumn(b, 'c-2', '   ')).toBe(b);
    expect(renameColumn(b, 'doing', 'Doing!').columns[1]!.title).toBe('Doing!');
    expect(renameColumn(b, INBOX_ID, 'x')).toBe(b);
    expect(renameColumn(b, 'doing', '  ')).toBe(b);
    expect(ids(deleteColumn(b, 'doing'))).toEqual({ inbox: ['s:a', 's:b', 's:c', 's:d'] });
    expect(deleteColumn(b, INBOX_ID)).toBe(b);
  });

  it('creates a draft at the top of the inbox and deletes it', () => {
    const withDraft = createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' });
    expect(withDraft.columns[0]!.cardIds[0]).toBe('d:x1');
    expect(withDraft.drafts.x1).toEqual({ title: 'T', prompt: 'P', cwd: '/w' });
    const removed = deleteDraft(withDraft, 'x1');
    expect(removed.drafts).toEqual({});
    expect(ids(removed)).toEqual(ids(b));
  });

  it('promotes a draft into a session card in the same slot', () => {
    const withDraft = moveCard(createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' }), 'd:x1', 'doing', 1);
    const promoted = promoteDraft(withDraft, 'x1', 'f8475127', 7000);
    expect(ids(promoted)).toEqual({ inbox: ['s:a', 's:b', 's:c'], doing: ['s:d', 's:f8475127'] });
    expect(promoted.drafts).toEqual({});
    expect(promoted.starting).toEqual({ 's:f8475127': 7000 });
  });

  it('promoteDraft removes a duplicate that a racing refresh already put in the inbox', () => {
    const withDraft = moveCard(createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' }), 'd:x1', 'doing', 0);
    const raced = reconcile(withDraft, [session('f8475127')], { pruneMissing: false, startedAfter: 0 });
    expect(ids(raced).inbox).toContain('s:f8475127');
    const promoted = promoteDraft(raced, 'x1', 'f8475127', 7000);
    expect(ids(promoted)).toEqual({ inbox: ['s:a', 's:b', 's:c'], doing: ['s:f8475127', 's:d'] });
  });

  it('hides sessions and deletes drafts via hideCard', () => {
    const hidden = hideCard(b, 's:b');
    expect(ids(hidden).inbox).toEqual(['s:a', 's:c']);
    expect(hidden.hidden).toEqual(['s:b']);
    const withDraft = createDraft(b, 'x1', { title: 'T', prompt: 'P', cwd: '/w' });
    expect(hideCard(withDraft, 'd:x1').drafts).toEqual({});
  });

  it('builds session card ids from short ids', () => {
    expect(sessionCardId('f8475127')).toBe('s:f8475127');
  });
});
