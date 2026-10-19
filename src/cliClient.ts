import { execFile } from 'node:child_process';
import type { Session } from './types';

export type Runner = (
  file: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

const LIST_TIMEOUT_MS = 5000;
const START_TIMEOUT_MS = 30000;
const ERROR_MAX_CHARS = 300;

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function shortIdOf(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function parseAgentsJson(stdout: string): Session[] {
  const data: unknown = JSON.parse(stdout);
  if (!Array.isArray(data)) {
    throw new Error('claude agents --json did not return an array');
  }
  const sessions: Session[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.sessionId !== 'string' || r.sessionId === '') continue;
    const shortId = shortIdOf(r.sessionId);
    sessions.push({
      sessionId: r.sessionId,
      shortId,
      name: typeof r.name === 'string' && r.name !== '' ? r.name : shortId,
      cwd: typeof r.cwd === 'string' ? r.cwd : '',
      status: typeof r.status === 'string' ? r.status : null,
      kind: typeof r.kind === 'string' ? r.kind : 'unknown',
      pid: typeof r.pid === 'number' ? r.pid : null,
      startedAt: typeof r.startedAt === 'number' ? r.startedAt : null,
    });
  }
  if (data.length > 0 && sessions.length === 0) {
    // Treat as a failure so the board is not pruned: an unknown format must never wipe placements.
    throw new Error('claude agents --json returned an unrecognised format (no entry has a sessionId)');
  }
  return sessions;
}

export function parseBgOutput(stdout: string): string {
  const text = stripAnsi(stdout);
  const match = /backgrounded\s+·\s+([0-9a-f]+)/i.exec(text) ?? /claude attach\s+(\S+)/.exec(text);
  if (!match?.[1]) {
    throw new Error(`Could not find a session id in claude --bg output: ${text.trim().slice(0, 200)}`);
  }
  return match[1];
}

function failure(result: { stdout: string; stderr: string }, fallback: string): Error {
  const text = stripAnsi(`${result.stderr}\n${result.stdout}`).trim();
  return new Error((text || fallback).slice(0, ERROR_MAX_CHARS));
}

export class CliClient {
  constructor(
    private readonly run: Runner,
    readonly claudePath: string,
  ) {}

  async listSessions(): Promise<Session[]> {
    const result = await this.run(this.claudePath, ['agents', '--json', '--all'], { timeoutMs: LIST_TIMEOUT_MS });
    if (result.code !== 0) throw failure(result, `claude agents exited with code ${result.code}`);
    return parseAgentsJson(result.stdout);
  }

  async startSession(o: { name: string; prompt: string; cwd: string }): Promise<string> {
    // `--` matters: without it, a prompt starting with "-" is silently dropped by the CLI.
    const result = await this.run(this.claudePath, ['--bg', '-n', o.name, '--', o.prompt], {
      cwd: o.cwd,
      timeoutMs: START_TIMEOUT_MS,
    });
    if (result.code !== 0) throw failure(result, `claude --bg exited with code ${result.code}`);
    return parseBgOutput(result.stdout);
  }

  async stopSession(shortId: string): Promise<void> {
    const result = await this.run(this.claudePath, ['stop', shortId], { timeoutMs: LIST_TIMEOUT_MS });
    if (result.code !== 0) throw failure(result, `claude stop exited with code ${result.code}`);
  }
}

export async function resolveClaudePath(d: {
  configured: string;
  exists: (p: string) => boolean;
  which: () => Promise<string | null>;
  /** Well-known install locations, checked when PATH lacks claude (e.g. VS Code launched from the Dock). */
  candidates: string[];
  loginShell: () => Promise<string | null>;
}): Promise<string | null> {
  if (d.configured && d.exists(d.configured)) return d.configured;
  const onPath = await d.which();
  if (onPath) return onPath;
  const known = d.candidates.find((p) => d.exists(p));
  if (known) return known;
  return (await d.loginShell()) ?? null;
}

export const nodeRunner: Runner = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        const extra = error && typeof error.code !== 'number' ? `\n${error.message}` : '';
        resolve({ code, stdout: String(stdout), stderr: String(stderr) + extra });
      },
    );
  });
