"use strict";

const vscode = require("vscode");
const { GraphPanelManager } = require("./panel");
const { DepGraphSidebarProvider } = require("./sidebar");

function activate(context) {
  const panelManager = new GraphPanelManager(context);
  const sidebarProvider = new DepGraphSidebarProvider(context, panelManager);

  context.subscriptions.push(
    vscode.commands.registerCommand("depgraph.openGraph", () => panelManager.show()),
    vscode.commands.registerCommand("depgraph.refreshGraph", () => panelManager.refresh()),
    vscode.window.registerWebviewViewProvider("depgraph.sidebar", sidebarProvider),
    panelManager,
    sidebarProvider,
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
