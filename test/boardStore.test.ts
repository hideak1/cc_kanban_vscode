import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultBoard } from '../src/boardModel';
import { BoardStore, normalizeBoard } from '../src/boardStore';
import type { Board } from '../src/types';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ck-store-'));
  file = join(dir, 'nested', 'board.json');
});

const sample: Board = {
  version: 1,
  columns: [
    { id: 'inbox', title: '未归类', cardIds: ['s:aaaaaaaa', 'd:x1'] },
    { id: 'c-1', title: 'Doing', cardIds: ['s:bbbbbbbb'] },
  ],
  drafts: { x1: { title: 'T', prompt: 'P', cwd: '/w' } },
  hidden: ['s:cccccccc'],
};

describe('BoardStore', () => {
  it('returns the default board when the file is missing', () => {
    expect(new BoardStore(file).load()).toEqual({ board: defaultBoard(), recovered: false });
  });

  it('round-trips a saved board and leaves no temp file', () => {
    const store = new BoardStore(file);
    store.save(sample);
    expect(store.load()).toEqual({ board: sample, recovered: false });
    expect(readdirSync(join(dir, 'nested'))).toEqual(['board.json']);
  });

  it('backs up a corrupt file and starts from the default board', () => {
    const store = new BoardStore(file);
    store.save(sample);
    writeFileSync(file, '{ not json');
    const { board, recovered } = store.load();
    expect(recovered).toBe(true);
    expect(board).toEqual(defaultBoard());
    const backups = readdirSync(join(dir, 'nested')).filter((n) => n.startsWith('board.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, 'nested', backups[0]!), 'utf8')).toBe('{ not json');
  });

  it('watch reports external writes but not its own saves', async () => {
    const store = new BoardStore(file);
    store.save(sample);
    const seen: Board[] = [];
    const sub = store.watch((b) => seen.push(b));
    store.save({ ...sample, hidden: [] });
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toHaveLength(0);
    writeFileSync(file, JSON.stringify({ ...sample, hidden: ['s:dddddddd'] }));
    await new Promise((r) => setTimeout(r, 300));
    sub.dispose();
    expect(seen.at(-1)?.hidden).toEqual(['s:dddddddd']);
  });

  it('treats an unsupported version as corrupt', () => {
    const store = new BoardStore(file);
    store.save(sample);
    writeFileSync(file, JSON.stringify({ ...sample, version: 2 }));
    expect(store.load().recovered).toBe(true);
  });
});

describe('normalizeBoard', () => {
  it('accepts a valid board unchanged', () => {
    expect(normalizeBoard(sample)).toEqual(sample);
  });

  it('adds a missing inbox at the front and forces its title', () => {
    const out = normalizeBoard({ version: 1, columns: [{ id: 'c-1', title: 'A', cardIds: [] }], drafts: {}, hidden: [] });
    expect(out?.columns.map((c) => [c.id, c.title])).toEqual([['inbox', '未归类'], ['c-1', 'A']]);
    const moved = normalizeBoard({
      version: 1,
      columns: [{ id: 'c-1', title: 'A', cardIds: [] }, { id: 'inbox', title: 'renamed', cardIds: [] }],
      drafts: {},
      hidden: [],
    });
    expect(moved?.columns.map((c) => [c.id, c.title])).toEqual([['inbox', '未归类'], ['c-1', 'A']]);
  });

  it('drops duplicate, malformed, and orphan-draft card ids', () => {
    const out = normalizeBoard({
      version: 1,
      columns: [
        { id: 'inbox', title: '未归类', cardIds: ['s:aaaaaaaa', 'junk', 'd:missing', 'd:x1', 42] },
        { id: 'c-1', title: 'A', cardIds: ['s:aaaaaaaa', 's:bbbbbbbb'] },
      ],
      drafts: { x1: { title: 'T', prompt: 'P', cwd: '/w' }, bad: { title: 1 } },
      hidden: ['s:cccccccc', 7],
    });
    expect(out).toEqual({
      version: 1,
      columns: [
        { id: 'inbox', title: '未归类', cardIds: ['s:aaaaaaaa', 'd:x1'] },
        { id: 'c-1', title: 'A', cardIds: ['s:bbbbbbbb'] },
      ],
      drafts: { x1: { title: 'T', prompt: 'P', cwd: '/w' } },
      hidden: ['s:cccccccc'],
    });
  });

  it('drops columns without a string id or title and duplicate column ids', () => {
    const out = normalizeBoard({
      version: 1,
      columns: [{ id: 'inbox', title: '未归类', cardIds: [] }, { title: 'x' }, { id: 'c-1', title: 'A', cardIds: [] }, { id: 'c-1', title: 'B', cardIds: [] }],
      drafts: {},
      hidden: [],
    });
    expect(out?.columns.map((c) => c.title)).toEqual(['未归类', 'A']);
  });

  it('rejects non-objects and wrong versions', () => {
    expect(normalizeBoard(null)).toBeNull();
    expect(normalizeBoard([])).toBeNull();
    expect(normalizeBoard({ version: 2, columns: [] })).toBeNull();
  });
});
