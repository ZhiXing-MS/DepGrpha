"use strict";

const path = require("node:path");
const vscode = require("vscode");

class DepGraphSidebarProvider {
  constructor(context, panelManager) {
    this.context = context;
    this.panelManager = panelManager;
    this.autoOpened = false;
  }

  dispose() {}

  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        if (message?.type === "openGraph") {
          await this.panelManager.show();
        }
        if (message?.type === "refreshGraph") {
          await this.panelManager.refresh();
        }
      },
      undefined,
      this.context.subscriptions,
    );

    webviewView.onDidChangeVisibility(async () => {
      if (webviewView.visible && !this.autoOpened) {
        this.autoOpened = true;
        await this.panelManager.show();
      }
    });
  }

  getHtml(webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "media", "sidebar.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "media", "sidebar.css")));
    const nonce = Date.now().toString(36);

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
  </head>
  <body>
    <div class="sidebar">
      <button id="openGraphButton" class="primary">Open Graph</button>
      <button id="refreshGraphButton" class="secondary">Refresh Graph</button>
      <div class="hint">The graph opens in the editor area. Collapse this sidebar if you do not need it.</div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

module.exports = {
  DepGraphSidebarProvider,
};
