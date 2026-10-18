import { describe, expect, it } from 'vitest';
import { attachTerminalOptions } from '../src/shell';

describe('attachTerminalOptions', () => {
  it('runs claude attach as the terminal process itself, so detaching ends the terminal', () => {
    expect(attachTerminalOptions({ shortId: 'f8475127', name: 'fix login', cwd: '/w', claudePath: '/a b/claude', cwdExists: true })).toEqual({
      name: 'Claude: fix login',
      cwd: '/w',
      shellPath: '/a b/claude',
      shellArgs: ['attach', 'f8475127'],
    });
  });

  it('omits a cwd that no longer exists', () => {
    const o = attachTerminalOptions({ shortId: 'f8475127', name: 'n', cwd: '/gone', claudePath: 'claude', cwdExists: false });
    expect(o.cwd).toBeUndefined();
  });
});
