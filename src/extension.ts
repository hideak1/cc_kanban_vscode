import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { BoardStore } from './boardStore';
import { CliClient, nodeRunner, resolveClaudePath } from './cliClient';
import { Controller } from './controller';
import { BoardPanel } from './panel';
import { Terminals } from './terminals';

const VISIBLE_POLL_MS = 2000;
const HIDDEN_POLL_EVERY = 5; // ticks → 10 s while the board is not visible

async function findClaude(): Promise<string | null> {
  const configured = vscode.workspace.getConfiguration('claudeKanban').get<string>('claudePath', '');
  return resolveClaudePath({
    configured,
    exists: existsSync,
    which: async () => {
      const r = await nodeRunner('/usr/bin/which', ['claude'], { timeoutMs: 3000 });
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    },
    loginShell: async () => {
      const shell = process.env.SHELL || '/bin/zsh';
      const r = await nodeRunner(shell, ['-lc', 'command -v claude'], { timeoutMs: 5000 });
      const line = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/')).at(-1);
      return r.code === 0 && line ? line : null;
    },
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new BoardStore(vscode.Uri.joinPath(context.globalStorageUri, 'board.json').fsPath);
  const terminals = new Terminals();
  let claudePath = await findClaude();

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
          openLabel: '选择工作目录',
        });
        return picked?.[0]?.fsPath ?? null;
      },
      confirm: async (message) => (await vscode.window.showWarningMessage(message, { modal: true }, '删除')) === '删除',
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
  status.tooltip = '打开 Claude Kanban';
  const updateStatus = () => {
    const n = controller.waitingCount;
    status.text = n > 0 ? `$(bell-dot) Claude: ${n} 个等待输入` : '$(layout) Claude';
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

  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    if (BoardPanel.isVisible() || ticks % HIDDEN_POLL_EVERY === 0) void tick();
  }, VISIBLE_POLL_MS);

  const watcher = store.watch((b) => controller.setBoard(b));

  context.subscriptions.push(
    terminals,
    status,
    watcher,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('claudeKanban.open', () => {
      BoardPanel.show(context.extensionUri, (m) => controller.handle(m).then(updateStatus), () => void tick());
      void tick();
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('claudeKanban.claudePath')) return;
      claudePath = await findClaude();
      controller.setCli(claudePath ? new CliClient(nodeRunner, claudePath) : null);
      void tick();
    }),
  );

  updateStatus();
  void tick();
}

export function deactivate(): void {}
