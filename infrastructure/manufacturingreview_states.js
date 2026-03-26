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
//   Delivery order data  — general {}
//   Orders list          — orders[], activeOrderId, selectedOrderId, isDirty, _oid
//   Working folder       — workingFolderHandle
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
var _leftMode       = 'orders';    // 'orders' | 'general' | 'node_detail' | 'path'

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
// DELIVERY ORDER DATA — GENERAL
// Logistical and material fields for the current delivery order. Populated by
// the General tab of the left panel. Used by the calc engine and all exports.
//
// getGeneral() returns the live object reference — callers mutate fields
// directly (e.g. getGeneral().doNumber = v). Use patchGeneral() when
// merging a saved payload back in (e.g. loadConfig).
// ============================================================================

var _general = {
  // Document
  doNumber:    '',
  revision:    '',
  author:      '',
  estimator:   '',
  // Customer
  company:     '',
  customerNum: '',
  poNumber:    '',
  companyPhone:'',
  companyFax:  '',
  companyEmail:'',
  addrLine1:   '',
  addrLine2:   '',
  addrCity:    '',
  addrState:   '',
  addrZip:     '',
  addrCountry: '',
  // Buyer
  buyerName:   '',
  buyerPhone:  '',
  buyerEmail:  '',
  buyerFax:    '',
  // Status
  dateWritten:  '',
  datePromise:  '',
  dateShip:     '',
  dateArrival:  '',
  status:      'draft',     // 'draft' | 'review' | 'approved' | 'released' | 'obsolete'
  notes:       '',
  // Material defaults (overridden by Stock In node params in calculations)
  material:    '4140',
  condition:   'annealed',
  density:     7.85,        // g/cm³
  // Parent / child DO relationship
  isParent:       false,    // true if this order has been split into child batches
  isChild:        false,    // true if this order is a batch of a larger parent DO
  parentDoNumber: null,     // base DO number of the parent (string), null if not a child
  childCount:     0,        // number of child batches (only meaningful when isParent)
  // Quantity fields
  totalQuantity:  0,        // total parts across all batches (set on parent)
  batchQuantity:  0,        // parts in this specific batch (set on child)
  batchNotes:     '',       // notes specific to this batch
};

export function getGeneral()           { return _general; }

// Merge a partial or full object into _general — used by loadConfig.
export function patchGeneral(obj) {
  Object.assign(_general, obj);
}

// Full reset back to defaults — used when clearing a session.
export function resetGeneral() {
  _general.doNumber       = '';
  _general.revision       = '';
  _general.author         = '';
  _general.estimator    = '';
  _general.company      = '';
  _general.customerNum  = '';
  _general.poNumber     = '';
  _general.companyPhone = '';
  _general.companyFax   = '';
  _general.companyEmail = '';
  _general.addrLine1    = '';
  _general.addrLine2    = '';
  _general.addrCity     = '';
  _general.addrState    = '';
  _general.addrZip      = '';
  _general.addrCountry  = '';
  _general.buyerName    = '';
  _general.buyerPhone   = '';
  _general.buyerEmail   = '';
  _general.buyerFax     = '';
  _general.dateWritten  = new Date().toISOString().slice(0, 10);
  _general.datePromise  = '';
  _general.dateShip     = '';
  _general.dateArrival  = '';
  _general.status         = 'draft';
  _general.notes          = '';
  _general.material       = '4140';
  _general.condition      = 'annealed';
  _general.density        = 7.85;
  _general.isParent       = false;
  _general.isChild        = false;
  _general.parentDoNumber = null;
  _general.childCount     = 0;
  _general.totalQuantity  = 0;
  _general.batchQuantity  = 0;
  _general.batchNotes     = '';
}

// ============================================================================
// PART SPECIFICATION
// _part — the intended product definition for this delivery order.
// Separate from _general (logistics) — this is the engineering intent.
// Shape/material fields mirror the Stock Out / Stock In node param systems
// so the Part tab and nodes share the same vocabulary.
// ============================================================================

var _part = {
  // ── Part Identity ─────────────────────────────────────────────────────────
  partNumber:     '',
  partName:       '',
  partRevision:   '',       // revision of the part design (≠ Plan Revision in _general)

  // ── Target Geometry ───────────────────────────────────────────────────────
  // Mirrors the Stock Out node productType / shape system exactly.
  productType:    'bar',    // bar | disc | ring | mushroom
  // Bar
  barShape:       'round',  // round | rectangular | hexagonal
  isStepped:      'no',
  numSteps:       1,
  barDiameter:    100,
  barAcrossFlats: 100,
  barWidth:       100,
  barThickness:   50,
  barLength:      500,
  // Disc
  discOD:         300,
  discThickness:  80,
  // Ring
  ringOD:         400,
  ringID:         200,
  ringHeight:     100,
  odContour:      'none',   // none | forged | machined
  idContour:      'none',
  // Mushroom
  flangeDiam:     300,
  stemDiam:       100,
  totalHeight:    200,

  // ── Material Specification ────────────────────────────────────────────────
  materialFamily: 'carbon_steel',
  grade:          '4140',
  condition:      'annealed',   // target condition after all processing
  density:        7.85,         // g/cm³ — auto-filled from family, editable
  hardnessMin:    0,            // HB — 0 means no requirement
  hardnessMax:    0,

  // ── Quantity ──────────────────────────────────────────────────────────────
  quantity:       1,

  // ── Finish Requirements ───────────────────────────────────────────────────
  heatTreatReq:   'no',         // no | normalize | anneal | stress_relief | quench_temper
  machiningReq:   'no',         // no | yes
  certRequired:   'no',         // no | yes
  certType:       'C_of_C',     // C_of_C | material_test_report | first_article | PPAP | FAIR
};

export function getPart()        { return _part; }

// Merge a partial or full object into _part — used when loading a saved payload.
export function patchPart(obj) {
  Object.assign(_part, obj);
}

// Full reset back to defaults — called when clearing the session or opening a new order.
export function resetPart() {
  _part.partNumber     = '';
  _part.partName       = '';
  _part.partRevision   = '';
  _part.productType    = 'bar';
  _part.barShape       = 'round';
  _part.isStepped      = 'no';
  _part.numSteps       = 1;
  _part.barDiameter    = 100;
  _part.barAcrossFlats = 100;
  _part.barWidth       = 100;
  _part.barThickness   = 50;
  _part.barLength      = 500;
  _part.discOD         = 300;
  _part.discThickness  = 80;
  _part.ringOD         = 400;
  _part.ringID         = 200;
  _part.ringHeight     = 100;
  _part.odContour      = 'none';
  _part.idContour      = 'none';
  _part.flangeDiam     = 300;
  _part.stemDiam       = 100;
  _part.totalHeight    = 200;
  _part.materialFamily = 'carbon_steel';
  _part.grade          = '4140';
  _part.condition      = 'annealed';
  _part.density        = 7.85;
  _part.hardnessMin    = 0;
  _part.hardnessMax    = 0;
  _part.quantity       = 1;
  _part.heatTreatReq   = 'no';
  _part.machiningReq   = 'no';
  _part.certRequired   = 'no';
  _part.certType       = 'C_of_C';
}

// ============================================================================
// UI PREFERENCES — DESCRIPTIONS TOGGLE
// Controls whether description text is shown in each Summary working cell.
// Default true (on) — useful for new users; power users can turn it off.
// ============================================================================

var _showDescriptions = true;

export function getShowDescriptions()    { return _showDescriptions; }
export function setShowDescriptions(v)   { _showDescriptions = v; }

var _showMathematics = true;

export function getShowMathematics()     { return _showMathematics; }
export function setShowMathematics(v)    { _showMathematics = v; }

// ============================================================================
// UI PREFERENCES — TAG FILTERS
// Controls which tag categories appear in the summary panel workings grid.
// All on by default. Disabling a tag removes every working cell with that tag.
// ============================================================================

var _showTagInformation = true;
var _showTagDirection   = true;
var _showTagCalculation = true;

export function getShowTagInformation()    { return _showTagInformation; }
export function setShowTagInformation(v)   { _showTagInformation = v; }

export function getShowTagDirection()      { return _showTagDirection; }
export function setShowTagDirection(v)     { _showTagDirection = v; }

export function getShowTagCalculation()    { return _showTagCalculation; }
export function setShowTagCalculation(v)   { _showTagCalculation = v; }


// ============================================================================
// ORDERS LIST
// _orders — array of order objects known to the Orders panel.
//
// All orders are peers in a flat array — no nesting. Parent/child
// relationships are encoded in the doNumber field and the isParent/isChild
// flags. Grouping into a tree is done at render time only.
//
// Two loading shapes depending on whether the order has been opened:
//
//   Unloaded (scanned from folder, not yet opened):
//   {
//     id, filename, fileHandle,
//     doNumber, partNumber, partName, customer, status, dateCreated,
//     isParent, isChild, parentDoNumber, childCount,
//     loaded: false
//   }
//
//   Loaded (has been opened into the editor at least once):
//   {
//     id, filename, fileHandle,
//     doNumber, partNumber, partName, customer, status, dateCreated,
//     isParent, isChild, parentDoNumber, childCount,
//     loaded: true,
//     general: {...}, nodes: [...], connections: [...], nid, cid,
//     isDirty: false
//   }
//
// Session-only fields (never persisted to JSON):
//   isExpanded — whether the tree row is expanded to show children
//
// The currently active order's live edits always live in the main _general /
// _nodes / _connections state above. Before switching orders, callers must
// serialize the working copy back into the active order's slot here.
// ============================================================================

var _orders = [];

export function getOrders()              { return _orders; }
export function setOrders(v)             { _orders = v; }
export function pushOrder(order)         { _orders.push(order); }
export function findOrder(predicate)     { return _orders.find(predicate) || null; }
export function filterOrders(predicate)  { _orders = _orders.filter(predicate); }

// _activeOrderId — id of the order currently loaded into the canvas editor, or null.
var _activeOrderId = null;

export function getActiveOrderId()       { return _activeOrderId; }
export function setActiveOrderId(v)      { _activeOrderId = v; }

// _selectedOrderId — id of the order highlighted in the Orders list (single-click).
// NOT the same as active. Single-click = highlight only. Open button = activate.
var _selectedOrderId = null;

export function getSelectedOrderId()     { return _selectedOrderId; }
export function setSelectedOrderId(v)    { _selectedOrderId = v; }

// _isDirty — true when the active order has changes not yet saved to disk.
var _isDirty = false;

export function getIsDirty()             { return _isDirty; }
export function setIsDirty(v)            { _isDirty = v; }

// _oid — monotonically increasing counter for in-memory order IDs.
// These IDs are never persisted to JSON — they are session-only handles.
var _oid = 0;

export function nextOid()                { return 'order_' + (_oid++); }


// ============================================================================
// WORKING FOLDER
// The FileSystemDirectoryHandle selected by the user via the folder picker.
// Null until the user picks a folder or a previous handle is restored from
// IndexedDB by manufacturingreview_deliveryorder.restoreWorkingFolder().
// ============================================================================

var _workingFolderHandle = null;

export function getWorkingFolderHandle()  { return _workingFolderHandle; }
export function setWorkingFolderHandle(v) { _workingFolderHandle = v; }