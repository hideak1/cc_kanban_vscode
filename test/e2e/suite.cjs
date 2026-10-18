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
  const ext = vscode.extensions.getExtension('local.claude-kanban');
  assert.ok(ext, 'extension local.claude-kanban is installed in the test host');
  await ext.activate();
  assert.ok(ext.isActive, 'extension activates');

  await vscode.commands.executeCommand('claudeKanban.open');
  const opened = await waitFor(
    () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.label === 'Claude Kanban'),
    5000,
  );
  assert.ok(opened, 'a "Claude Kanban" tab is open after running the command');
  console.log('e2e smoke: extension activated and board tab opened');
};
