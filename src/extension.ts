import { randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { BoardStore } from './boardStore';
import { CliClient, nodeRunner, resolveClaudePath } from './cliClient';
import { Controller } from './controller';
import { BoardPanel } from './panel';
import { Terminals } from './terminals';

const VISIBLE_POLL_MS = 2000;
const HIDDEN_POLL_EVERY = 5; // ticks → 10 s while the board is not visible

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** File checks only; never spawns a shell or other process. */
function findClaude(): string | null {
  return resolveClaudePath({
    configured: vscode.workspace.getConfiguration('claudeKanban').get<string>('claudePath', ''),
    pathEnv: process.env.PATH ?? '',
    candidates: [
      join(homedir(), '.local/bin/claude'),
      join(homedir(), '.claude/local/claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ],
    isExecutable,
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new BoardStore(vscode.Uri.joinPath(context.globalStorageUri, 'board.json').fsPath);
  const terminals = new Terminals();
  let claudePath = findClaude();

  const controller = new Controller({
    cli: claudePath ? new CliClient(nodeRunner, claudePath) : null,
    store,
    ui: {
      attach: (shortId, name, cwd) => {
        if (claudePath) terminals.attach(shortId, name, cwd, claudePath);
      },
      pickFolder: async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Choose working folder',
        });
        return picked?.[0]?.fsPath ?? null;
      },
      confirm: async (message) => (await vscode.window.showWarningMessage(message, { modal: true }, 'Delete')) === 'Delete',
      showError: (m) => void vscode.window.showErrorMessage(m),
      showInfo: (m) => void vscode.window.showInformationMessage(m),
    },
    post: (m) => BoardPanel.post(m),
    defaultCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
    newId: () => randomUUID().slice(0, 8),
    now: () => Date.now(),
  });

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'claudeKanban.open';
  status.tooltip = 'Open Agent Session Kanban';
  const updateStatus = () => {
    const n = controller.waitingCount;
    status.text = n > 0 ? `$(bell-dot) Claude: ${n} need${n === 1 ? 's' : ''} input` : '$(layout) Claude';
    status.backgroundColor = n > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    status.show();
  };

  let refreshing = false;
  const tick = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await controller.refresh();
      updateStatus();
    } finally {
      refreshing = false;
    }
  };

  // Nothing runs until the user opens the board: the first open starts polling the CLI.
  let timer: ReturnType<typeof setInterval> | undefined;
  const startPolling = () => {
    if (timer) return;
    let ticks = 0;
    timer = setInterval(() => {
      ticks++;
      if (BoardPanel.isVisible() || ticks % HIDDEN_POLL_EVERY === 0) void tick();
    }, VISIBLE_POLL_MS);
  };

  const watcher = store.watch((b) => controller.setBoard(b));

  context.subscriptions.push(
    terminals,
    status,
    watcher,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('claudeKanban.open', () => {
      BoardPanel.show(context.extensionUri, (m) => controller.handle(m).then(updateStatus), () => void tick());
      startPolling();
      void tick();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('claudeKanban.claudePath')) return;
      claudePath = findClaude();
      controller.setCli(claudePath ? new CliClient(nodeRunner, claudePath) : null);
      if (timer) void tick();
    }),
  );

  updateStatus();
}

export function deactivate(): void {}
