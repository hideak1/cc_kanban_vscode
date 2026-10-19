import { describe, expect, it } from 'vitest';
import { dropIndex, formatAge, summary } from '../src/webview/format';

describe('formatAge', () => {
  const now = 10_000_000_000;
  it.each([
    [now - 20_000, 'just now'],
    [now - 3 * 60_000, '3m'],
    [now - 2 * 3_600_000 - 5, '2h'],
    [now - 3 * 86_400_000, '3d'],
  ])('%s → %s', (startedAt, text) => {
    expect(formatAge(startedAt, now)).toBe(text);
  });

  it('returns empty text for unknown or future start times', () => {
    expect(formatAge(null, now)).toBe('');
    expect(formatAge(now + 5000, now)).toBe('just now');
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
    expect(summary(tones)).toBe('2 running, 1 needs input');
    expect(summary(['idle'])).toBe('No sessions running');
    expect(summary(['waiting'])).toBe('1 needs input');
  });
});
