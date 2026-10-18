import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ToHost, ToWebview } from './types';

export class BoardPanel {
  private static current: BoardPanel | undefined;

  static show(
    extensionUri: vscode.Uri,
    onMessage: (m: ToHost) => Promise<void>,
    onVisible: () => void,
  ): void {
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal();
      return;
    }
    BoardPanel.current = new BoardPanel(extensionUri, onMessage, onVisible);
  }

  static post(m: ToWebview): void {
    void BoardPanel.current?.panel.webview.postMessage(m);
  }

  static isVisible(): boolean {
    return BoardPanel.current?.panel.visible ?? false;
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    extensionUri: vscode.Uri,
    onMessage: (m: ToHost) => Promise<void>,
    onVisible: () => void,
  ) {
    const dist = vscode.Uri.joinPath(extensionUri, 'dist');
    this.panel = vscode.window.createWebviewPanel('claudeKanban', 'Claude Kanban', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    this.panel.webview.html = this.html(dist);
    this.panel.webview.onDidReceiveMessage((m: ToHost) => {
      onMessage(m).catch((e: unknown) => {
        void vscode.window.showErrorMessage(`Claude Kanban: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.panel.onDidChangeViewState(() => {
      if (this.panel.visible) onVisible();
    });
    this.panel.onDidDispose(() => {
      BoardPanel.current = undefined;
    });
  }

  private html(dist: vscode.Uri): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'style.css'));
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<title>Claude Kanban</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
