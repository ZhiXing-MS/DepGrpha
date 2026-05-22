"use strict";

const path = require("node:path");
const vscode = require("vscode");
const { analyzeProject } = require("./core/analyze");

class GraphPanelManager {
  constructor(context) {
    this.context = context;
    this.panel = undefined;
    this.latestGraph = undefined;
    this.onDidUpdateGraphEmitter = new vscode.EventEmitter();
    this.onDidUpdateGraph = this.onDidUpdateGraphEmitter.event;
  }

  dispose() {
    this.onDidUpdateGraphEmitter.dispose();
    if (this.panel) {
      this.panel.dispose();
    }
  }

  getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (activeFile) {
      const match = folders.find((folder) => activeFile.startsWith(folder.uri.fsPath));
      if (match) {
        return match.uri.fsPath;
      }
    }
    return folders[0].uri.fsPath;
  }

  getLatestGraph() {
    return this.latestGraph;
  }

  async show() {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage("DepGraph needs an open workspace folder.");
      return;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, true);
      await this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "depgraph.graph",
      "DepGraph",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, "media", "activity.svg"));
    this.panel.webview.html = this.getPanelHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message?.type === "ready") {
          await this.refresh();
          return;
        }
        if (message?.type === "refresh") {
          await this.refresh();
          return;
        }
        if (message?.type === "openFile" && typeof message.filePath === "string") {
          await this.openFile(message.filePath);
        }
      },
      undefined,
      this.context.subscriptions,
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.context.subscriptions,
    );
  }

  async refresh() {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    try {
      const graph = await analyzeProject(workspaceRoot);
      this.latestGraph = graph;
      this.onDidUpdateGraphEmitter.fire(graph);
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "graphData",
          graph,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`DepGraph refresh failed: ${message}`);
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "graphError",
          message,
        });
      }
    }
  }

  async openFile(filePath) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  getPanelHtml(webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "media", "panel.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "media", "panel.css")));
    const nonce = Date.now().toString(36);

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>DepGraph</title>
  </head>
  <body>
    <div id="app">
      <div class="toolbar">
        <div>
          <div class="title">DepGraph</div>
          <div class="subtitle" id="subtitle">Waiting for graph data…</div>
        </div>
        <button class="icon-button" id="refreshButton" title="Refresh graph" aria-label="Refresh graph">
          ↻
        </button>
      </div>
      <div class="canvas-wrap">
        <canvas id="graphCanvas"></canvas>
        <div id="emptyState" class="empty-state">Computing project graph…</div>
        <div id="hoverCard" class="hover-card hidden"></div>
        <div id="isolatedDock" class="isolated-dock hidden">
          <button id="isolatedToggle" class="isolated-toggle" type="button" aria-expanded="false" title="Toggle isolated files">
            <span class="isolated-toggle-icon">◎</span>
            <span>Isolated</span>
            <span id="isolatedBadge" class="isolated-badge">0</span>
          </button>
          <div id="isolatedDrawer" class="isolated-drawer hidden">
            <div class="isolated-header">
              <div>Isolated</div>
              <div id="isolatedCount" class="isolated-count"></div>
            </div>
            <div id="isolatedList" class="isolated-list"></div>
          </div>
        </div>
      </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

module.exports = {
  GraphPanelManager,
};
