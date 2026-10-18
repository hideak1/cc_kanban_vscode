import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { attachCommand, shellQuote } from '../src/shell';

describe('shellQuote', () => {
  it.each(['/usr/local/bin/claude', '/Users/me/My Tools/claude', "/tmp/it's/claude", '/tmp/$(whoami)/`x`'])(
    'round-trips %s through sh unchanged',
    (p) => {
      expect(execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(p)}`], { encoding: 'utf8' })).toBe(p);
    },
  );
});

describe('attachCommand', () => {
  it('quotes the binary and appends attach <id>', () => {
    expect(attachCommand('/a b/claude', 'f8475127')).toBe("'/a b/claude' attach f8475127");
  });
});
