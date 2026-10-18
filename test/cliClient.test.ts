import { describe, expect, it } from 'vitest';
import {
  CliClient,
  parseAgentsJson,
  parseBgOutput,
  resolveClaudePath,
  stripAnsi,
  type Runner,
} from '../src/cliClient';

const AGENTS_FIXTURE = JSON.stringify([
  {
    sessionId: 'f8475127-0dbd-4aa5-ae3f-0ddd6eec0f45',
    name: 'kanban-probe',
    cwd: '/Users/me/project',
    status: 'working',
    kind: 'background',
    pid: 10202,
    startedAt: 1790694099011,
  },
  {
    sessionId: 'ab50d108-1111-2222-3333-444455556666',
    name: 'project-4e',
    cwd: '/Users/me/project/kaggle',
    status: null,
    kind: 'interactive',
    pid: null,
    startedAt: null,
  },
]);

const BG_OUTPUT =
  'backgrounded · \x1b[36mf8475127\x1b[39m · kanban-probe\n' +
  '\x1b[2m  claude agents             list sessions\x1b[22m\n' +
  '\x1b[2m  claude attach f8475127    open in this terminal\x1b[22m\n';

function fakeRunner(result: { code: number; stdout: string; stderr: string }) {
  const calls: { file: string; args: string[]; opts: { cwd?: string; timeoutMs: number } }[] = [];
  const run: Runner = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return result;
  };
  return { run, calls };
}

describe('stripAnsi', () => {
  it('removes colour escape sequences', () => {
    expect(stripAnsi('a\x1b[36mb\x1b[39mc')).toBe('abc');
  });
});

describe('parseAgentsJson', () => {
  it('maps real CLI fields and derives the 8-char short id', () => {
    const sessions = parseAgentsJson(AGENTS_FIXTURE);
    expect(sessions).toEqual([
      {
        sessionId: 'f8475127-0dbd-4aa5-ae3f-0ddd6eec0f45',
        shortId: 'f8475127',
        name: 'kanban-probe',
        cwd: '/Users/me/project',
        status: 'working',
        kind: 'background',
        pid: 10202,
        startedAt: 1790694099011,
      },
      {
        sessionId: 'ab50d108-1111-2222-3333-444455556666',
        shortId: 'ab50d108',
        name: 'project-4e',
        cwd: '/Users/me/project/kaggle',
        status: null,
        kind: 'interactive',
        pid: null,
        startedAt: null,
      },
    ]);
  });

  it('throws when the top level is not an array', () => {
    expect(() => parseAgentsJson('{"a":1}')).toThrow();
    expect(() => parseAgentsJson('not json')).toThrow();
  });

  it('throws when entries exist but none is recognisable (CLI format changed)', () => {
    expect(() => parseAgentsJson(JSON.stringify([{ id: 'f8475127-x', name: 'a' }, { id: 'ab50d108-y' }]))).toThrow(/format/);
    expect(parseAgentsJson('[]')).toEqual([]);
  });

  it('skips entries without a string sessionId', () => {
    const out = parseAgentsJson(JSON.stringify([{ name: 'x' }, { sessionId: 'abcdefgh-1', name: 'y' }]));
    expect(out.map((s) => s.shortId)).toEqual(['abcdefgh']);
  });

  it('falls back to safe defaults for missing optional fields', () => {
    const [s] = parseAgentsJson(JSON.stringify([{ sessionId: 'abcdefgh-1' }]));
    expect(s).toMatchObject({ name: 'abcdefgh', cwd: '', status: null, kind: 'unknown', pid: null, startedAt: null });
  });
});

describe('parseBgOutput', () => {
  it('extracts the short id from the backgrounded line', () => {
    expect(parseBgOutput(BG_OUTPUT)).toBe('f8475127');
  });

  it('falls back to the claude attach hint line', () => {
    expect(parseBgOutput('something new\n  claude attach 1a2b3c4d    open\n')).toBe('1a2b3c4d');
  });

  it('throws on unrelated output', () => {
    expect(() => parseBgOutput('hello world')).toThrow();
  });
});

describe('CliClient', () => {
  it('listSessions runs agents --json --all with a 5s timeout', async () => {
    const { run, calls } = fakeRunner({ code: 0, stdout: AGENTS_FIXTURE, stderr: '' });
    const sessions = await new CliClient(run, '/bin/claude').listSessions();
    expect(sessions).toHaveLength(2);
    expect(calls[0]).toEqual({ file: '/bin/claude', args: ['agents', '--json', '--all'], opts: { timeoutMs: 5000 } });
  });

  it('listSessions rejects on non-zero exit', async () => {
    const { run } = fakeRunner({ code: 1, stdout: '', stderr: 'boom' });
    await expect(new CliClient(run, 'claude').listSessions()).rejects.toThrow('boom');
  });

  it('startSession passes name and prompt unmodified as separate args in cwd', async () => {
    const { run, calls } = fakeRunner({ code: 0, stdout: BG_OUTPUT, stderr: '' });
    const prompt = 'a "b" $(rm -rf /)\nc';
    const id = await new CliClient(run, 'claude').startSession({ name: "it's", prompt, cwd: '/tmp/x' });
    expect(id).toBe('f8475127');
    expect(calls[0]).toEqual({
      file: 'claude',
      args: ['--bg', '-n', "it's", '--', prompt],
      opts: { cwd: '/tmp/x', timeoutMs: 30000 },
    });
  });

  it('startSession ends option parsing so a prompt starting with "-" stays a prompt', async () => {
    const { run, calls } = fakeRunner({ code: 0, stdout: BG_OUTPUT, stderr: '' });
    await new CliClient(run, 'claude').startSession({ name: 'n', prompt: '- fix the login bug', cwd: '/x' });
    expect(calls[0]?.args.slice(-2)).toEqual(['--', '- fix the login bug']);
  });

  it('parses the id when the backgrounded line has a trailing note', () => {
    expect(parseBgOutput('backgrounded · e23f6cbb · probe (idle — send a prompt to start)\n')).toBe('e23f6cbb');
  });

  it('startSession surfaces CLI output on failure, trimmed to 300 chars', async () => {
    const msg = 'Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.';
    const { run } = fakeRunner({ code: 1, stdout: msg + 'x'.repeat(400), stderr: '' });
    const err = await new CliClient(run, 'claude').startSession({ name: 'n', prompt: 'p', cwd: '/x' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('Workspace not trusted');
    expect(err.message.length).toBeLessThanOrEqual(300);
  });

  it('stopSession runs stop <shortId>', async () => {
    const { run, calls } = fakeRunner({ code: 0, stdout: '', stderr: '' });
    await new CliClient(run, 'claude').stopSession('f8475127');
    expect(calls[0]?.args).toEqual(['stop', 'f8475127']);
  });
});

describe('resolveClaudePath', () => {
  const base = {
    configured: '',
    exists: (_p: string) => false,
    which: async () => null as string | null,
    loginShell: async () => null as string | null,
  };

  it('prefers a configured path that exists', async () => {
    const p = await resolveClaudePath({ ...base, configured: '/opt/claude', exists: (x) => x === '/opt/claude', which: async () => '/usr/bin/claude' });
    expect(p).toBe('/opt/claude');
  });

  it('ignores a configured path that does not exist and uses which', async () => {
    const p = await resolveClaudePath({ ...base, configured: '/nope', which: async () => '/usr/bin/claude' });
    expect(p).toBe('/usr/bin/claude');
  });

  it('falls back to the login shell', async () => {
    const p = await resolveClaudePath({ ...base, loginShell: async () => '/Users/me/.local/bin/claude' });
    expect(p).toBe('/Users/me/.local/bin/claude');
  });

  it('returns null when nothing is found', async () => {
    expect(await resolveClaudePath(base)).toBeNull();
  });
});
