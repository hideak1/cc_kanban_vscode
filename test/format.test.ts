import { describe, expect, it } from 'vitest';
import { dropIndex, formatAge, summary } from '../src/webview/format';

describe('formatAge', () => {
  const now = 10_000_000_000;
  it.each([
    [now - 20_000, '刚刚'],
    [now - 3 * 60_000, '3 分钟'],
    [now - 2 * 3_600_000 - 5, '2 小时'],
    [now - 3 * 86_400_000, '3 天'],
  ])('%s → %s', (startedAt, text) => {
    expect(formatAge(startedAt, now)).toBe(text);
  });

  it('returns empty text for unknown or future start times', () => {
    expect(formatAge(null, now)).toBe('');
    expect(formatAge(now + 5000, now)).toBe('刚刚');
  });
});

describe('dropIndex', () => {
  it('finds the insertion slot from card midpoints', () => {
    const mids = [100, 200, 300];
    expect(dropIndex(mids, 50)).toBe(0);
    expect(dropIndex(mids, 150)).toBe(1);
    expect(dropIndex(mids, 250)).toBe(2);
    expect(dropIndex(mids, 999)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });
});

describe('summary', () => {
  it('describes running and waiting counts in plain words', () => {
    const tones = ['running', 'running', 'waiting', 'idle', 'done'];
    expect(summary(tones)).toBe('2 个运行中，1 个等待输入');
    expect(summary(['idle'])).toBe('没有正在运行的 session');
    expect(summary(['waiting'])).toBe('1 个等待输入');
  });
});
