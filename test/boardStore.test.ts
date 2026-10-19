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
    { id: 'inbox', title: '未归类', cardIds: ['s:aaaaaaaa', 'd:x1'], collapsed: false },
    { id: 'c-1', title: 'Doing', cardIds: ['s:bbbbbbbb'], collapsed: true },
    { id: 'done', title: '已完成', cardIds: ['s:cccccccc'], collapsed: true },
  ],
  drafts: { x1: { title: 'T', prompt: 'P', cwd: '/w' } },
  starting: { 's:bbbbbbbb': 1790694099011 },
};

const titles = (b: Board | null) => b?.columns.map((c) => [c.id, c.title, c.collapsed]);

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
    store.save({ ...sample, starting: {} });
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toHaveLength(0);
    writeFileSync(file, JSON.stringify({ ...sample, starting: { 's:dddddddd': 5 } }));
    await new Promise((r) => setTimeout(r, 300));
    sub.dispose();
    expect(seen.at(-1)?.starting).toEqual({ 's:dddddddd': 5 });
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

  it('adds missing built-in columns, keeps inbox first and done last, forces their titles', () => {
    const out = normalizeBoard({
      version: 1,
      columns: [
        { id: 'done', title: 'x', cardIds: [], collapsed: false },
        { id: 'c-1', title: 'A', cardIds: [] },
        { id: 'inbox', title: 'renamed', cardIds: [] },
      ],
      drafts: {},
    });
    expect(titles(out)).toEqual([
      ['inbox', '未归类', false],
      ['c-1', 'A', false],
      ['done', '已完成', false],
    ]);
    expect(titles(normalizeBoard({ version: 1, columns: [], drafts: {} }))).toEqual([
      ['inbox', '未归类', false],
      ['done', '已完成', true],
    ]);
  });

  it('migrates the old hidden list into the done column', () => {
    const out = normalizeBoard({
      version: 1,
      columns: [{ id: 'inbox', title: '未归类', cardIds: ['s:aaaaaaaa'] }],
      drafts: {},
      hidden: ['s:cccccccc', 's:aaaaaaaa', 7],
    });
    expect(out?.columns.map((c) => [c.id, c.cardIds])).toEqual([
      ['inbox', ['s:aaaaaaaa']],
      ['done', ['s:cccccccc']],
    ]);
    expect(out && 'hidden' in out).toBe(false);
  });

  it('drops duplicate, malformed, and orphan-draft card ids', () => {
    const out = normalizeBoard({
      version: 1,
      columns: [
        { id: 'inbox', title: '未归类', cardIds: ['s:aaaaaaaa', 'junk', 'd:missing', 'd:x1', 42] },
        { id: 'c-1', title: 'A', cardIds: ['s:aaaaaaaa', 's:bbbbbbbb'] },
      ],
      drafts: { x1: { title: 'T', prompt: 'P', cwd: '/w' }, bad: { title: 1 } },
    });
    expect(out?.columns.map((c) => [c.id, c.cardIds])).toEqual([
      ['inbox', ['s:aaaaaaaa', 'd:x1']],
      ['c-1', ['s:bbbbbbbb']],
      ['done', []],
    ]);
    expect(out?.drafts).toEqual({ x1: { title: 'T', prompt: 'P', cwd: '/w' } });
  });

  it('drops columns without a string id or title and duplicate column ids', () => {
    const out = normalizeBoard({
      version: 1,
      columns: [{ id: 'inbox', title: '未归类', cardIds: [] }, { title: 'x' }, { id: 'c-1', title: 'A', cardIds: [] }, { id: 'c-1', title: 'B', cardIds: [] }],
      drafts: {},
    });
    expect(out?.columns.map((c) => c.title)).toEqual(['未归类', 'A', '已完成']);
  });

  it('keeps numeric start marks for session cards and defaults a missing map', () => {
    const { starting: _s, ...legacy } = sample;
    expect(normalizeBoard(legacy)?.starting).toEqual({});
    expect(normalizeBoard({ ...sample, starting: { 's:aaaaaaaa': 5, 'd:x1': 6, 's:bbbbbbbb': 'x' } })?.starting).toEqual({ 's:aaaaaaaa': 5 });
  });

  it('rejects non-objects and wrong versions', () => {
    expect(normalizeBoard(null)).toBeNull();
    expect(normalizeBoard([])).toBeNull();
    expect(normalizeBoard({ version: 2, columns: [] })).toBeNull();
  });
});
