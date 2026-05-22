"use strict";

const fs = require("node:fs");
const path = require("node:path");
const madge = require("madge");

function normalizeId(filePath) {
  return filePath.split(path.sep).join("/");
}

function detectProjectConfig(rootPath) {
  const tsConfigPath = path.join(rootPath, "tsconfig.json");
  const jsConfigPath = path.join(rootPath, "jsconfig.json");

  if (fs.existsSync(tsConfigPath)) {
    return { tsConfig: tsConfigPath };
  }
  if (fs.existsSync(jsConfigPath)) {
    return { tsConfig: jsConfigPath };
  }
  return {};
}

function buildTarjan(nodes, edges) {
  const adjacency = new Map();
  nodes.forEach((node) => adjacency.set(node, edges.get(node) || []));

  let index = 0;
  const stack = [];
  const stackSet = new Set();
  const indexMap = new Map();
  const lowLinkMap = new Map();
  const components = [];

  function strongConnect(node) {
    indexMap.set(node, index);
    lowLinkMap.set(node, index);
    index += 1;
    stack.push(node);
    stackSet.add(node);

    for (const next of adjacency.get(node) || []) {
      if (!indexMap.has(next)) {
        strongConnect(next);
        lowLinkMap.set(node, Math.min(lowLinkMap.get(node), lowLinkMap.get(next)));
      } else if (stackSet.has(next)) {
        lowLinkMap.set(node, Math.min(lowLinkMap.get(node), indexMap.get(next)));
      }
    }

    if (lowLinkMap.get(node) === indexMap.get(node)) {
      const component = [];
      while (stack.length > 0) {
        const value = stack.pop();
        stackSet.delete(value);
        component.push(value);
        if (value === node) {
          break;
        }
      }
      components.push(component.sort());
    }
  }

  nodes.forEach((node) => {
    if (!indexMap.has(node)) {
      strongConnect(node);
    }
  });

  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function buildComponentGraph(components, edges) {
  const nodeToComponent = new Map();
  components.forEach((component, index) => {
    const componentId = `component-${index + 1}`;
    component.forEach((node) => nodeToComponent.set(node, componentId));
  });

  const componentMap = new Map();
  components.forEach((component, index) => {
    const id = `component-${index + 1}`;
    componentMap.set(id, {
      id,
      members: component,
      edgesOut: new Set(),
      edgesIn: new Set(),
      isCycle: component.length > 1,
      hasSelfLoop: false,
      layer: 1,
    });
  });

  for (const [from, targets] of edges.entries()) {
    const fromComponentId = nodeToComponent.get(from);
    for (const to of targets) {
      const toComponentId = nodeToComponent.get(to);
      if (!toComponentId || !fromComponentId) {
        continue;
      }
      if (fromComponentId === toComponentId) {
        if (from === to) {
          componentMap.get(fromComponentId).hasSelfLoop = true;
          componentMap.get(fromComponentId).isCycle = true;
        }
        continue;
      }
      componentMap.get(fromComponentId).edgesOut.add(toComponentId);
      componentMap.get(toComponentId).edgesIn.add(fromComponentId);
    }
  }

  const indegree = new Map();
  componentMap.forEach((component, id) => indegree.set(id, component.edgesIn.size));
  const queue = [];
  componentMap.forEach((component, id) => {
    if (component.edgesIn.size === 0) {
      queue.push(id);
    }
  });

  while (queue.length > 0) {
    const id = queue.shift();
    const component = componentMap.get(id);
    for (const nextId of component.edgesOut) {
      const nextComponent = componentMap.get(nextId);
      nextComponent.layer = Math.max(nextComponent.layer, component.layer + 1);
      indegree.set(nextId, indegree.get(nextId) - 1);
      if (indegree.get(nextId) === 0) {
        queue.push(nextId);
      }
    }
  }

  return { componentMap, nodeToComponent };
}

async function analyzeProject(projectPath) {
  const rootPath = path.resolve(projectPath);
  const madgeConfig = {
    baseDir: rootPath,
    includeNpm: false,
    fileExtensions: ["js", "jsx", "ts", "tsx", "mjs", "cjs"],
    excludeRegExp: ["node_modules", "\\.git"],
    ...detectProjectConfig(rootPath),
  };

  const result = await madge(rootPath, madgeConfig);
  const rawTree = result.obj();
  const nodes = new Set();
  const edges = new Map();

  Object.entries(rawTree).forEach(([from, toList]) => {
    const fromId = normalizeId(from);
    nodes.add(fromId);
    const normalizedTargets = (toList || []).map(normalizeId).filter(Boolean);
    edges.set(fromId, normalizedTargets);
    normalizedTargets.forEach((target) => nodes.add(target));
  });

  Array.from(nodes).forEach((node) => {
    if (!edges.has(node)) {
      edges.set(node, []);
    }
  });

  const sortedNodes = Array.from(nodes).sort();
  const incoming = new Map();
  sortedNodes.forEach((node) => incoming.set(node, []));
  edges.forEach((targets, from) => {
    targets.forEach((to) => {
      if (!incoming.has(to)) {
        incoming.set(to, []);
      }
      incoming.get(to).push(from);
    });
  });

  const components = buildTarjan(sortedNodes, edges);
  const { componentMap, nodeToComponent } = buildComponentGraph(components, edges);

  const nodeIndex = {};
  sortedNodes.forEach((id) => {
    const dependencies = Array.from(new Set(edges.get(id) || [])).sort();
    const dependents = Array.from(new Set(incoming.get(id) || [])).sort();
    const component = componentMap.get(nodeToComponent.get(id));
    const isIsolated = dependencies.length === 0 && dependents.length === 0;
    nodeIndex[id] = {
      id,
      label: path.basename(id),
      absolutePath: path.join(rootPath, id),
      layer: component.layer,
      dependencies,
      dependents,
      inDegreeInternal: dependents.length,
      outDegreeInternal: dependencies.length,
      componentId: component.id,
      isCycleMember: component.isCycle,
      isIsolated,
    };
  });

  const componentIndex = {};
  const componentList = Array.from(componentMap.values())
    .map((component) => {
      const inDegree = component.edgesIn.size;
      const outDegree = component.edgesOut.size;
      const members = component.members.slice().sort();
      const nonIsolatedMembers = members.filter((member) => !nodeIndex[member].isIsolated);
      return {
        id: component.id,
        label: component.isCycle ? `${path.basename(members[0])} +${members.length - 1}` : path.basename(members[0]),
        members,
        layer: component.layer,
        isCycle: component.isCycle,
        hasSelfLoop: component.hasSelfLoop,
        inDegree,
        outDegree,
        isIsolated: nonIsolatedMembers.length === 0,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  componentList.forEach((component) => {
    componentIndex[component.id] = component;
  });

  const edgesList = [];
  edges.forEach((targets, from) => {
    targets.forEach((to) => {
      edgesList.push({ from, to });
    });
  });
  edgesList.sort((left, right) => {
    if (left.from === right.from) {
      return left.to.localeCompare(right.to);
    }
    return left.from.localeCompare(right.from);
  });

  const isolated = sortedNodes.filter((id) => nodeIndex[id].isIsolated);
  const roots = componentList
    .filter((component) => !component.isIsolated && component.inDegree === 0)
    .map((component) => component.id);

  return {
    version: 1,
    rootPath,
    generatedAt: new Date().toISOString(),
    stats: {
      nodeCount: sortedNodes.length,
      edgeCount: edgesList.length,
      componentCount: componentList.length,
      cycleCount: componentList.filter((component) => component.isCycle).length,
      isolatedCount: isolated.length,
      rootCount: roots.length,
    },
    nodes: sortedNodes.map((id) => nodeIndex[id]),
    edges: edgesList,
    components: componentList,
    isolated,
    roots,
    nodeIndex,
    componentIndex,
  };
}

module.exports = {
  analyzeProject,
};
