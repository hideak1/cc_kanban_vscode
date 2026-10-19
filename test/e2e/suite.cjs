const assert = require('node:assert');
const vscode = require('vscode');

async function waitFor(check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

exports.run = async function run() {
  // Count every child process the extension host starts, so we can prove activation alone spawns nothing.
  const cp = require('node:child_process');
  const spawned = [];
  for (const fn of ['spawn', 'execFile', 'exec', 'fork']) {
    const original = cp[fn];
    cp[fn] = function (file, ...rest) {
      spawned.push(`${fn} ${file}`);
      return original.call(this, file, ...rest);
    };
  }

  const ext = vscode.extensions.getExtension('hideaki.agent-session-board');
  assert.ok(ext, 'extension hideaki.agent-session-board is installed in the test host');
  await ext.activate();
  assert.ok(ext.isActive, 'extension activates');
  await new Promise((r) => setTimeout(r, 3000));
  assert.deepStrictEqual(spawned, [], 'activating the extension must not start any process');

  await vscode.commands.executeCommand('claudeKanban.open');
  const opened = await waitFor(
    () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.label === 'Agent Session Kanban'),
    5000,
  );
  assert.ok(opened, 'a "Agent Session Kanban" tab is open after running the command');
  console.log(`e2e smoke: activation spawned nothing; board tab opened; processes after opening: ${spawned.length}`);
};
