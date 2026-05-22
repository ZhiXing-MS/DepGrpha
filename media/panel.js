(function () {
  const VIEWBOX_WIDTH = 1600;
  const VIEWBOX_HEIGHT = 900;
  const DOUBLE_CLICK_MS = 280;
  const palette = {
    edge: "rgba(168, 190, 214, 0.34)",
    edgeDim: "rgba(168, 190, 214, 0.06)",
    edgeOutgoing: "#22d3ee",
    edgeIncoming: "#f59e0b",
    edgeBidirectional: "#c08cff",
    edgeFocus: "#f8fafc",
    nodeStroke: "rgba(140, 170, 196, 0.34)",
    nodeFill: "rgba(17, 24, 39, 0.18)",
    rootStroke: "#dbe7f4",
    rootFill: "rgba(219, 231, 244, 0.08)",
    cycleStroke: "#d9b8ff",
    cycleFill: "rgba(127, 86, 217, 0.14)",
    anchorStroke: "#f8fafc",
    anchorFill: "rgba(248, 250, 252, 0.18)",
    outgoingStroke: "#22d3ee",
    outgoingFill: "rgba(34, 211, 238, 0.18)",
    incomingStroke: "#f59e0b",
    incomingFill: "rgba(245, 158, 11, 0.18)",
    bidirectionalStroke: "#c08cff",
    bidirectionalFill: "rgba(192, 140, 255, 0.18)",
    nodeDimAlpha: 0.16,
  };

  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById("graphCanvas");
  const canvasWrap = document.querySelector(".canvas-wrap");
  const context = canvas.getContext("2d");
  const subtitle = document.getElementById("subtitle");
  const emptyState = document.getElementById("emptyState");
  const refreshButton = document.getElementById("refreshButton");
  const hoverCard = document.getElementById("hoverCard");
  const isolatedDock = document.getElementById("isolatedDock");
  const isolatedToggle = document.getElementById("isolatedToggle");
  const isolatedBadge = document.getElementById("isolatedBadge");
  const isolatedDrawer = document.getElementById("isolatedDrawer");
  const isolatedCount = document.getElementById("isolatedCount");
  const isolatedList = document.getElementById("isolatedList");

  let layoutScene = null;
  let renderQueued = false;
  let layoutDirty = true;
  let focusDirty = true;
  let devicePixelRatioValue = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let isPanning = false;
  let lastPointer = null;
  let downNodeId = null;
  let downPointer = null;
  let singleClickTimer = null;
  let lastClick = null;

  const state = Object.assign(
    {
      graph: null,
      visibleComponents: [],
      expandedComponents: [],
      hoveredId: null,
      focusedChain: [],
      pinnedId: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      isolatedOpen: false,
      visibilityPreset: "all-non-isolated",
    },
    vscode.getState() || {},
  );

  refreshButton.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  isolatedToggle.addEventListener("click", () => {
    state.isolatedOpen = !state.isolatedOpen;
    updateIsolatedDrawer();
    saveState();
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    requestRender();
  });

  canvas.addEventListener("pointerdown", (event) => {
    const point = screenToWorld(event.clientX, event.clientY);
    const hitNode = hitTest(point.x, point.y);
    downNodeId = hitNode ? hitNode.id : null;
    downPointer = { x: event.clientX, y: event.clientY };

    if (hitNode) {
      return;
    }

    isPanning = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    hoverCard.classList.add("hidden");
    canvas.classList.add("grabbing");
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (isPanning && lastPointer) {
      state.panX += event.clientX - lastPointer.x;
      state.panY += event.clientY - lastPointer.y;
      lastPointer = { x: event.clientX, y: event.clientY };
      requestRender();
      return;
    }

    const point = screenToWorld(event.clientX, event.clientY);
    const hitNode = hitTest(point.x, point.y);
    const hoveredId = hitNode ? hitNode.id : null;
    if (hoveredId !== state.hoveredId) {
      state.hoveredId = hoveredId;
      focusDirty = true;
      requestRender();
    }
  });

  canvas.addEventListener("pointerleave", () => {
    if (isPanning) {
      return;
    }
    if (state.hoveredId !== null) {
      state.hoveredId = null;
      focusDirty = true;
      requestRender();
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (isPanning) {
      const moved = downPointer
        ? Math.hypot(event.clientX - downPointer.x, event.clientY - downPointer.y) > 4
        : false;
      isPanning = false;
      lastPointer = null;
      downPointer = null;
      downNodeId = null;
      canvas.classList.remove("grabbing");
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture release failures.
      }
      if (!moved && (state.pinnedId !== null || state.focusedChain.length > 0)) {
        state.pinnedId = null;
        state.focusedChain = [];
        focusDirty = true;
        requestRender({ focus: true });
      }
      saveState();
      return;
    }

    const point = screenToWorld(event.clientX, event.clientY);
    const hitNode = hitTest(point.x, point.y);
    const moved = downPointer
      ? Math.hypot(event.clientX - downPointer.x, event.clientY - downPointer.y) > 4
      : false;

    if (!hitNode || moved || hitNode.id !== downNodeId) {
      downNodeId = null;
      downPointer = null;
      return;
    }

    downNodeId = null;
    downPointer = null;

    if (event.altKey && hitNode.isCycleMember) {
      handlePrimaryNodeAction(hitNode, { collapseCycle: true });
      return;
    }

    if (!hitNode.openFilePath) {
      handlePrimaryNodeAction(hitNode);
      return;
    }

    if (singleClickTimer) {
      clearTimeout(singleClickTimer);
      singleClickTimer = null;
    }

    const now = Date.now();
    if (lastClick && lastClick.nodeId === hitNode.id && now - lastClick.timestamp < DOUBLE_CLICK_MS) {
      lastClick = null;
      openNodeFile(hitNode);
      return;
    }

    lastClick = {
      nodeId: hitNode.id,
      timestamp: now,
    };

    singleClickTimer = window.setTimeout(() => {
      singleClickTimer = null;
      handlePrimaryNodeAction(hitNode, { collapseCycle: event.altKey });
    }, DOUBLE_CLICK_MS);
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const before = screenToWorld(event.clientX, event.clientY);
      const delta = event.deltaY > 0 ? 0.92 : 1.08;
      const nextZoom = Math.max(0.005, Math.min(64, state.zoom * delta));
      state.zoom = nextZoom;
      state.panX = event.clientX - canvas.getBoundingClientRect().left - (before.x * state.zoom);
      state.panY = event.clientY - canvas.getBoundingClientRect().top - (before.y * state.zoom);
      requestRender();
      saveState();
    },
    { passive: false },
  );

  function resizeCanvas() {
    const rect = canvasWrap.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(rect.width));
    const nextHeight = Math.max(1, Math.floor(rect.height));
    const nextDpr = window.devicePixelRatio || 1;

    if (nextWidth === cssWidth && nextHeight === cssHeight && nextDpr === devicePixelRatioValue) {
      return;
    }

    cssWidth = nextWidth;
    cssHeight = nextHeight;
    devicePixelRatioValue = nextDpr;
    canvas.width = Math.max(1, Math.floor(cssWidth * devicePixelRatioValue));
    canvas.height = Math.max(1, Math.floor(cssHeight * devicePixelRatioValue));
  }

  function saveState() {
    vscode.setState({
      visibleComponents: state.visibleComponents,
      expandedComponents: state.expandedComponents,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      isolatedOpen: state.isolatedOpen,
      pinnedId: state.pinnedId,
      visibilityPreset: state.visibilityPreset,
    });
  }

  function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  }

  function folderKeyForFile(fileId) {
    const index = fileId.lastIndexOf("/");
    return index === -1 ? "." : fileId.slice(0, index);
  }

  function commonFolderKey(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return ".";
    }
    const parts = fileIds.map((fileId) => {
      const folder = folderKeyForFile(fileId);
      return folder === "." ? [] : folder.split("/");
    });
    const prefix = parts[0].slice();
    for (let index = 1; index < parts.length; index += 1) {
      while (prefix.length > 0 && prefix.some((part, partIndex) => parts[index][partIndex] !== part)) {
        prefix.pop();
      }
    }
    return prefix.length > 0 ? prefix.join("/") : ".";
  }

  function parentFolderKey(folderKey) {
    if (!folderKey || folderKey === ".") {
      return null;
    }
    const index = folderKey.lastIndexOf("/");
    return index === -1 ? "." : folderKey.slice(0, index);
  }

  function normalizeAngle(angle) {
    const tau = Math.PI * 2;
    let value = angle % tau;
    if (value < 0) {
      value += tau;
    }
    return value;
  }

  function meanAngle(angles) {
    if (!angles || angles.length === 0) {
      return 0;
    }
    const x = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
    const y = angles.reduce((sum, angle) => sum + Math.sin(angle), 0);
    return normalizeAngle(Math.atan2(y, x));
  }

  function weightedMeanAngle(entries) {
    if (!entries || entries.length === 0) {
      return 0;
    }
    const x = entries.reduce((sum, entry) => sum + (Math.cos(entry.angle) * entry.weight), 0);
    const y = entries.reduce((sum, entry) => sum + (Math.sin(entry.angle) * entry.weight), 0);
    return normalizeAngle(Math.atan2(y, x));
  }

  function angleDelta(from, to) {
    const tau = Math.PI * 2;
    let delta = normalizeAngle(from) - normalizeAngle(to);
    if (delta > Math.PI) {
      delta -= tau;
    }
    if (delta < -Math.PI) {
      delta += tau;
    }
    return delta;
  }

  function nearestKnownFolderAngle(folderKey, folderAngles) {
    let current = folderKey;
    while (current) {
      if (folderAngles.has(current)) {
        return folderAngles.get(current);
      }
      current = parentFolderKey(current);
    }
    return null;
  }

  function graphIndex(graph) {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const components = new Map(graph.components.map((component) => [component.id, component]));
    const edgesByFrom = new Map();
    const incomingByTo = new Map();

    graph.edges.forEach((edge) => {
      if (!edgesByFrom.has(edge.from)) {
        edgesByFrom.set(edge.from, []);
      }
      if (!incomingByTo.has(edge.to)) {
        incomingByTo.set(edge.to, []);
      }
      edgesByFrom.get(edge.from).push(edge.to);
      incomingByTo.get(edge.to).push(edge.from);
    });

    return { nodes, components, edgesByFrom, incomingByTo };
  }

  function ensureInitialVisibility(graph) {
    if (!graph) {
      return;
    }

    const validIds = new Set(graph.components.map((component) => component.id));
    state.visibleComponents = (state.visibleComponents || []).filter((id) => validIds.has(id));
    state.expandedComponents = (state.expandedComponents || []).filter((id) => validIds.has(id));

    if (state.visibilityPreset !== "all-non-isolated") {
      state.visibleComponents = [];
      state.expandedComponents = [];
      state.visibilityPreset = "all-non-isolated";
    }

    if (state.visibleComponents.length === 0) {
      state.visibleComponents = graph.components
        .filter((component) => !component.isIsolated)
        .map((component) => component.id);
    }
  }

  function isGraphExpanded(graph) {
    const visibleSet = new Set(state.visibleComponents);
    const expandedSet = new Set(state.expandedComponents);

    return graph.components
      .filter((component) => !component.isIsolated)
      .every((component) => visibleSet.has(component.id) && (!component.isCycle || expandedSet.has(component.id)));
  }

  function collapseWeight(component, indexed) {
    const members = new Set(component.members);
    const importers = new Set();

    component.members.forEach((member) => {
      const node = indexed.nodes.get(member);
      (node.dependents || []).forEach((dependent) => {
        if (!members.has(dependent)) {
          importers.add(dependent);
        }
      });
    });

    return importers.size;
  }

  function buildDisplayData(graph) {
    const indexed = graphIndex(graph);
    const visibleComponentSet = new Set(state.visibleComponents);
    const expandedComponentSet = new Set(state.expandedComponents);
    const displayNodes = [];
    const fileToDisplay = new Map();
    const componentNodeId = new Map();

    graph.components.forEach((component) => {
      if (component.isIsolated || !visibleComponentSet.has(component.id)) {
        return;
      }

      if (component.isCycle && !expandedComponentSet.has(component.id)) {
        const nodeId = `component:${component.id}`;
        componentNodeId.set(component.id, nodeId);
        displayNodes.push({
          id: nodeId,
          type: "cluster",
          componentId: component.id,
          hoverText: `${component.label} (${component.members.length} files)`,
          folderKey: commonFolderKey(component.members),
          layer: component.layer,
          weight: collapseWeight(component, indexed),
          openFilePath: null,
          sourceMembers: component.members.slice(),
          isCycleMember: false,
          isRoot: component.inDegree === 0,
        });
        return;
      }

      component.members.forEach((member) => {
        const node = indexed.nodes.get(member);
        const nodeId = `file:${member}`;
        fileToDisplay.set(member, nodeId);
        componentNodeId.set(component.id, nodeId);
        displayNodes.push({
          id: nodeId,
          type: "file",
          componentId: component.id,
          fileId: member,
          hoverText: member,
          folderKey: folderKeyForFile(member),
          layer: node.layer,
          weight: node.inDegreeInternal,
          openFilePath: node.absolutePath,
          sourceMembers: [member],
          isCycleMember: component.isCycle,
          isRoot: node.inDegreeInternal === 0,
        });
      });
    });

    const maxWeight = Math.max(1, ...displayNodes.map((node) => node.weight));
    displayNodes.forEach((node) => {
      const minRadius = node.type === "cluster" ? 18 : 5;
      const maxRadius = node.type === "cluster" ? 48 : 40;
      const normalized = Math.max(0, node.weight) / maxWeight;
      const scaled = normalized === 0 ? 0 : Math.pow(normalized, 0.42);
      node.size = minRadius + (scaled * (maxRadius - minRadius));
    });

    function resolveDisplayForFile(fileId) {
      const componentId = indexed.nodes.get(fileId).componentId;
      const component = indexed.components.get(componentId);
      if (component.isCycle && !expandedComponentSet.has(componentId)) {
        return componentNodeId.get(componentId) || `component:${componentId}`;
      }
      return fileToDisplay.get(fileId);
    }

    const edgeMap = new Map();
    graph.edges.forEach((edge) => {
      const fromNode = indexed.nodes.get(edge.from);
      const toNode = indexed.nodes.get(edge.to);
      if (!fromNode || !toNode) {
        return;
      }
      if (!visibleComponentSet.has(fromNode.componentId) || !visibleComponentSet.has(toNode.componentId)) {
        return;
      }
      const fromDisplay = resolveDisplayForFile(edge.from);
      const toDisplay = resolveDisplayForFile(edge.to);
      if (!fromDisplay || !toDisplay || fromDisplay === toDisplay) {
        return;
      }
      const key = `${fromDisplay}->${toDisplay}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          id: key,
          from: fromDisplay,
          to: toDisplay,
          filePairs: [],
        });
      }
      edgeMap.get(key).filePairs.push({
        fromFile: edge.from,
        toFile: edge.to,
      });
    });

    return {
      indexed,
      displayNodes,
      displayEdges: Array.from(edgeMap.values()),
      resolveDisplayForFile,
    };
  }

  function collectDescendants(graph, startFileIds) {
    const indexed = graphIndex(graph);
    const visited = new Set();
    const stack = startFileIds.slice();

    while (stack.length > 0) {
      const fileId = stack.pop();
      if (visited.has(fileId)) {
        continue;
      }
      visited.add(fileId);
      (indexed.edgesByFrom.get(fileId) || []).forEach((next) => {
        if (!visited.has(next)) {
          stack.push(next);
        }
      });
    }

    return visited;
  }

  function collectOneHop(graph, sourceFileIds) {
    const indexed = graphIndex(graph);
    const focusFiles = new Set(sourceFileIds);
    sourceFileIds.forEach((fileId) => {
      (indexed.edgesByFrom.get(fileId) || []).forEach((target) => focusFiles.add(target));
      (indexed.incomingByTo.get(fileId) || []).forEach((source) => focusFiles.add(source));
    });
    return focusFiles;
  }

  function directDependencyComponents(display, sourceFileIds) {
    const componentIds = new Set();
    sourceFileIds.forEach((fileId) => {
      const fileNode = display.indexed.nodes.get(fileId);
      (fileNode.dependencies || []).forEach((dependency) => {
        const dependencyNode = display.indexed.nodes.get(dependency);
        if (dependencyNode) {
          componentIds.add(dependencyNode.componentId);
        }
      });
    });
    return Array.from(componentIds);
  }

  function nodeAnchor(node, incomingEdgesByTarget, positions) {
    const incomingEdges = incomingEdgesByTarget.get(node.id) || [];
    const incomingAngles = incomingEdges
      .map((edge) => positions.get(edge.from))
      .filter(Boolean)
      .map((position) => position.angle);

    if (incomingAngles.length === 0) {
      return (hashString(node.id) % 360) * (Math.PI / 180);
    }

    const sum = incomingAngles.reduce((total, angle) => total + angle, 0);
    return sum / incomingAngles.length;
  }

  function layout(displayNodes, displayEdges) {
    const centerX = VIEWBOX_WIDTH / 2;
    const centerY = VIEWBOX_HEIGHT / 2;
    const layers = new Map();
    const incomingEdgesByTarget = new Map();
    const positions = new Map();
    const folderAngles = new Map();

    displayNodes.forEach((node) => {
      if (!layers.has(node.layer)) {
        layers.set(node.layer, []);
      }
      layers.get(node.layer).push(node);
    });

    displayEdges.forEach((edge) => {
      if (!incomingEdgesByTarget.has(edge.to)) {
        incomingEdgesByTarget.set(edge.to, []);
      }
      incomingEdgesByTarget.get(edge.to).push(edge);
    });

    const orderedLayers = Array.from(layers.keys()).sort((left, right) => left - right);
    orderedLayers.forEach((layer) => {
      const nodes = layers.get(layer).slice();
      const folderGroups = new Map();
      nodes.forEach((node) => {
        if (!folderGroups.has(node.folderKey)) {
          folderGroups.set(node.folderKey, []);
        }
        folderGroups.get(node.folderKey).push(node);
      });

      const groups = Array.from(folderGroups.entries()).map(([folderKey, folderNodes]) => {
        folderNodes.sort((left, right) => nodeAnchor(left, incomingEdgesByTarget, positions) - nodeAnchor(right, incomingEdgesByTarget, positions));
        const anchorAngles = folderNodes.map((node) => nodeAnchor(node, incomingEdgesByTarget, positions));
        const inheritedAngle = nearestKnownFolderAngle(folderKey, folderAngles);
        const seedAngle = inheritedAngle ?? ((hashString(folderKey) % 360) * (Math.PI / 180));
        const preferredAngle = weightedMeanAngle([
          { angle: seedAngle, weight: inheritedAngle === null ? 4 : 9 },
          ...anchorAngles.map((angle) => ({ angle, weight: 1 })),
        ]);
        return {
          folderKey,
          nodes: folderNodes,
          preferredAngle,
        };
      });

      groups.sort((left, right) => left.preferredAngle - right.preferredAngle);

      const radius = 96 + ((layer - 1) * 124);
      let lastAssigned = null;
      groups.forEach((group, groupIndex) => {
        const span = Math.max(0.1, Math.min(0.54, 0.045 * group.nodes.length));
        let baseAngle = group.preferredAngle;
        if (groupIndex === 0) {
          baseAngle = normalizeAngle(baseAngle);
        } else if (lastAssigned !== null) {
          const minGap = (span / 2) + 0.06;
          if (baseAngle - lastAssigned < minGap) {
            baseAngle = lastAssigned + minGap;
          }
        }
        group.baseAngle = baseAngle;
        lastAssigned = baseAngle + (span / 2);
      });

      groups.forEach((group) => {
        const localStep = group.nodes.length <= 1
          ? 0
          : Math.min(0.055, Math.max(0.014, (0.22 / group.nodes.length)));
        const centerIndex = (group.nodes.length - 1) / 2;

        group.nodes.forEach((node, index) => {
          const anchor = nodeAnchor(node, incomingEdgesByTarget, positions);
          const offset = (index - centerIndex) * localStep;
          const angle = group.baseAngle + offset + (angleDelta(anchor, group.baseAngle) * 0.035);
          const radialOffset = (index - centerIndex) * Math.min(12, 2.2 + (group.nodes.length * 0.22));
          const adjustedRadius = radius + radialOffset;
          positions.set(node.id, {
            x: centerX + (Math.cos(angle) * adjustedRadius),
            y: centerY + (Math.sin(angle) * adjustedRadius * 0.74),
            angle,
          });
        });

        folderAngles.set(
          group.folderKey,
          weightedMeanAngle([
            { angle: group.baseAngle, weight: 8 },
            ...group.nodes
              .map((node) => positions.get(node.id)?.angle)
              .filter((angle) => angle !== undefined)
              .map((angle) => ({ angle, weight: 1 })),
          ]),
        );
      });
    });

    orderedLayers.forEach((layer) => {
      const nodes = layers.get(layer).slice();
      for (let pass = 0; pass < 14; pass += 1) {
        for (let index = 0; index < nodes.length; index += 1) {
          for (let inner = index + 1; inner < nodes.length; inner += 1) {
            const left = positions.get(nodes[index].id);
            const right = positions.get(nodes[inner].id);
            const dx = right.x - left.x;
            const dy = right.y - left.y;
            const distance = Math.sqrt((dx * dx) + (dy * dy)) || 1;
            const minDistance = nodes[index].size + nodes[inner].size + 18;
            if (distance >= minDistance) {
              continue;
            }
            const shift = (minDistance - distance) / 2;
            const unitX = dx / distance;
            const unitY = dy / distance;
            right.x += unitX * shift;
            right.y += unitY * shift;
            left.x -= unitX * shift;
            left.y -= unitY * shift;
          }
        }
      }
    });

    return positions;
  }

  function computeFocus(display, graph) {
    const focusedDisplayIds = new Set();
    const hoveredDisplayIds = new Set();
    const focusedEdges = new Set();
    const nodeRelations = new Map();
    const edgeRelations = new Map();

    function addNodeRelation(nodeId, relation) {
      if (!nodeId) {
        return;
      }
      const current = nodeRelations.get(nodeId);
      if (!current) {
        nodeRelations.set(nodeId, relation);
        return;
      }
      if (current === relation || current === "anchor") {
        return;
      }
      if (relation === "anchor") {
        nodeRelations.set(nodeId, relation);
        return;
      }
      nodeRelations.set(nodeId, "bidirectional");
    }

    if (state.focusedChain.length > 0) {
      const focusedFiles = new Set(state.focusedChain);
      focusedFiles.forEach((fileId) => {
        const displayId = display.resolveDisplayForFile(fileId);
        if (displayId) {
          focusedDisplayIds.add(displayId);
        }
      });
      display.displayEdges.forEach((edge) => {
        if (edge.filePairs.some((pair) => focusedFiles.has(pair.fromFile) && focusedFiles.has(pair.toFile))) {
          focusedEdges.add(edge.id);
        }
      });
    }

    const activeNodeId = state.hoveredId || state.pinnedId;
    if (activeNodeId) {
      const activeNode = display.displayNodes.find((node) => node.id === activeNodeId);
      if (activeNode) {
        const sourceFiles = activeNode.sourceMembers.slice();
        const hoverFiles = collectOneHop(graph, sourceFiles);
        hoverFiles.forEach((fileId) => {
          const displayId = display.resolveDisplayForFile(fileId);
          if (displayId) {
            hoveredDisplayIds.add(displayId);
          }
        });

        display.displayEdges.forEach((edge) => {
          const outgoing = edge.filePairs.some((pair) => sourceFiles.includes(pair.fromFile));
          const incoming = edge.filePairs.some((pair) => sourceFiles.includes(pair.toFile));
          if (outgoing || incoming) {
            focusedEdges.add(edge.id);
            if (outgoing && incoming) {
              edgeRelations.set(edge.id, "bidirectional");
              addNodeRelation(edge.from, "incoming");
              addNodeRelation(edge.to, "outgoing");
            } else if (outgoing) {
              edgeRelations.set(edge.id, "outgoing");
              addNodeRelation(edge.to, "outgoing");
            } else {
              edgeRelations.set(edge.id, "incoming");
              addNodeRelation(edge.from, "incoming");
            }
            hoveredDisplayIds.add(edge.from);
            hoveredDisplayIds.add(edge.to);
          }
        });

        hoveredDisplayIds.add(activeNode.id);
        addNodeRelation(activeNode.id, "anchor");
      }
    }

    return {
      focusedDisplayIds,
      hoveredDisplayIds,
      focusedEdges,
      nodeRelations,
      edgeRelations,
      activeSelection: Boolean(state.hoveredId || state.pinnedId || state.focusedChain.length > 0),
    };
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function getNodePaint(node, focus) {
    if (focus.nodeRelations.get(node.id) === "anchor") {
      return { stroke: palette.anchorStroke, fill: palette.anchorFill };
    }
    if (focus.nodeRelations.get(node.id) === "outgoing") {
      return { stroke: palette.outgoingStroke, fill: palette.outgoingFill };
    }
    if (focus.nodeRelations.get(node.id) === "incoming") {
      return { stroke: palette.incomingStroke, fill: palette.incomingFill };
    }
    if (focus.nodeRelations.get(node.id) === "bidirectional") {
      return { stroke: palette.bidirectionalStroke, fill: palette.bidirectionalFill };
    }
    if (node.type === "cluster") {
      return { stroke: palette.cycleStroke, fill: palette.cycleFill };
    }
    if (node.isRoot) {
      return { stroke: palette.rootStroke, fill: palette.rootFill };
    }
    return { stroke: palette.nodeStroke, fill: palette.nodeFill };
  }

  function getEdgePaint(edgeId, focus) {
    if (focus.activeSelection && !focus.focusedEdges.has(edgeId)) {
      return palette.edgeDim;
    }
    const relation = focus.edgeRelations.get(edgeId);
    if (relation === "outgoing") {
      return palette.edgeOutgoing;
    }
    if (relation === "incoming") {
      return palette.edgeIncoming;
    }
    if (relation === "bidirectional") {
      return palette.edgeBidirectional;
    }
    if (focus.focusedEdges.has(edgeId)) {
      return palette.edgeFocus;
    }
    return palette.edge;
  }

  function drawScene() {
    if (!layoutScene || !state.graph) {
      return;
    }

    resizeCanvas();
    context.setTransform(devicePixelRatioValue, 0, 0, devicePixelRatioValue, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.translate(state.panX, state.panY);
    context.scale(state.zoom, state.zoom);

    const { display, positions, focus } = layoutScene;
    const edgeWidth = 1.1 / state.zoom;
    const focusedEdgeWidth = 1.9 / state.zoom;
    const nodeStrokeWidth = 1.35 / state.zoom;
    const focusedNodeStrokeWidth = 2.4 / state.zoom;

    display.displayEdges.forEach((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) {
        return;
      }
      const fromNode = display.displayNodes.find((node) => node.id === edge.from);
      const toNode = display.displayNodes.find((node) => node.id === edge.to);
      if (!fromNode || !toNode) {
        return;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt((dx * dx) + (dy * dy)) || 1;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const startX = from.x + (unitX * (fromNode.size + 1));
      const startY = from.y + (unitY * (fromNode.size + 1));
      const endX = to.x - (unitX * (toNode.size + 3));
      const endY = to.y - (unitY * (toNode.size + 3));

      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.strokeStyle = getEdgePaint(edge.id, focus);
      context.lineWidth = focus.focusedEdges.has(edge.id) ? focusedEdgeWidth : edgeWidth;
      context.stroke();
    });

    display.displayNodes.forEach((node) => {
      const position = positions.get(node.id);
      if (!position) {
        return;
      }

      const paint = getNodePaint(node, focus);
      const isFocused = focus.hoveredDisplayIds.has(node.id) || focus.focusedDisplayIds.has(node.id);
      const isDimmed = focus.activeSelection && !isFocused;

      context.save();
      context.globalAlpha = isDimmed ? palette.nodeDimAlpha : 1;
      context.fillStyle = paint.fill;
      context.strokeStyle = paint.stroke;
      context.lineWidth = isFocused ? focusedNodeStrokeWidth : nodeStrokeWidth;

      if (node.type === "cluster") {
        const width = node.size * 2.1;
        const height = node.size * 1.56;
        roundedRectPath(context, position.x - (width / 2), position.y - (height / 2), width, height, 11 / state.zoom);
        context.fill();
        context.stroke();
      } else {
        context.beginPath();
        context.arc(position.x, position.y, node.size, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }

      if (isFocused) {
        context.beginPath();
        context.arc(position.x, position.y, node.size + (5 / state.zoom), 0, Math.PI * 2);
        context.strokeStyle = paint.stroke;
        context.lineWidth = 0.8 / state.zoom;
        context.globalAlpha = 0.46;
        context.stroke();
      }

      context.restore();
    });
  }

  function rebuildLayoutScene() {
    if (!state.graph) {
      layoutScene = null;
      return;
    }
    ensureInitialVisibility(state.graph);
    const display = buildDisplayData(state.graph);
    if (state.pinnedId && !display.displayNodes.some((node) => node.id === state.pinnedId)) {
      state.pinnedId = null;
    }
    if (state.hoveredId && !display.displayNodes.some((node) => node.id === state.hoveredId)) {
      state.hoveredId = null;
    }
    const positions = layout(display.displayNodes, display.displayEdges);
    layoutScene = {
      display,
      positions,
      focus: null,
    };
    layoutDirty = false;
    focusDirty = true;
  }

  function ensureFocusScene() {
    if (!layoutScene || !state.graph) {
      return;
    }
    if (!focusDirty && layoutScene.focus) {
      return;
    }
    layoutScene.focus = computeFocus(layoutScene.display, state.graph);
    focusDirty = false;
  }

  function requestRender(options = {}) {
    if (options.layout) {
      layoutDirty = true;
    }
    if (options.focus) {
      focusDirty = true;
    }
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      if (layoutDirty || !layoutScene) {
        rebuildLayoutScene();
      }
      ensureFocusScene();
      drawScene();
      updateHoverCard();
    });
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x: (x - state.panX) / state.zoom,
      y: (y - state.panY) / state.zoom,
    };
  }

  function hitTest(worldX, worldY) {
    if (!layoutScene) {
      return null;
    }
    const { display, positions } = layoutScene;
    for (let index = display.displayNodes.length - 1; index >= 0; index -= 1) {
      const node = display.displayNodes[index];
      const position = positions.get(node.id);
      if (!position) {
        continue;
      }
      if (node.type === "cluster") {
        const width = node.size * 2.1;
        const height = node.size * 1.56;
        if (
          worldX >= position.x - (width / 2) &&
          worldX <= position.x + (width / 2) &&
          worldY >= position.y - (height / 2) &&
          worldY <= position.y + (height / 2)
        ) {
          return node;
        }
      } else {
        const distance = Math.hypot(worldX - position.x, worldY - position.y);
        if (distance <= node.size + 4) {
          return node;
        }
      }
    }
    return null;
  }

  function updateHoverCard() {
    if (isPanning || !layoutScene || !state.hoveredId) {
      hoverCard.classList.add("hidden");
      return;
    }

    const hoveredNode = layoutScene.display.displayNodes.find((node) => node.id === state.hoveredId);
    const hoveredPosition = hoveredNode ? layoutScene.positions.get(hoveredNode.id) : null;
    if (!hoveredNode || !hoveredPosition) {
      hoverCard.classList.add("hidden");
      return;
    }

    const screenX = (hoveredPosition.x * state.zoom) + state.panX;
    const screenY = (hoveredPosition.y * state.zoom) + state.panY;

    const clickHint = hoveredNode.openFilePath
      ? `<div class="hover-hint">Single click to ${state.pinnedId === hoveredNode.id ? "clear" : "lock"} highlight</div><div class="hover-hint">Double click to open</div>${hoveredNode.isCycleMember ? '<div class="hover-hint">Alt/Option + Click to collapse cycle</div>' : ""}`
      : `<div class="hover-hint">Single click to expand cluster</div>`;
    hoverCard.innerHTML = `<div>${hoveredNode.hoverText}</div>${clickHint}`;
    hoverCard.classList.remove("hidden");
    hoverCard.style.left = `${Math.min(screenX + 18, cssWidth - 340)}px`;
    hoverCard.style.top = `${Math.max(12, screenY - 10)}px`;
  }

  function updateIsolatedDrawer() {
    isolatedToggle.setAttribute("aria-expanded", String(state.isolatedOpen));
    isolatedDrawer.classList.toggle("hidden", !state.isolatedOpen);
  }

  function renderIsolated(graph) {
    if (!graph || graph.isolated.length === 0) {
      isolatedDock.classList.add("hidden");
      isolatedList.innerHTML = "";
      return;
    }

    isolatedDock.classList.remove("hidden");
    isolatedBadge.textContent = String(graph.isolated.length);
    isolatedCount.textContent = `${graph.isolated.length} file${graph.isolated.length === 1 ? "" : "s"}`;
    isolatedList.innerHTML = "";

    graph.isolated.forEach((fileId) => {
      const node = graph.nodeIndex[fileId];
      const button = document.createElement("button");
      button.className = "isolated-pill";
      button.textContent = node.label;
      button.title = fileId;
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "openFile", filePath: node.absolutePath });
      });
      isolatedList.appendChild(button);
    });

    updateIsolatedDrawer();
  }

  function openNodeFile(node) {
    if (node && node.openFilePath) {
      vscode.postMessage({ type: "openFile", filePath: node.openFilePath });
    }
  }

  function collapseCycleComponent(node) {
    if (!node || !node.isCycleMember) {
      return;
    }
    state.expandedComponents = state.expandedComponents.filter((componentId) => componentId !== node.componentId);
    const pinnedNode = layoutScene?.display.displayNodes.find((item) => item.id === state.pinnedId);
    if (pinnedNode && pinnedNode.componentId === node.componentId) {
      state.pinnedId = null;
    }
    const hoveredNode = layoutScene?.display.displayNodes.find((item) => item.id === state.hoveredId);
    if (hoveredNode && hoveredNode.componentId === node.componentId) {
      state.hoveredId = null;
    }
    state.focusedChain = [];
    requestRender({ layout: true, focus: true });
  }

  function handlePrimaryNodeAction(node, options = {}) {
    if (!layoutScene || !state.graph) {
      return;
    }

    if (options.collapseCycle && node.isCycleMember) {
      collapseCycleComponent(node);
      return;
    }

    if (node.type === "cluster" && !state.expandedComponents.includes(node.componentId)) {
      state.expandedComponents = Array.from(new Set(state.expandedComponents.concat(node.componentId)));
      state.focusedChain = [];
      state.pinnedId = null;
      requestRender({ layout: true, focus: true });
      return;
    }

    state.focusedChain = [];
    state.pinnedId = state.pinnedId === node.id ? null : node.id;
    requestRender({ focus: true });
  }

  function render() {
    resizeCanvas();
    if (!state.graph) {
      emptyState.classList.remove("hidden");
      hoverCard.classList.add("hidden");
      context.setTransform(devicePixelRatioValue, 0, 0, devicePixelRatioValue, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      subtitle.textContent = "Waiting for graph data…";
      return;
    }

    emptyState.classList.add("hidden");
    subtitle.textContent = `${state.graph.stats.nodeCount} files · ${state.graph.stats.edgeCount} edges · ${state.graph.stats.cycleCount} cycles`;
    renderIsolated(state.graph);
    requestRender({ layout: true, focus: true });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.type === "graphData") {
      state.graph = message.graph;
      state.focusedChain = [];
      layoutScene = null;
      layoutDirty = true;
      focusDirty = true;
      render();
      return;
    }

    if (message?.type === "graphError") {
      emptyState.textContent = message.message || "Failed to compute graph.";
      emptyState.classList.remove("hidden");
    }
  });

  render();
  vscode.postMessage({ type: "ready" });
})();
