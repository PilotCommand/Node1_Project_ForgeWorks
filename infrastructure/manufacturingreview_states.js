// ============================================================================
// manufacturingreview_states.js — Shared Mutable State
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Single source of truth for all runtime state shared across the
// Manufacturing Review module. No DOM manipulation, no business logic,
// no calculations — pure state accessors only.
//
// Pattern mirrors product_registry.js: private vars, exported getters/setters.
// Objects (general, dragState) are returned as live references and mutated
// in-place by callers — consistent with how the rest of the codebase handles
// complex state objects.
//
// Imports:  nothing
// Exports:  getters and setters for all shared state
//
// State groups:
//   Overlay lifecycle    — overlay, backCallback, visible
//   DOM references       — canvasArea, svgLayer, nodesLayer, worldLayer, ctxMenu
//   Graph data           — nodes[], connections[], _nid, _cid
//   Selection            — selectedId, selectedConnId, leftMode
//   Interaction          — dragState
//   Viewport             — panX, panY, zoom
//   Unit system          — unitSystem
//   Job data             — general {}
// ============================================================================


// ============================================================================
// OVERLAY LIFECYCLE
// ============================================================================

var _overlay      = null;   // root DOM element for the full-screen overlay
var _backCallback = null;   // function to call when the back / menu button is pressed
var _visible      = false;  // whether the overlay is currently shown

export function getOverlay()           { return _overlay; }
export function setOverlay(v)          { _overlay = v; }

export function getBackCallback()      { return _backCallback; }
export function setBackCallback(v)     { _backCallback = v; }

export function isVisible()            { return _visible; }
export function setVisible(v)          { _visible = v; }


// ============================================================================
// DOM REFERENCES
// Assigned once during buildOverlay(). Null until the overlay is first built.
// ============================================================================

var _canvasArea  = null;   // the canvas panel div (receives mouse / wheel events)
var _svgLayer    = null;   // SVG element inside worldLayer (connection paths)
var _nodesLayer  = null;   // div inside worldLayer (node card elements)
var _worldLayer  = null;   // transform container — pan + zoom applied here
var _ctxMenu     = null;   // currently open context menu element, or null

export function getCanvasArea()        { return _canvasArea; }
export function setCanvasArea(v)       { _canvasArea = v; }

export function getSvgLayer()          { return _svgLayer; }
export function setSvgLayer(v)         { _svgLayer = v; }

export function getNodesLayer()        { return _nodesLayer; }
export function setNodesLayer(v)       { _nodesLayer = v; }

export function getWorldLayer()        { return _worldLayer; }
export function setWorldLayer(v)       { _worldLayer = v; }

export function getCtxMenu()           { return _ctxMenu; }
export function setCtxMenu(v)          { _ctxMenu = v; }


// ============================================================================
// GRAPH DATA
// nodes[]       — all node objects currently on the canvas
// connections[] — all directed edge objects linking nodes
// _nid / _cid   — monotonically increasing ID counters (never reset mid-session)
// ============================================================================

var _nodes       = [];
var _connections = [];
var _nid         = 0;
var _cid         = 0;

// --- nodes ---

export function getNodes()             { return _nodes; }

export function setNodes(arr)          { _nodes = arr; }   // bulk replace — loadConfig only

export function pushNode(node) {
  _nodes.push(node);
}

export function filterNodes(predicate) {
  _nodes = _nodes.filter(predicate);
}

export function findNode(predicate) {
  return _nodes.find(predicate) || null;
}

// --- connections ---

export function getConnections()       { return _connections; }

export function setConnections(arr)    { _connections = arr; }   // bulk replace — loadConfig only

export function pushConnection(conn) {
  _connections.push(conn);
}

export function filterConnections(predicate) {
  _connections = _connections.filter(predicate);
}

export function findConnection(predicate) {
  return _connections.find(predicate) || null;
}

// --- ID counters ---

export function getNid()               { return _nid; }
export function setNid(v)              { _nid = v; }
export function nextNid()              { return _nid++; }   // returns current value then increments

export function getCid()               { return _cid; }
export function setCid(v)              { _cid = v; }
export function nextCid()              { return _cid++; }   // returns current value then increments


// ============================================================================
// SELECTION & LEFT PANEL MODE
// selectedId      — id of the currently selected node, or null
// selectedConnId  — id of the currently selected connection, or null
// leftMode        — which tab the left panel is showing
// ============================================================================

var _selectedId     = null;
var _selectedConnId = null;
var _leftMode       = 'general';   // 'general' | 'node_detail' | 'path'

export function getSelectedId()        { return _selectedId; }
export function setSelectedId(v)       { _selectedId = v; }

export function getSelectedConnId()    { return _selectedConnId; }
export function setSelectedConnId(v)   { _selectedConnId = v; }

export function getLeftMode()          { return _leftMode; }
export function setLeftMode(v)         { _leftMode = v; }


// ============================================================================
// INTERACTION — DRAG STATE
// dragState holds the transient data for whatever drag operation is in
// progress (pan, node move, or port-to-port connection draw). Null when idle.
//
// Shape during pan:
//   { type: 'pan', startClientX, startClientY, origPanX, origPanY }
//
// Shape during node drag:
//   { type: 'node', nodeId, startClientX, startClientY, origX, origY }
//
// Shape during port connection draw:
//   { type: 'connect', fromId }
// ============================================================================

var _dragState = null;

export function getDragState()         { return _dragState; }
export function setDragState(v)        { _dragState = v; }
export function clearDragState()       { _dragState = null; }


// ============================================================================
// VIEWPORT — PAN & ZOOM
// All three values are applied together as a CSS transform on worldLayer.
// panX / panY are in screen pixels. zoom is a scalar (0.2 – 3.0).
// ============================================================================

var _panX = 0;
var _panY = 0;
var _zoom = 1;

export function getPanX()              { return _panX; }
export function setPanX(v)             { _panX = v; }

export function getPanY()              { return _panY; }
export function setPanY(v)             { _panY = v; }

export function getZoom()              { return _zoom; }
export function setZoom(v)             { _zoom = v; }

export function resetViewport() {
  _panX = 0;
  _panY = 0;
  _zoom = 1;
}

export function setViewport(panX, panY, zoom) {
  _panX = panX;
  _panY = panY;
  _zoom = zoom;
}


// ============================================================================
// UNIT SYSTEM
// 'imperial' (in / lb / °F) or 'si' (mm / kg / °C).
// All internal values are stored in SI. Unit system controls display only.
// Default matches the existing file default.
// ============================================================================

var _unitSystem = 'imperial';

export function getUnitSystem()        { return _unitSystem; }
export function setUnitSystem(v)       { _unitSystem = v; }


// ============================================================================
// JOB DATA — GENERAL
// Logistical and material fields for the current job. Populated by the
// General tab of the left panel. Used by the calc engine and all exports.
//
// getGeneral() returns the live object reference — callers mutate fields
// directly (e.g. getGeneral().jobNumber = v). Use patchGeneral() when
// merging a saved payload back in (e.g. loadConfig).
// ============================================================================

var _general = {
  // Document
  jobNumber:   'JOB-001',
  partNumber:  '',
  partName:    '',
  revision:    'A',
  // People
  customer:    '',
  engineer:    '',
  // Status
  dateCreated: new Date().toISOString().slice(0, 10),
  status:      'draft',     // 'draft' | 'review' | 'approved' | 'released' | 'obsolete'
  notes:       '',
  // Material defaults (overridden by Stock In node params in calculations)
  material:    '4140',
  condition:   'annealed',
  density:     7.85,        // g/cm³
};

export function getGeneral()           { return _general; }

// Merge a partial or full object into _general — used by loadConfig.
export function patchGeneral(obj) {
  Object.assign(_general, obj);
}

// Full reset back to defaults — used when clearing a session.
export function resetGeneral() {
  _general.jobNumber   = 'JOB-001';
  _general.partNumber  = '';
  _general.partName    = '';
  _general.revision    = 'A';
  _general.customer    = '';
  _general.engineer    = '';
  _general.dateCreated = new Date().toISOString().slice(0, 10);
  _general.status      = 'draft';
  _general.notes       = '';
  _general.material    = '4140';
  _general.condition   = 'annealed';
  _general.density     = 7.85;
}
