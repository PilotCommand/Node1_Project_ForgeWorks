// ============================================================================
// manufacturingreview_process.js — Canvas, Nodes, Connections & Interactions
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Owns the center panel: the node flow canvas, all node DOM management,
// SVG connection routing, context menus, and all mouse/keyboard interaction.
//
// Cross-panel refresh calls (refreshLeftPanel, refreshRightPanel,
// refreshCalcPanel) are injected once via init() to avoid circular imports.
//
// Imports:  manufacturingreview_states.js (S)
//           manufacturingreview.js (NODE_DEFS, constants, ACCENT*)
// Exports:  init(), buildCanvasPanel(), applyWorldTransform(), resetView()
//           createNode(), refreshNodeEl(), removeNodeEl()
//           selectNode(), deleteNode()
//           addConnection(), refreshConnections()
// ============================================================================

import * as S from './manufacturingreview_states.js';
import {
  NODE_DEFS,
  NODE_W, NODE_H, PORT_R, PORT_HIT,
  ACCENT, ACCENT_DIM,
  toDisplay,
} from './manufacturingreview_defs.js';

// ---------------------------------------------------------------------------
// Injected cross-panel refresh callbacks (set once via init())
// ---------------------------------------------------------------------------

var _refreshLeftPanel  = function() {};
var _refreshRightPanel = function() {};
var _refreshCalcPanel  = function() {};

export function init(callbacks) {
  if (callbacks.refreshLeftPanel)  _refreshLeftPanel  = callbacks.refreshLeftPanel;
  if (callbacks.refreshRightPanel) _refreshRightPanel = callbacks.refreshRightPanel;
  if (callbacks.refreshCalcPanel)  _refreshCalcPanel  = callbacks.refreshCalcPanel;
}

// ---------------------------------------------------------------------------
// Canvas Panel
// ---------------------------------------------------------------------------

export function buildCanvasPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-canvas-panel';
  Object.assign(panel.style, {
    flex: '1', position: 'relative', overflow: 'hidden',
    background: '#070d14',
    cursor: 'default',
  });

  // Dot-grid rendered on the panel itself (doesn't move with pan)
  // We'll update backgroundPosition to track the pan for a nice parallax effect
  panel.style.backgroundImage = 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)';
  panel.style.backgroundSize = '28px 28px';

  // World layer — everything inside this gets panned + zoomed
  var wl = document.createElement('div');
  wl.id = 'mr-world';
  Object.assign(wl.style, {
    position: 'absolute', top: '0', left: '0',
    width: '0', height: '0',   // zero-size, contents overflow
    transformOrigin: '0 0',
    willChange: 'transform',
  });
  panel.appendChild(wl);
  S.setWorldLayer(wl);

  // SVG layer inside world
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'mr-svg';
  Object.assign(svg.style, {
    position: 'absolute', top: '0', left: '0',
    width: '8000px', height: '8000px',
    pointerEvents: 'none', overflow: 'visible',
  });
  svg.innerHTML = '<defs><marker id="mr-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.25)"/></marker></defs>';
  wl.appendChild(svg);
  S.setSvgLayer(svg);

  // Nodes layer inside world
  var nl = document.createElement('div');
  nl.id = 'mr-nodes';
  Object.assign(nl.style, { position: 'absolute', top: '0', left: '0' });
  wl.appendChild(nl);
  S.setNodesLayer(nl);

  panel.addEventListener('contextmenu', onCanvasContextMenu);
  panel.addEventListener('mousedown',   onCanvasMouseDown);
  panel.addEventListener('wheel',       onCanvasWheel, { passive: false });

  S.setCanvasArea(panel);
  return panel;
}

export function applyWorldTransform() {
  if (!S.getWorldLayer()) return;
  S.getWorldLayer().style.transform = 'translate(' + S.getPanX() + 'px, ' + S.getPanY() + 'px) scale(' + S.getZoom() + ')';
  if (S.getCanvasArea()) {
    S.getCanvasArea().style.backgroundPosition = (S.getPanX() % 28) + 'px ' + (S.getPanY() % 28) + 'px';
  }
  updateZoomIndicator();
}

export function updateZoomIndicator() {
  var el = document.getElementById('mr-zoom-indicator');
  if (el) el.textContent = Math.round(S.getZoom() * 100) + '%';
}


// ===========================================================================
// NODE RENDERING
// ===========================================================================

export function createNode(type, x, y) {
  var def = NODE_DEFS[type];
  if (!def) return null;
  var node = { id: 'n' + S.nextNid(), type: type, label: def.label, x: x, y: y, params: Object.assign({}, def.defaultParams) };
  S.pushNode(node);
  renderNodeEl(node);
  _refreshRightPanel(); _refreshCalcPanel();
  return node;
}

export function renderNodeEl(node) {
  var def = NODE_DEFS[node.type];

  var el = document.createElement('div');
  el.id = 'node-' + node.id;
  el.className = 'mr-node';
  Object.assign(el.style, {
    position: 'absolute', left: node.x + 'px', top: node.y + 'px',
    width: NODE_W + 'px', background: def.color,
    border: '2px solid ' + def.borderColor, borderRadius: '4px',
    userSelect: 'none', transition: 'box-shadow 0.2s ease', cursor: 'grab',
  });

  // Header
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  var hdot = document.createElement('div');
  Object.assign(hdot.style, { width: '6px', height: '6px', borderRadius: '50%', background: def.textColor, opacity: '0.7', flexShrink: '0' });
  var hlbl = document.createElement('div');
  hlbl.id = 'node-lbl-' + node.id;
  Object.assign(hlbl.style, {
    fontSize: '9px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: def.textColor, flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  hlbl.textContent = node.label || def.label;
  hdr.appendChild(hdot); hdr.appendChild(hlbl);
  el.appendChild(hdr);

  // Body — first 2 non-section params as preview
  var body = document.createElement('div');
  Object.assign(body.style, { padding: '5px 10px' });
  // Smart preview key selection per node type
  var allReal = def.paramDefs.filter(function(pd) { return pd.section === undefined; });
  var previewKeys = null;
  if (node.type === 'stock_in')   previewKeys = ['grade', 'geometry'];
  if (node.type === 'cut')        previewKeys = ['purpose', 'targetLength'];
  if (node.type === 'heat')       previewKeys = ['targetTemp', 'furnaceType'];
  if (node.type === 'forge')      previewKeys = ['equipment', 'process'];
  if (node.type === 'ring_mill')  previewKeys = ['outOD', 'outID'];
  if (node.type === 'trim')       previewKeys = ['trimCondition', 'flashPct'];
  if (node.type === 'heat_treat') previewKeys = ['process', 'targetTemp'];
  if (node.type === 'machine')    previewKeys = ['equipment', 'operation'];
  if (node.type === 'weld')       previewKeys = ['process', 'shieldingGas'];
  if (node.type === 'inspect')    previewKeys = ['method', 'result'];
  if (node.type === 'stock_out')  previewKeys = ['productType', 'partNumber'];









  var previews = previewKeys
    ? previewKeys.map(function(k) { return allReal.find(function(pd) { return pd.key === k; }); }).filter(Boolean)
    : allReal.slice(0, 2);
  if (previews.length === 0) {
    var emp = document.createElement('div');
    Object.assign(emp.style, { fontSize: '9px', color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '5px 0' });
    emp.textContent = '—';
    body.appendChild(emp);
  } else {
    previews.forEach(function(pd) {
      var row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px' });
      var k = document.createElement('span');
      Object.assign(k.style, { color: 'rgba(255,255,255,0.28)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' });
      k.textContent = pd.label.split('(')[0].trim();
      var v = document.createElement('span');
      v.id = 'node-p-' + node.id + '-' + pd.key;
      Object.assign(v.style, { color: def.textColor, opacity: '0.85' });
      v.textContent = node.params[pd.key] !== undefined
        ? (function() {
            var raw = node.params[pd.key];
            if (!pd.unitType) return raw;
            var disp = toDisplay(raw, pd.unitType);
            if (pd.unitType === 'length')  return disp + (S.getUnitSystem() === 'imperial' ? '"' : '');
            if (pd.unitType === 'temp')    return disp + (S.getUnitSystem() === 'imperial' ? '°F' : '°C');
            if (pd.unitType === 'density') return disp + (S.getUnitSystem() === 'imperial' ? ' lb/in³' : ' g/cm³');
            return disp;
          }())
        : '—';
      row.appendChild(k); row.appendChild(v);
      body.appendChild(row);
    });
  }
  el.appendChild(body);

  // Ports
  if (def.hasInput) {
    var inp = makePortEl('input', node.id);
    Object.assign(inp.style, { position: 'absolute', left: (-PORT_R) + 'px', top: (NODE_H / 2 - PORT_R) + 'px' });
    el.appendChild(inp);
  }
  if (def.hasOutput) {
    var outp = makePortEl('output', node.id);
    Object.assign(outp.style, { position: 'absolute', right: (-PORT_R) + 'px', top: (NODE_H / 2 - PORT_R) + 'px' });
    el.appendChild(outp);
  }

  el.addEventListener('mousedown', function(e) { onNodeMouseDown(e, node.id); });
  el.addEventListener('contextmenu', function(e) { onNodeContextMenu(e, node.id); });
  el.addEventListener('click', function(e) { if (!e.target.classList.contains('mr-port')) selectNode(node.id); });

  S.getNodesLayer().appendChild(el);
}

function makePortEl(portType, nodeId) {
  var el = document.createElement('div');
  el.className = 'mr-port mr-port-' + portType;
  el.dataset.portType = portType;
  el.dataset.nodeId   = nodeId;
  Object.assign(el.style, {
    width: (PORT_R * 2) + 'px', height: (PORT_R * 2) + 'px', borderRadius: '50%',
    background: portType === 'output' ? ACCENT : '#2a3a55',
    border: '2px solid rgba(255,255,255,0.35)',
    cursor: 'crosshair', zIndex: '10',
    transition: 'transform 0.15s ease, background 0.15s ease',
  });
  el.addEventListener('mouseenter', function() { el.style.transform = 'scale(1.5)'; el.style.background = portType === 'output' ? '#ff8060' : '#4466aa'; });
  el.addEventListener('mouseleave', function() { el.style.transform = 'scale(1)';   el.style.background = portType === 'output' ? ACCENT : '#2a3a55'; });
  el.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    if (portType === 'output') {
      var pos = getCanvasPos(e);
      S.setDragState({ type: 'connect', fromId: nodeId, mouseX: pos.x, mouseY: pos.y });
    }
  });
  return el;
}

export function refreshNodeEl(nodeId) {
  var node = S.getNodes().find(function(n) { return n.id === nodeId; });
  if (!node) return;
  var def = NODE_DEFS[node.type];
  var lbl = document.getElementById('node-lbl-' + nodeId);
  if (lbl) lbl.textContent = node.label || def.label;
  var allReal = def.paramDefs.filter(function(pd) { return pd.section === undefined; });
  var previewKeys = null;
  if (node.type === 'stock_in')   previewKeys = ['grade', 'geometry'];
  if (node.type === 'cut')        previewKeys = ['purpose', 'targetLength'];
  if (node.type === 'heat')       previewKeys = ['targetTemp', 'furnaceType'];
  if (node.type === 'forge')      previewKeys = ['equipment', 'process'];
  if (node.type === 'ring_mill')  previewKeys = ['outOD', 'outID'];
  if (node.type === 'trim')       previewKeys = ['trimCondition', 'flashPct'];
  if (node.type === 'heat_treat') previewKeys = ['process', 'targetTemp'];
  if (node.type === 'machine')    previewKeys = ['equipment', 'operation'];
  if (node.type === 'weld')       previewKeys = ['process', 'shieldingGas'];
  if (node.type === 'inspect')    previewKeys = ['method', 'result'];
  if (node.type === 'stock_out')  previewKeys = ['productType', 'partNumber'];
  var previews = previewKeys
    ? previewKeys.map(function(k) { return allReal.find(function(pd) { return pd.key === k; }); }).filter(Boolean)
    : allReal.slice(0, 2);
  previews.forEach(function(pd) {
    var el = document.getElementById('node-p-' + nodeId + '-' + pd.key);
    if (!el) return;
    var raw = node.params[pd.key];
    if (raw === undefined) { el.textContent = '—'; return; }
    if (!pd.unitType) { el.textContent = String(raw).replace(/_/g, ' '); return; }
    var disp = toDisplay(raw, pd.unitType);
    if (pd.unitType === 'length')  el.textContent = disp + (S.getUnitSystem() === 'imperial' ? '"' : '');
    else if (pd.unitType === 'temp') el.textContent = disp + (S.getUnitSystem() === 'imperial' ? '°F' : '°C');
    else if (pd.unitType === 'density') el.textContent = disp + (S.getUnitSystem() === 'imperial' ? ' lb/in³' : ' g/cm³');
    else el.textContent = disp;
  });
}

export function removeNodeEl(nodeId) {
  var el = document.getElementById('node-' + nodeId);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

export function setNodeSelected(nodeId, selected) {
  var el = document.getElementById('node-' + nodeId);
  if (!el) return;
  var node = S.getNodes().find(function(n) { return n.id === nodeId; });
  var def  = node ? (NODE_DEFS[node.type] || {}) : {};
  el.style.boxShadow = selected ? '0 0 0 2px ' + (def.borderColor || ACCENT) + ', 0 4px 24px rgba(0,0,0,0.7)' : 'none';
}

export function selectNode(nodeId) {
  if (S.getSelectedId()) setNodeSelected(S.getSelectedId(), false);
  S.setSelectedId(nodeId);
  if (nodeId) {
    setNodeSelected(nodeId, true);
    S.setLeftMode('node_detail');
    // Clear connection selection
    if (S.getSelectedConnId()) { S.setSelectedConnId(null); refreshConnections(); }
  }
  _refreshLeftPanel();
  _refreshRightPanel(); _refreshCalcPanel();
}

export function deleteNode(nodeId) {
  S.filterConnections(function(c) { return c.fromId !== nodeId && c.toId !== nodeId; });
  S.filterNodes(function(n) { return n.id !== nodeId; });
  removeNodeEl(nodeId);
  if (S.getSelectedId() === nodeId) selectNode(null);
  refreshConnections();
  _refreshRightPanel(); _refreshCalcPanel();
}


// ===========================================================================
// SVG CONNECTIONS
// ===========================================================================

function getPortPos(node, portType) {
  if (portType === 'output') return { x: node.x + NODE_W + PORT_R, y: node.y + NODE_H / 2 };
  return { x: node.x - PORT_R, y: node.y + NODE_H / 2 };
}

// ---------------------------------------------------------------------------
// Orthogonal router — produces a rounded-elbow SVG path that avoids nodes.
//
// Strategy:
//   Stub: always leave/arrive horizontally (stub = 36px out from port).
//   Forward (target is to the right): go to midX, vertical bridge, continue.
//   Backward (target is to left or same X): loop — go right past source,
//     drop below all nodes involved, go left, rise to target Y.
// ---------------------------------------------------------------------------

var CONN_R = 8;
var STUB   = 28;

function routedPath(x1, y1, x2, y2, srcNode, tgtNode) {

  var srcRight  = srcNode ? srcNode.x + NODE_W  : x1;
  var srcBottom = srcNode ? srcNode.y + NODE_H   : y1 + NODE_H / 2;
  var srcTop    = srcNode ? srcNode.y             : y1 - NODE_H / 2;

  var tgtLeft   = tgtNode ? tgtNode.x             : x2;
  var tgtRight  = tgtNode ? tgtNode.x + NODE_W   : x2 + NODE_W;
  var tgtBottom = tgtNode ? tgtNode.y + NODE_H   : y2 + NODE_H / 2;
  var tgtTop    = tgtNode ? tgtNode.y             : y2 - NODE_H / 2;

  // ── CASE 1: Forward (target node starts right of source node) ────────────
  if (tgtLeft > srcRight + 1) {
    var cx = (x1 + x2) / 2;
    return 'M ' + r3(x1) + ' ' + r3(y1) +
           ' C ' + r3(cx) + ' ' + r3(y1) +
           ' ' + r3(cx) + ' ' + r3(y2) +
           ' ' + r3(x2) + ' ' + r3(y2);
  }

  // ── CASE 2: Backward / overlapping — check for vertical gap between nodes
  var nodesOverlapV = srcBottom > tgtTop + 2 && srcTop < tgtBottom - 2;

  if (!nodesOverlapV) {
    // Clear vertical corridor — route through the gap between the nodes.
    // Path: exit right → vertical to gap midpoint → LEFT to target approach → vertical to target port → enter.
    var gapY = srcBottom <= tgtTop
      ? (srcBottom + tgtTop) / 2      // source above target
      : (tgtBottom + srcTop) / 2;     // source below target

    var turnX    = srcRight + STUB;           // right of source, stub out
    var approachX = tgtNode ? tgtNode.x - STUB : x2 - STUB;  // LEFT of target node, arriving rightward

    // approachX must be left of x2 (the input port) so the final segment goes rightward into it
    approachX = Math.min(approachX, x2 - 4);

    return roundedOrtho([
      { x: x1,         y: y1   },
      { x: turnX,      y: y1   },
      { x: turnX,      y: gapY },
      { x: approachX,  y: gapY },
      { x: approachX,  y: y2   },
      { x: x2,         y: y2   },
    ], CONN_R);
  }

  // ── CASE 3: Nodes overlap vertically — must loop around the right side ───
  var loopX = Math.max(srcRight, tgtRight) + 48;
  var loopY = Math.max(srcBottom, tgtBottom) + 44;
  return roundedOrtho([
    { x: x1,        y: y1     },
    { x: loopX,     y: y1     },
    { x: loopX,     y: loopY  },
    { x: x2 - STUB, y: loopY  },
    { x: x2 - STUB, y: y2     },
    { x: x2,        y: y2     },
  ], CONN_R);
}

function roundedOrtho(pts, r) {
  if (pts.length < 2) return '';
  var d = 'M ' + r3(pts[0].x) + ' ' + r3(pts[0].y);
  for (var i = 1; i < pts.length - 1; i++) {
    var prev = pts[i - 1], curr = pts[i], next = pts[i + 1];
    var dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    var len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    var dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    var len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    var rr = Math.min(r, len1 / 2, len2 / 2);
    var bx = curr.x - (dx1 / len1) * rr;
    var by = curr.y - (dy1 / len1) * rr;
    var ax = curr.x + (dx2 / len2) * rr;
    var ay = curr.y + (dy2 / len2) * rr;
    d += ' L ' + r3(bx) + ' ' + r3(by);
    d += ' Q ' + r3(curr.x) + ' ' + r3(curr.y) + ' ' + r3(ax) + ' ' + r3(ay);
  }
  d += ' L ' + r3(pts[pts.length - 1].x) + ' ' + r3(pts[pts.length - 1].y);
  return d;
}

function r3(v) { return Math.round(v * 10) / 10; }

// ---------------------------------------------------------------------------
// Connection rendering
// Each connection renders as two SVG paths:
//   1. A wide transparent hit-area path (for click detection)
//   2. The visible styled path
// ---------------------------------------------------------------------------

export function refreshConnections() {
  S.getSvgLayer().querySelectorAll('.mr-conn, .mr-conn-hit').forEach(function(el) {
    el.parentNode.removeChild(el);
  });

  S.getConnections().forEach(function(conn) {
    var fn = S.getNodes().find(function(n) { return n.id === conn.fromId; });
    var tn = S.getNodes().find(function(n) { return n.id === conn.toId;   });
    if (!fn || !tn) return;

    var p1  = getPortPos(fn, 'output');
    var p2  = getPortPos(tn, 'input');
    var def = NODE_DEFS[fn.type] || {};
    var d   = routedPath(p1.x, p1.y, p2.x, p2.y, fn, tn);
    var isSelected = conn.id === S.getSelectedConnId();

    // Visible path
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'mr-conn');
    path.setAttribute('data-conn-id', conn.id);
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', isSelected ? ACCENT : (def.borderColor || '#607888'));
    path.setAttribute('stroke-width', isSelected ? '2.5' : '1.8');
    path.setAttribute('stroke-opacity', isSelected ? '1' : '0.7');
    path.setAttribute('marker-end', 'url(#mr-arrow)');
    path.style.pointerEvents = 'none';
    if (isSelected) {
      path.setAttribute('stroke-dasharray', 'none');
      path.setAttribute('filter', 'drop-shadow(0 0 4px ' + ACCENT + ')');
    }
    S.getSvgLayer().appendChild(path);

    // Cycle badge — show Nx label at midpoint of path if cycle > 1
    var cycles = conn.cycle || 1;
    if (cycles > 1) {
      var midX = (p1.x + p2.x) / 2;
      var midY = (p1.y + p2.y) / 2;
      var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('class', 'mr-conn');
      bgRect.setAttribute('x', r3(midX - 14)); bgRect.setAttribute('y', r3(midY - 9));
      bgRect.setAttribute('width', '28'); bgRect.setAttribute('height', '16');
      bgRect.setAttribute('rx', '3');
      bgRect.setAttribute('fill', isSelected ? ACCENT : '#1a2a3a');
      bgRect.setAttribute('stroke', isSelected ? ACCENT : (def.borderColor || '#607888'));
      bgRect.setAttribute('stroke-width', '1');
      bgRect.style.pointerEvents = 'none';
      S.getSvgLayer().appendChild(bgRect);
      var badgeTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      badgeTxt.setAttribute('class', 'mr-conn');
      badgeTxt.setAttribute('x', r3(midX)); badgeTxt.setAttribute('y', r3(midY + 4));
      badgeTxt.setAttribute('text-anchor', 'middle');
      badgeTxt.setAttribute('font-size', '9');
      badgeTxt.setAttribute('font-weight', '700');
      badgeTxt.setAttribute('letter-spacing', '0.5');
      badgeTxt.setAttribute('fill', isSelected ? '#fff' : '#c0d8e8');
      badgeTxt.setAttribute('font-family', 'Consolas, monospace');
      badgeTxt.style.pointerEvents = 'none';
      badgeTxt.textContent = cycles + 'x';
      S.getSvgLayer().appendChild(badgeTxt);
    }

    // Hit-area path (wider, transparent, clickable)
    var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('class', 'mr-conn-hit');
    hit.setAttribute('data-conn-id', conn.id);
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.style.pointerEvents = 'stroke';
    hit.style.cursor = 'pointer';

    hit.addEventListener('click', function(e) {
      e.stopPropagation();
      selectConn(conn.id);
    });
    hit.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      selectConn(conn.id);
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Delete Connection', danger: true, action: function() { deleteConn(conn.id); } },
      ]);
    });
    hit.addEventListener('mouseenter', function() {
      if (conn.id !== S.getSelectedConnId()) {
        path.setAttribute('stroke-opacity', '1');
        path.setAttribute('stroke-width', '2.2');
      }
    });
    hit.addEventListener('mouseleave', function() {
      if (conn.id !== S.getSelectedConnId()) {
        path.setAttribute('stroke-opacity', '0.7');
        path.setAttribute('stroke-width', '1.8');
      }
    });

    S.getSvgLayer().appendChild(hit);
  });
}

// ---------------------------------------------------------------------------
// Live connection preview while dragging
// ---------------------------------------------------------------------------

function updateLiveConnection(x2, y2) {
  var live = document.getElementById('mr-live-conn');
  if (!live) {
    live = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    live.id = 'mr-live-conn';
    live.setAttribute('fill', 'none');
    live.setAttribute('stroke', ACCENT);
    live.setAttribute('stroke-width', '2');
    live.setAttribute('stroke-dasharray', '7 4');
    live.setAttribute('stroke-opacity', '0.9');
    live.style.pointerEvents = 'none';
    S.getSvgLayer().appendChild(live);
  }
  var fn = S.getNodes().find(function(n) { return n.id === S.getDragState().fromId; });
  if (!fn) return;
  var p1 = getPortPos(fn, 'output');
  live.setAttribute('d', routedPath(p1.x, p1.y, x2, y2, fn, null));
}

function removeLiveConnection() {
  var live = document.getElementById('mr-live-conn');
  if (live && live.parentNode) live.parentNode.removeChild(live);
}

// ---------------------------------------------------------------------------
// Connection add / select / delete
// ---------------------------------------------------------------------------

export function addConnection(fromId, toId) {
  if (fromId === toId) return;
  if (S.getConnections().find(function(c) { return c.fromId === fromId && c.toId === toId; })) return;
  S.pushConnection({ id: 'c' + S.nextCid(), fromId: fromId, toId: toId, cycle: 1 });
  refreshConnections();
  _refreshRightPanel(); _refreshCalcPanel();
}

export function selectConn(connId) {
  if (S.getSelectedId()) { setNodeSelected(S.getSelectedId(), false); S.setSelectedId(null); }
  S.setSelectedConnId(connId);
  S.setLeftMode('path');
  refreshConnections();
  _refreshLeftPanel();
}

export function deleteConn(connId) {
  S.filterConnections(function(c) { return c.id !== connId; });
  if (S.getSelectedConnId() === connId) S.setSelectedConnId(null);
  refreshConnections();
  _refreshRightPanel(); _refreshCalcPanel();
}


// ===========================================================================
// CONTEXT MENU
// ===========================================================================

function showContextMenu(x, y, items) {
  dismissContextMenu();
  var menu = document.createElement('div');
  menu.id = 'mr-ctx-menu';
  Object.assign(menu.style, {
    position: 'fixed', left: x + 'px', top: y + 'px',
    background: '#0d1520', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '4px', zIndex: '99999', minWidth: '200px', padding: '4px 0',
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    fontFamily: "'Consolas','SF Mono',monospace",
  });

  items.forEach(function(item) {
    if (item.separator) {
      var sep = document.createElement('div');
      Object.assign(sep.style, { height: '1px', background: 'rgba(255,255,255,0.18)', margin: '4px 0' });
      menu.appendChild(sep); return;
    }
    if (item.header) {
      var hdr = document.createElement('div');
      Object.assign(hdr.style, { padding: '5px 16px 3px', fontSize: '8px', letterSpacing: '2px', textTransform: 'uppercase', color: '#6a8090' });
      hdr.textContent = item.header;
      menu.appendChild(hdr); return;
    }
    var row = document.createElement('div');
    Object.assign(row.style, {
      padding: '7px 16px', fontSize: '10px', letterSpacing: '0.5px',
      cursor: item.action ? 'pointer' : 'default',
      color: item.danger ? '#ef7777' : '#aabbcc',
      display: 'flex', alignItems: 'center', gap: '10px',
      transition: 'background 0.1s ease',
    });
    if (item.color) {
      var dot = document.createElement('div');
      Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%', background: item.color, flexShrink: '0' });
      row.appendChild(dot);
    }
    var lbl = document.createElement('span'); lbl.textContent = item.label; row.appendChild(lbl);
    if (item.action) {
      row.addEventListener('mouseenter', function() { row.style.background = item.danger ? 'rgba(239,119,119,0.08)' : 'rgba(255,255,255,0.14)'; });
      row.addEventListener('mouseleave', function() { row.style.background = 'none'; });
      row.addEventListener('mousedown', function(e) { e.stopPropagation(); dismissContextMenu(); item.action(); });
    }
    menu.appendChild(row);
  });

  document.body.appendChild(menu);
  S.setCtxMenu(menu);
  setTimeout(function() { document.addEventListener('mousedown', dismissContextMenu, { once: true }); }, 0);
}

export function dismissContextMenu() {
  if (S.getCtxMenu() && S.getCtxMenu().parentNode) { S.getCtxMenu().parentNode.removeChild(S.getCtxMenu()); S.setCtxMenu(null); }
}

function onCanvasContextMenu(e) {
  e.preventDefault();
  var pos = getCanvasPos(e);
  var cx = pos.x - NODE_W / 2;
  var cy = pos.y - NODE_H / 2;

  var items = [{ header: 'Add Node' }];
  Object.keys(NODE_DEFS).forEach(function(type) {
    var def = NODE_DEFS[type];
    items.push({
      label: def.label, color: def.borderColor,
      action: (function(t, x, y) { return function() { createNode(t, x, y); }; })(type, cx, cy),
    });
  });
  showContextMenu(e.clientX, e.clientY, items);
}

function onNodeContextMenu(e, nodeId) {
  e.preventDefault(); e.stopPropagation();
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Delete Node', danger: true,  action: function() { deleteNode(nodeId); } },
    { separator: true },
    { label: 'Duplicate',   danger: false, action: function() {
      var orig = S.getNodes().find(function(n) { return n.id === nodeId; });
      if (!orig) return;
      var newNode = createNode(orig.type, orig.x + 24, orig.y + 24);
      newNode.params = JSON.parse(JSON.stringify(orig.params));
      refreshNodeEl(newNode.id);
    }},
  ]);
}


// ===========================================================================
// INTERACTION HANDLERS
// ===========================================================================

function getCanvasPos(e) {
  var rect = S.getCanvasArea().getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - S.getPanX()) / S.getZoom(),
    y: (e.clientY - rect.top  - S.getPanY()) / S.getZoom(),
  };
}

function findPortAtPoint(x, y) {
  for (var i = 0; i < S.getNodes().length; i++) {
    var node = S.getNodes()[i];
    var def  = NODE_DEFS[node.type];
    var px, py, dist;
    if (def.hasInput) {
      px = node.x - PORT_R; py = node.y + NODE_H / 2;
      dist = Math.sqrt(Math.pow(x - px, 2) + Math.pow(y - py, 2));
      if (dist < PORT_HIT) return { nodeId: node.id, portType: 'input' };
    }
    if (def.hasOutput) {
      px = node.x + NODE_W + PORT_R; py = node.y + NODE_H / 2;
      dist = Math.sqrt(Math.pow(x - px, 2) + Math.pow(y - py, 2));
      if (dist < PORT_HIT) return { nodeId: node.id, portType: 'output' };
    }
  }
  return null;
}

function onCanvasMouseDown(e) {
  var onBackground = e.target === S.getCanvasArea() || e.target === S.getNodesLayer() || e.target.id === 'mr-svg' || e.target.id === 'mr-world';
  if (onBackground) {
    dismissContextMenu();
    selectNode(null);
    // Clear connection selection
    if (S.getSelectedConnId()) { S.setSelectedConnId(null); refreshConnections(); }
    // Left button: start panning
    if (e.button === 0 || e.button === 1) {
      S.setDragState({
        type: 'pan',
        startClientX: e.clientX, startClientY: e.clientY,
        origPanX: S.getPanX(), origPanY: S.getPanY(),
      });
      S.getCanvasArea().style.cursor = 'grabbing';
      e.preventDefault();
    }
  }
}

function onNodeMouseDown(e, nodeId) {
  if (e.target.classList.contains('mr-port')) return;
  e.stopPropagation();
  var node = S.getNodes().find(function(n) { return n.id === nodeId; });
  if (!node) return;
  var pos = getCanvasPos(e);
  S.setDragState({ type: 'node', nodeId: nodeId, startX: pos.x, startY: pos.y, origX: node.x, origY: node.y });
}

export function onMouseMove(e) {
  if (!S.getDragState() || !S.getCanvasArea()) return;

  if (S.getDragState().type === 'pan') {
    S.setPanX(S.getDragState().origPanX + (e.clientX - S.getDragState().startClientX));
    S.setPanY(S.getDragState().origPanY + (e.clientY - S.getDragState().startClientY));
    applyWorldTransform();

  } else if (S.getDragState().type === 'node') {
    var pos = getCanvasPos(e);
    var node = S.getNodes().find(function(n) { return n.id === S.getDragState().nodeId; });
    if (!node) return;
    node.x = Math.max(0, S.getDragState().origX + (pos.x - S.getDragState().startX));
    node.y = Math.max(0, S.getDragState().origY + (pos.y - S.getDragState().startY));
    var el = document.getElementById('node-' + node.id);
    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
    refreshConnections();

  } else if (S.getDragState().type === 'connect') {
    var pos2 = getCanvasPos(e);
    updateLiveConnection(pos2.x, pos2.y);
  }
}

export function onMouseUp(e) {
  if (!S.getDragState()) return;

  if (S.getDragState().type === 'pan') {
    S.getCanvasArea().style.cursor = 'default';

  } else if (S.getDragState().type === 'connect' && S.getCanvasArea()) {
    var pos = getCanvasPos(e);
    var hit = findPortAtPoint(pos.x, pos.y);
    if (hit && hit.portType === 'input' && hit.nodeId !== S.getDragState().fromId) {
      addConnection(S.getDragState().fromId, hit.nodeId);
    }
    removeLiveConnection();
  }

  S.clearDragState();
}

export function onKeyDown(e) {
  if (!S.isVisible()) return;
  if ((e.code === 'Delete' || e.code === 'Backspace') && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    if (S.getSelectedId())     deleteNode(S.getSelectedId());
    if (S.getSelectedConnId()) deleteConn(S.getSelectedConnId());
  }
  if (e.code === 'Escape') { dismissContextMenu(); selectNode(null); S.setSelectedConnId(null); refreshConnections(); }
}


function onCanvasWheel(e) {
  e.preventDefault();
  var rect   = S.getCanvasArea().getBoundingClientRect();
  var mouseX = e.clientX - rect.left;
  var mouseY = e.clientY - rect.top;

  var delta   = e.deltaY > 0 ? 0.9 : 1.1;
  var newZoom = Math.min(Math.max(S.getZoom() * delta, 0.2), 3);

  // Zoom toward the mouse cursor position
  S.setPanX(mouseX - (mouseX - S.getPanX()) * (newZoom / S.getZoom()));
  S.setPanY(mouseY - (mouseY - S.getPanY()) * (newZoom / S.getZoom()));
  S.setZoom(newZoom);

  applyWorldTransform();
}

export function resetView() {
  S.resetViewport();
  applyWorldTransform();
}