# DepGraph

`DepGraph` is a VS Code extension plus CLI for exploring file-to-file dependencies inside a project.

## What It Does

- Extracts internal file dependencies with `madge`
- Collapses circular references into clusters
- Computes a longest-path radius ranking from graph center to edge
- Opens an expandable graph view in the editor
- Keeps isolated files in a separate bottom-right group
- Exposes machine-friendly JSON through the CLI

## VS Code

After installing the extension:

- Open the `DepGraph` icon in the Activity Bar
- The sidebar opens and can launch the main graph into the editor area
- Use the refresh button in the graph header to recompute the project graph
- Single click expands missing direct dependencies, or highlights the dependency chain if already expanded
- Double click opens the file

For local development in this repository, open the folder in VS Code and press `F5` to launch an Extension Development Host.

## CLI

```bash
depgraph analyze . --pretty
depgraph file src/extension.js --pretty
depgraph expand src/extension.js --pretty
depgraph cycles --pretty
```

Use `--json` for compact machine output or `--pretty` for indented JSON.
