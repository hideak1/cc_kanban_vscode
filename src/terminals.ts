import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { attachCommand } from './shell';

export class Terminals implements vscode.Disposable {
  private readonly byShortId = new Map<string, vscode.Terminal>();
  private readonly onClose: vscode.Disposable;

  constructor() {
    this.onClose = vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, t] of this.byShortId) if (t === closed) this.byShortId.delete(id);
    });
  }

  attach(shortId: string, name: string, cwd: string, claudePath: string): void {
    const existing = this.byShortId.get(shortId);
    if (existing && existing.exitStatus === undefined) {
      existing.show();
      return;
    }
    const terminal = vscode.window.createTerminal({
      name: `Claude: ${name}`,
      cwd: cwd && existsSync(cwd) ? cwd : undefined,
    });
    terminal.sendText(attachCommand(claudePath, shortId));
    terminal.show();
    this.byShortId.set(shortId, terminal);
  }

  dispose(): void {
    this.onClose.dispose();
  }
}
