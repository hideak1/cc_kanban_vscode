// Manual integration check against the real `claude` CLI (not part of `npm test`).
// Run: npm run test:real   — starts one tiny background session in ~/project, then stops and removes it.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildView, createDraft, defaultBoard, promoteDraft, reconcile, sessionCardId } from '../../src/boardModel';
import { CliClient, nodeRunner } from '../../src/cliClient';

const cwd = process.argv[2] ?? join(homedir(), 'project');
const cli = new CliClient(nodeRunner, process.env.CLAUDE_BIN ?? 'claude');

const before = await cli.listSessions();
console.log(`listed ${before.length} sessions; kinds=${[...new Set(before.map((s) => s.kind))].join(',')}`);

let board = createDraft(reconcile(defaultBoard(), before, { pruneMissing: true, startedAfter: 0 }), 'probe', {
  title: 'kanban-integration-probe',
  prompt: 'Reply with exactly OK and nothing else.',
  cwd,
});
const shortId = await cli.startSession({ name: 'kanban-integration-probe', prompt: 'Reply with exactly OK and nothing else.', cwd });
console.log(`started ${shortId}`);
board = promoteDraft(board, 'probe', shortId, Date.now());

let seen = false;
for (let i = 0; i < 20 && !seen; i++) {
  const sessions = await cli.listSessions();
  board = reconcile(board, sessions, { pruneMissing: true, startedAfter: Date.now() - 60_000 });
  const card = buildView(board, sessions).columns.flatMap((c) => c.cards).find((c) => c.id === sessionCardId(shortId));
  if (card) {
    seen = true;
    console.log(`card visible: title=${card.title} status=${card.badge?.label} folder=${card.folder}`);
  } else {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

await cli.stopSession(shortId).catch((e) => console.log(`stop: ${e.message}`));
const rm = await nodeRunner(cli.claudePath, ['rm', shortId], { timeoutMs: 10000 });
console.log(`rm exit=${rm.code}`);

if (!seen) {
  console.error('FAIL: started session never appeared on the board');
  process.exit(1);
}
console.log('PASS: real CLI round-trip (list → start → card visible → stop → rm)');
