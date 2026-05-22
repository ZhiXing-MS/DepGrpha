"use strict";

const path = require("node:path");
const { analyzeProject } = require("./core/analyze");

function printHelp() {
  const message = [
    "Usage:",
    "  depgraph analyze [path] [--json|--pretty]",
    "  depgraph file <file> [--json|--pretty]",
    "  depgraph expand <file> [--json|--pretty]",
    "  depgraph cycles [path] [--json|--pretty]",
  ].join("\n");
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((value) => value.startsWith("--")));
  const positionals = args.filter((value) => !value.startsWith("--"));
  return {
    command: positionals[0] || "analyze",
    target: positionals[1],
    flags,
  };
}

function formatOutput(value, flags) {
  if (flags.has("--pretty")) {
    return JSON.stringify(value, null, 2);
  }
  if (flags.has("--json")) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, null, 2);
}

function toRelativeId(rootPath, filePath) {
  const absolutePath = path.resolve(filePath);
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

async function run() {
  const { command, target, flags } = parseArgs(process.argv);
  if (flags.has("--help") || flags.has("-h")) {
    printHelp();
    return;
  }

  const projectPath = command === "file" || command === "expand"
    ? process.cwd()
    : path.resolve(target || process.cwd());

  const graph = await analyzeProject(projectPath);

  let payload;
  if (command === "analyze") {
    payload = graph;
  } else if (command === "cycles") {
    payload = {
      rootPath: graph.rootPath,
      generatedAt: graph.generatedAt,
      cycles: graph.components.filter((component) => component.isCycle),
    };
  } else if (command === "file") {
    if (!target) {
      throw new Error("Missing file argument for 'file' command.");
    }
    const fileId = toRelativeId(graph.rootPath, target);
    const node = graph.nodeIndex[fileId];
    if (!node) {
      throw new Error(`File not found in graph: ${fileId}`);
    }
    payload = {
      rootPath: graph.rootPath,
      generatedAt: graph.generatedAt,
      file: node,
      dependencies: node.dependencies.map((id) => graph.nodeIndex[id]),
      dependents: node.dependents.map((id) => graph.nodeIndex[id]),
      component: graph.componentIndex[node.componentId],
    };
  } else if (command === "expand") {
    if (!target) {
      throw new Error("Missing file argument for 'expand' command.");
    }
    const fileId = toRelativeId(graph.rootPath, target);
    const node = graph.nodeIndex[fileId];
    if (!node) {
      throw new Error(`File not found in graph: ${fileId}`);
    }
    payload = {
      rootPath: graph.rootPath,
      generatedAt: graph.generatedAt,
      file: node,
      directDependencies: node.dependencies.map((id) => graph.nodeIndex[id]),
    };
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  process.stdout.write(`${formatOutput(payload, flags)}\n`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
