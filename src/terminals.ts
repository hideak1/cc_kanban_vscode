import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { attachTerminalOptions } from './shell';

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
    existing?.dispose();
    const terminal = vscode.window.createTerminal(
      attachTerminalOptions({ shortId, name, cwd, claudePath, cwdExists: !!cwd && existsSync(cwd) }),
    );
    terminal.show();
    this.byShortId.set(shortId, terminal);
  }

  dispose(): void {
    this.onClose.dispose();
  }
}
