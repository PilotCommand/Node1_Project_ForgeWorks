// ============================================================================
// manufacturingreview.js — Manufacturing Review v2 (Node Flow Editor)
// Forgeworks Infrastructure
// ============================================================================
//
// Layout:
//   Top bar    — navigation, title
//   Left panel — general job inputs / selected node parameters
//   Center     — process flow canvas (right-click to add nodes, drag to connect)
//   Right panel — chain mass-balance calculations
//   Bottom bar  — save, load, print
//
// Canvas interaction:
//   Right-click empty area  → context menu → add node type
//   Right-click on node     → delete / duplicate
//   Drag node body          → move node
//   Drag from output port ● → draw connection to input port ●
//   Click node              → select (shows params in left panel)
//   Click empty canvas      → deselect
//   Delete key              → delete selected node
//
// Exports: show(), hide(), isVisible(), onBack(callback)
// ============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unit System — import helpers from measurementunits.js and wrap them
// ---------------------------------------------------------------------------

import { setDisplaySystem, formatValue, convert, celsiusToFahrenheit } from './measurementunits.js';
import {
  NODE_W, NODE_H, PORT_R, PORT_HIT, ACCENT, ACCENT_DIM,
  MATERIAL_CATALOG, NODE_DEFS,
  round3, fmtVol, computeChain,
  dMass, dLen, dTemp, dVol, dDensity, dMassUnit, dLenUnit, dTempUnit, dVolUnit, dDensUnit,
  toDisplay, fromDisplay, unitSuffix, scaleParam,
  buildInputSection, buildTextInput, buildNumberInputEl,
  buildSelectEl, buildTextareaInput, fWrap, fLabel, sInput,
} from './manufacturingreview_defs.js';
import * as S from './manufacturingreview_states.js';
import {
  init        as initProcess,
  buildCanvasPanel,
  applyWorldTransform,
  resetView,
  createNode,
  renderNodeEl,
  refreshNodeEl,
  removeNodeEl,
  refreshCanvasOverlay,
  selectNode,
  deleteNode,
  setNodeSelected,
  addConnection,
  selectConn,
  deleteConn,
  refreshConnections,
  dismissContextMenu,
  onMouseMove,
  onMouseUp,
  onKeyDown,
} from './manufacturingreview_process.js';
import {
  buildCalcPanel,
  refreshCalcPanel,
} from './manufacturingreview_summary.js';
import {
  buildRightPanel,
  showRightPlaceholder,
  refreshRightPanel,
  buildStepWorkings,
} from './manufacturingreview_estimates.js';
import {
  init           as initInputs,
  buildLeftPanel,
  refreshLeftPanel,
  refreshOrdersPanel,
} from './manufacturingreview_inputs.js';
import * as FS from './manufacturingreview_deliveryorder.js';


function setUnitSystem(sys) {
  S.setUnitSystem(sys);
  setDisplaySystem(sys);
  // Refresh all node card previews on canvas
  S.getNodes().forEach(function(n) { refreshNodeEl(n.id); });
  // Refresh all display panels
  refreshRightPanel(); refreshCalcPanel();
  refreshLeftPanel();
}

// ===========================================================================
// DOM BUILDER
// ===========================================================================

function refreshStatusBadge() {
  var el    = document.getElementById('mr-g-status-badge');
  var val   = document.getElementById('mr-strip-do-value');
  if (!el) return;

  var activeId = S.getActiveOrderId();
  var order    = activeId ? S.findOrder(function(o) { return o.id === activeId; }) : null;

  if (val) val.textContent = (order && order.doNumber) ? '\u00a0' + order.doNumber : '';

  if (!order) {
    el.textContent        = 'NO ORDER';
    el.style.background   = 'rgba(255,255,255,0.03)';
    el.style.color        = '#3a5060';
    el.style.borderColor  = 'rgba(255,255,255,0.08)';
    return;
  }

  // Right badge — file state of the active order
  if (order.isExample) {
    el.textContent       = 'EXAMPLE';
    el.style.background  = 'rgba(46,196,182,0.08)';
    el.style.color       = '#2ec4b6';
    el.style.borderColor = 'rgba(46,196,182,0.5)';
  } else if (order.fileHandle || order.filename) {
    el.textContent       = 'SAVED';
    el.style.background  = 'rgba(80,208,128,0.06)';
    el.style.color       = '#50d080';
    el.style.borderColor = 'rgba(80,208,128,0.5)';
  } else {
    el.textContent       = 'DRAFT';
    el.style.background  = 'rgba(233,196,106,0.08)';
    el.style.color       = '#e9c46a';
    el.style.borderColor = 'rgba(233,196,106,0.5)';
  }
}

function buildOverlay() {
  if (S.getOverlay()) return;
  injectStyles();

  // Wire cross-panel refresh callbacks into the process module
  initProcess({
    refreshLeftPanel:  refreshLeftPanel,
    refreshRightPanel: refreshRightPanel,
    refreshCalcPanel:  refreshCalcPanel,
  });

  initInputs({
    refreshRightPanel:  refreshRightPanel,
    refreshCalcPanel:   refreshCalcPanel,
    refreshNodeEl:      refreshNodeEl,
    refreshStatusBadge: refreshStatusBadge,
    openOrder:          openOrder,
    saveActiveOrder:    saveActiveOrder,
  });

  // Add the permanent example delivery order (always first in the list).
  // Only added once — guard prevents duplication if buildOverlay is somehow
  // called again after a partial teardown.
  if (!S.findOrder(function(o) { return o.isExample; })) {
    S.pushOrder(buildExampleOrder());
  }

  // Attempt to restore the previously selected working folder (async, non-blocking).
  // On success, scans the folder and populates the Orders list.
  if (FS.isSupported()) {
    FS.restoreWorkingFolder().then(function(handle) {
      if (!handle) return null;
      S.setWorkingFolderHandle(handle);
      return FS.scanFolder(handle);
    }).then(function(results) {
      if (!results) return;
      results.forEach(function(r) {
        S.pushOrder({
          id:             S.nextOid(),
          filename:       r.filename,
          fileHandle:     r.fileHandle,
          doNumber:       r.doNumber,
          partNumber:     r.partNumber,
          partName:       r.partName,
          customer:       r.customer,
          status:         r.status,
          dateCreated:    r.dateCreated,
          version:        r.version,
          isParent:       r.isParent,
          isChild:        r.isChild,
          parentDoNumber: r.parentDoNumber,
          childCount:     r.childCount,
          isExpanded:     false,
          loaded:         false,
        });
      });
      refreshOrdersPanel();
    }).catch(function() {
      // Permission denied or no saved folder — silent, user will pick manually
    });
  }

  S.setOverlay(document.createElement('div'));
  S.getOverlay().id = 'forgeworks-mfg-review';
  Object.assign(S.getOverlay().style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '9999', display: 'flex', flexDirection: 'column',
    background: '#060b11', overflow: 'hidden',
    fontFamily: "'Consolas','SF Mono','Fira Code','Monaco',monospace",
    color: '#aabbcc',
  });

  var bg = document.createElement('div');
  Object.assign(bg.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none',
    background: 'radial-gradient(ellipse 70% 50% at 15% 100%,' + ACCENT_DIM + '0.04) 0%,transparent 70%)',
  });
  S.getOverlay().appendChild(bg);

  S.getOverlay().appendChild(buildTopBar());

  // Panels are built first so we can pass their refs to handles
  var leftPanel  = buildLeftPanel();
  var rightPanel = buildRightPanel();
  var calcPanel  = buildCalcPanel();

  // Outer vertical container: three-panel row on top, calc panel below
  var outer = document.createElement('div');
  Object.assign(outer.style, { flex: '1', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: '2' });

  var body = document.createElement('div');
  Object.assign(body.style, { flex: '1', display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: '0' });
  body.appendChild(leftPanel);
  body.appendChild(buildPanelHandle(leftPanel,  'x', +1, 280,  60, 800));
  body.appendChild(buildCanvasPanel());
  body.appendChild(buildPanelHandle(rightPanel, 'x', -1, 300,  60, 800));
  body.appendChild(rightPanel);
  outer.appendChild(body);

  outer.appendChild(buildPanelHandle(calcPanel, 'y', -1, 280, 38, 700));
  outer.appendChild(calcPanel);
  S.getOverlay().appendChild(outer);

  S.getOverlay().appendChild(buildActionBar());
  document.body.appendChild(S.getOverlay());

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);
  document.addEventListener('keydown',   onKeyDown);
}

// ---------------------------------------------------------------------------
// Panel Resize / Collapse Handles
//
// axis  — 'x' for left/right side panels, 'y' for the calc panel
// sign  — +1 if dragging positive axis grows panel, −1 if it shrinks it
//          left panel:  sign +1  (drag right → wider)
//          right panel: sign −1  (drag right → narrower, left → wider)
//          calc panel:  sign −1  (drag down  → shorter,  up   → taller)
// ---------------------------------------------------------------------------

function buildPanelHandle(panel, axis, sign, defaultPx, minPx, maxPx) {
  var isX = axis === 'x';

  var handle = document.createElement('div');
  Object.assign(handle.style, {
    position: 'relative', flexShrink: '0',
    width:  isX ? '6px' : '100%',
    height: isX ? '100%' : '6px',
    cursor: isX ? 'col-resize' : 'row-resize',
    background: 'rgba(255,255,255,0.03)',
    transition: 'background 0.15s ease',
    zIndex: '5',
    overflow: 'visible',
  });
  handle.addEventListener('mouseenter', function() { handle.style.background = 'rgba(255,255,255,0.08)'; });
  handle.addEventListener('mouseleave', function() { handle.style.background = 'rgba(255,255,255,0.03)'; });

  // ── Collapse arrow tab ────────────────────────────────────────────────────
  // Arrows — calc panel open=▼ (click to collapse down), closed=▲ (click to expand up)
  var openArrow  = isX ? (sign > 0 ? '◀' : '▶') : '▼';
  var closeArrow = isX ? (sign > 0 ? '▶' : '◀') : '▲';

  var tab = document.createElement('div');

  // Positioning: flush with the canvas-facing edge, centred along the other axis
  var tabPos = {};
  if (isX) {
    tabPos = sign > 0
      ? { top: '50%', left: '100%',  transform: 'translateY(-50%)', borderRadius: '0 4px 4px 0' }
      : { top: '50%', right: '100%', transform: 'translateY(-50%)', borderRadius: '4px 0 0 4px' };
  } else {
    tabPos = { left: '50%', bottom: '100%', transform: 'translateX(-50%)', borderRadius: '4px 4px 0 0' };
  }

  Object.assign(tab.style, Object.assign({
    position: 'absolute',
    width:  isX ? '14px' : '36px',
    height: isX ? '36px' : '14px',
    background: ACCENT_DIM + '0.18)',
    border: '1px solid ' + ACCENT_DIM + '0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '8px', color: ACCENT,
    userSelect: 'none',
    transition: 'background 0.15s ease, color 0.15s ease',
    zIndex: '6',
  }, tabPos));

  tab.textContent = openArrow;
  tab.addEventListener('mouseenter', function() {
    tab.style.background = ACCENT_DIM + '0.35)';
    tab.style.color = '#ffb090';
  });
  tab.addEventListener('mouseleave', function() {
    tab.style.background = ACCENT_DIM + '0.18)';
    tab.style.color = ACCENT;
  });
  handle.appendChild(tab);

  // ── Collapse state ────────────────────────────────────────────────────────
  var collapsed = false;
  var savedPx   = defaultPx;

  function applySize(px) {
    if (isX) {
      panel.style.width    = px + 'px';
      panel.style.minWidth = px > 0 ? minPx + 'px' : '0';
      panel.style.overflow = px < 30 ? 'hidden' : '';
    } else {
      panel.style.height    = px + 'px';
      panel.style.minHeight = px > 0 ? minPx + 'px' : '0';
      panel.style.overflow  = px < 30 ? 'hidden' : '';
    }
  }

  tab.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!collapsed) {
      savedPx = isX ? panel.offsetWidth : panel.offsetHeight;
      collapsed = true;
      applySize(0);
      tab.textContent = closeArrow;
    } else {
      collapsed = false;
      applySize(savedPx);
      tab.textContent = openArrow;
    }
  });

  // ── Drag resize ───────────────────────────────────────────────────────────
  var dragging   = false;
  var dragOrigin = 0;
  var sizeOrigin = 0;

  handle.addEventListener('mousedown', function(e) {
    if (e.target === tab) return;
    e.preventDefault();
    dragging   = true;
    dragOrigin = isX ? e.clientX : e.clientY;
    sizeOrigin = isX ? panel.offsetWidth : panel.offsetHeight;
    document.body.style.cursor    = isX ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var delta  = isX ? (e.clientX - dragOrigin) : (e.clientY - dragOrigin);
    var newPx  = Math.max(minPx, Math.min(maxPx, sizeOrigin + sign * delta));
    collapsed  = false;
    tab.textContent = openArrow;
    applySize(newPx);
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    savedPx = isX ? panel.offsetWidth : panel.offsetHeight;
  });

  return handle;
}

// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function buildTopBar() {
  var bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative', zIndex: '3', display: 'flex', alignItems: 'center',
    padding: '0 24px', height: '52px', minHeight: '52px',
    borderBottom: '1px solid ' + ACCENT_DIM + '0.18)',
    background: 'rgba(4,8,14,0.9)', backdropFilter: 'blur(8px)', gap: '16px',
  });

  var backBtn = document.createElement('button');
  styleBarBtn(backBtn);
  backBtn.innerHTML = '<span style="font-size:14px;line-height:1">‹</span> MENU';
  backBtn.addEventListener('click', function() { if (S.getBackCallback()) S.getBackCallback()(); });
  bar.appendChild(backBtn);

  var sep = document.createElement('div');
  Object.assign(sep.style, { width: '1px', height: '20px', background: 'rgba(255,255,255,0.20)' });
  bar.appendChild(sep);

  var title = document.createElement('div');
  Object.assign(title.style, { fontSize: '12px', fontWeight: '600', letterSpacing: '3px', textTransform: 'uppercase', color: ACCENT });
  title.textContent = 'Manufacturing Review';
  bar.appendChild(title);

  var tag = document.createElement('div');
  Object.assign(tag.style, {
    fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase',
    color: '#99aabc', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.22)', borderRadius: '2px',
  });
  tag.textContent = 'Process Flow Editor';
  bar.appendChild(tag);

  var sp = document.createElement('div'); sp.style.flex = '1';
  bar.appendChild(sp);

  // Zoom indicator + reset
  var zoomIndicator = document.createElement('div');
  zoomIndicator.id = 'mr-zoom-indicator';
  Object.assign(zoomIndicator.style, {
    fontSize: '9px', letterSpacing: '1px', color: '#7a9aaa',
    cursor: 'pointer', padding: '4px 8px',
    border: '1px solid rgba(255,255,255,0.18)', borderRadius: '2px',
    transition: 'all 0.2s ease',
  });
  zoomIndicator.textContent = '100%';
  zoomIndicator.title = 'Click to reset view';
  zoomIndicator.addEventListener('mouseenter', function() { zoomIndicator.style.color = '#99aacc'; zoomIndicator.style.borderColor = 'rgba(255,255,255,0.18)'; });
  zoomIndicator.addEventListener('mouseleave', function() { zoomIndicator.style.color = '#445566'; zoomIndicator.style.borderColor = 'rgba(255,255,255,0.18)'; });
  zoomIndicator.addEventListener('click', function() { resetView(); updateZoomIndicator(); });
  bar.appendChild(zoomIndicator);

  var hint = document.createElement('div');
  Object.assign(hint.style, { fontSize: '9px', letterSpacing: '1px', color: '#6a8090' });
  hint.textContent = 'Drag canvas to pan  ·  Scroll to S.getZoom()  ·  Right-click canvas to add  ·  Click connection to select  ·  Del to remove';
  bar.appendChild(hint);

  var al = document.createElement('div');
  Object.assign(al.style, {
    position: 'absolute', bottom: '0', left: '0', width: '100%', height: '1px',
    background: 'linear-gradient(90deg,' + ACCENT + '44,' + ACCENT + '11 60%,transparent)', pointerEvents: 'none',
  });
  bar.appendChild(al);
  return bar;
}

// ---------------------------------------------------------------------------
// Action Bar
// ---------------------------------------------------------------------------

function buildActionBar() {
  var bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative', zIndex: '3', display: 'flex', alignItems: 'center',
    padding: '0 24px', height: '48px', minHeight: '48px',
    borderTop: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(4,8,14,0.85)', gap: '10px',
  });

  var saveBtn  = makeBarButton('Save Order',  '↓');
  var loadBtn  = makeBarButton('Import JSON', '↑');
  saveBtn.addEventListener('click', saveActiveOrder);
  loadBtn.addEventListener('click', importJson);
  bar.appendChild(saveBtn); bar.appendChild(loadBtn);

  // ── Tag filter group (Information · Calculations · Directions) ────────────
  var tagGroup = document.createElement('div');
  Object.assign(tagGroup.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '3px', padding: '4px 12px',
  });

  function makeTagOpt(text, color, getter, setter) {
    var lbl = document.createElement('label');
    Object.assign(lbl.style, {
      display: 'flex', alignItems: 'center', gap: '5px',
      cursor: 'pointer', userSelect: 'none',
      fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
      color: getter() ? color : '#7a9aaa',
      transition: 'color 0.15s ease',
    });
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = getter();
    Object.assign(cb.style, {
      width: '11px', height: '11px',
      accentColor: color, cursor: 'pointer',
    });
    cb.addEventListener('change', function() {
      setter(cb.checked);
      lbl.style.color = cb.checked ? color : '#7a9aaa';
      refreshCalcPanel();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(text));
    return lbl;
  }

  function makeTagSep() {
    var s = document.createElement('div');
    Object.assign(s.style, {
      width: '1px', height: '14px',
      background: 'rgba(255,255,255,0.18)', margin: '0 4px',
    });
    return s;
  }

  tagGroup.appendChild(makeTagOpt('Information',  '#5ba3d9', S.getShowTagInformation, S.setShowTagInformation));
  tagGroup.appendChild(makeTagSep());
  tagGroup.appendChild(makeTagOpt('Calculations', '#6dbd8a', S.getShowTagCalculation, S.setShowTagCalculation));
  tagGroup.appendChild(makeTagSep());
  tagGroup.appendChild(makeTagOpt('Directions',   '#c9a84c', S.getShowTagDirection,   S.setShowTagDirection));
  bar.appendChild(tagGroup);

  // ── Unit system toggle (centred) ─────────────────────────────────────────
  var unitToggle = document.createElement('div');
  Object.assign(unitToggle.style, {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '3px', padding: '4px 12px',
  });

  function makeUnitOpt(label, value) {
    var wrap = document.createElement('label');
    Object.assign(wrap.style, {
      display: 'flex', alignItems: 'center', gap: '5px',
      cursor: 'pointer', fontSize: '9px', letterSpacing: '1.5px',
      textTransform: 'uppercase', color: S.getUnitSystem() === value ? ACCENT : '#7a9aaa',
      transition: 'color 0.15s ease', userSelect: 'none',
    });
    wrap.id = 'mr-unit-label-' + value;

    var cb = document.createElement('input');
    cb.type = 'radio';
    cb.name = 'mr-unit-system';
    cb.value = value;
    cb.checked = S.getUnitSystem() === value;
    Object.assign(cb.style, {
      accentColor: ACCENT, cursor: 'pointer', width: '11px', height: '11px',
    });
    cb.addEventListener('change', function() {
      if (cb.checked) {
        S.setUnitSystem(value);
        ['si', 'imperial'].forEach(function(v) {
          var lbl = document.getElementById('mr-unit-label-' + v);
          if (lbl) lbl.style.color = S.getUnitSystem() === v ? ACCENT : '#7a9aaa';
        });
        setUnitSystem(value);
      }
    });

    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  var sep = document.createElement('div');
  Object.assign(sep.style, {
    width: '1px', height: '14px',
    background: 'rgba(255,255,255,0.18)', margin: '0 4px',
  });

  unitToggle.appendChild(makeUnitOpt('Imperial', 'imperial'));
  unitToggle.appendChild(sep);
  unitToggle.appendChild(makeUnitOpt('Metric', 'si'));
  bar.appendChild(unitToggle);

  var sp1 = document.createElement('div'); sp1.style.flex = '1';
  bar.appendChild(sp1);

  // ── View options group (Descriptions · Mathematics) ──────────────────────
  var viewGroup = document.createElement('div');
  Object.assign(viewGroup.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '3px', padding: '4px 12px',
  });

  function makeViewOpt(text, getter, setter) {
    var lbl = document.createElement('label');
    Object.assign(lbl.style, {
      display: 'flex', alignItems: 'center', gap: '5px',
      cursor: 'pointer', userSelect: 'none',
      fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
      color: getter() ? ACCENT : '#7a9aaa',
      transition: 'color 0.15s ease',
    });
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = getter();
    Object.assign(cb.style, {
      width: '11px', height: '11px',
      accentColor: ACCENT, cursor: 'pointer',
    });
    cb.addEventListener('change', function() {
      setter(cb.checked);
      lbl.style.color = cb.checked ? ACCENT : '#7a9aaa';
      refreshCalcPanel();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(text));
    return lbl;
  }

  var viewSep = document.createElement('div');
  Object.assign(viewSep.style, {
    width: '1px', height: '14px',
    background: 'rgba(255,255,255,0.18)', margin: '0 4px',
  });

  viewGroup.appendChild(makeViewOpt('Descriptions', S.getShowDescriptions, S.setShowDescriptions));
  viewGroup.appendChild(viewSep);
  viewGroup.appendChild(makeViewOpt('Mathematics',  S.getShowMathematics,  S.setShowMathematics));
  bar.appendChild(viewGroup);

  // ── Export dropdown ───────────────────────────────────────────────────────
  var exportWrap = document.createElement('div');
  Object.assign(exportWrap.style, { position: 'relative', display: 'inline-block' });

  var exportBtn = makeBarButton('Export', '⬆');
  exportBtn.style.paddingRight = '22px';

  // Caret
  var caret = document.createElement('span');
  Object.assign(caret.style, {
    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
    fontSize: '8px', color: '#7a9aaa', pointerEvents: 'none',
  });
  caret.textContent = '▾';
  exportBtn.style.position = 'relative';
  exportBtn.appendChild(caret);

  // Dropdown menu
  var exportMenu = document.createElement('div');
  Object.assign(exportMenu.style, {
    position: 'absolute', bottom: '110%', right: '0',
    background: '#0a1520', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '3px', minWidth: '160px', overflow: 'hidden',
    display: 'none', flexDirection: 'column',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.6)', zIndex: '999',
  });

  var exportOptions = [
    { label: 'Print to PDF',  icon: '⎙', fn: function() { printToPDF(); } },
    { label: 'Export Excel',  icon: '⊞', fn: function() { exportToExcel(); } },
    { label: 'Export CSV',    icon: '≡', fn: function() { exportToCSV(); } },
    { label: 'Export .txt',   icon: '≡', fn: function() { exportToTxt(); } },
  ];

  exportOptions.forEach(function(opt) {
    var item = document.createElement('button');
    Object.assign(item.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      width: '100%', padding: '9px 14px',
      background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)',
      color: '#99aacc', fontSize: '10px', fontFamily: 'inherit',
      letterSpacing: '1px', cursor: 'pointer', textAlign: 'left',
      transition: 'background 0.1s ease',
    });
    item.innerHTML = '<span style="opacity:0.6;font-size:12px">' + opt.icon + '</span>' + opt.label;
    item.addEventListener('mouseenter', function() { item.style.background = 'rgba(255,255,255,0.06)'; item.style.color = ACCENT; });
    item.addEventListener('mouseleave', function() { item.style.background = 'none'; item.style.color = '#99aacc'; });
    item.addEventListener('click', function() {
      exportMenu.style.display = 'none';
      opt.fn();
    });
    exportMenu.appendChild(item);
  });

  exportBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var open = exportMenu.style.display === 'flex';
    exportMenu.style.display = open ? 'none' : 'flex';
  });
  document.addEventListener('click', function() { exportMenu.style.display = 'none'; });

  exportWrap.appendChild(exportBtn);
  exportWrap.appendChild(exportMenu);
  bar.appendChild(exportWrap);

  var vtag = document.createElement('div');
  Object.assign(vtag.style, { fontSize: '9px', letterSpacing: '2px', color: '#7a9aaa' });
  vtag.textContent = 'MFG-REVIEW v2.0';
  bar.appendChild(vtag);

  return bar;
}

function makeBarButton(label, icon) {
  var btn = document.createElement('button');
  styleBarBtn(btn);
  btn.innerHTML = '<span>' + icon + '</span> ' + label;
  return btn;
}

function styleBarBtn(btn) {
  Object.assign(btn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.20)', borderRadius: '3px',
    color: '#99aacc', cursor: 'pointer', padding: '5px 14px', fontSize: '10px',
    fontFamily: 'inherit', letterSpacing: '1px', transition: 'all 0.2s ease',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  btn.addEventListener('mouseenter', function() { btn.style.borderColor = ACCENT_DIM + '0.5)'; btn.style.color = ACCENT; });
  btn.addEventListener('mouseleave', function() { btn.style.borderColor = 'rgba(255,255,255,0.20)'; btn.style.color = '#99aacc'; });
}


export var SAVE_VERSION = '5.0';

// ---------------------------------------------------------------------------
// Build the canonical save payload from current state
// ---------------------------------------------------------------------------

function buildSavePayload() {
  var nodeSnapshot = S.getNodes().map(function(n) {
    return { id: n.id, type: n.type, label: n.label, x: n.x, y: n.y,
             params: JSON.parse(JSON.stringify(n.params || {})) };
  });
  return {
    _version:    SAVE_VERSION,
    _type:       'forgeworks-mfg-review',
    _savedAt:    new Date().toISOString(),
    _unitSystem: S.getUnitSystem(),
    _nid:        S.getNid(),
    _cid:        S.getCid(),
    general:     JSON.parse(JSON.stringify(S.getGeneral())),
    nodes:       nodeSnapshot,
    connections: JSON.parse(JSON.stringify(S.getConnections())),
  };
}

// ---------------------------------------------------------------------------
// downloadOrderJson — fallback: triggers a browser file download
// ---------------------------------------------------------------------------

function downloadOrderJson(payload) {
  var json = JSON.stringify(payload, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.download = FS.buildOrderFilename(S.getGeneral());
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded — ' + a.download);
}

// ---------------------------------------------------------------------------
// saveActiveOrder — primary save: writes to folder if available, else download
// ---------------------------------------------------------------------------

function saveActiveOrder() {
  var payload    = buildSavePayload();
  var activeId   = S.getActiveOrderId();
  var folderHandle = S.getWorkingFolderHandle();

  if (!folderHandle) {
    downloadOrderJson(payload);
    showToast('Saved as download.\nSelect a working folder in the Orders tab to save directly to disk.');
    return;
  }

  var order    = activeId ? S.findOrder(function(o) { return o.id === activeId; }) : null;
  var filename = (order && order.filename) ? order.filename : FS.buildOrderFilename(S.getGeneral());

  FS.saveOrderToFolder(folderHandle, filename, payload, order && order.filename ? { forceOverwrite: true } : {})
    .then(function(fileHandle) {
      if (order) {
        order.fileHandle = fileHandle;
        order.filename   = filename;
        order.loaded     = true;
        order.isDirty    = false;
        // Keep summary metadata in sync
        order.doNumber    = S.getGeneral().doNumber;
        order.partNumber  = S.getGeneral().partNumber;
        order.partName    = S.getGeneral().partName;
        order.status      = S.getGeneral().status;
      }
      S.setIsDirty(false);
      refreshOrdersPanel();
      refreshStatusBadge();
      showToast('Saved — ' + filename);
    })
    .catch(function(err) {
      showToast('Save failed: ' + err.message + '\nFalling back to download.');
      downloadOrderJson(payload);
    });
}

// ---------------------------------------------------------------------------
// openOrder — serialize current, load target, refresh all panels
// ---------------------------------------------------------------------------

function openOrder(orderId) {
  // 1. Serialize the currently active order back to its slot
  var currentId = S.getActiveOrderId();
  if (currentId) {
    var currentSlot = S.findOrder(function(o) { return o.id === currentId; });
    if (currentSlot) {
      currentSlot.general     = JSON.parse(JSON.stringify(S.getGeneral()));
      currentSlot.nodes       = JSON.parse(JSON.stringify(S.getNodes()));
      currentSlot.connections = JSON.parse(JSON.stringify(S.getConnections()));
      currentSlot.nid         = S.getNid();
      currentSlot.cid         = S.getCid();
      currentSlot.loaded      = true;
      currentSlot.isDirty     = S.getIsDirty();
    }
  }

  var order = S.findOrder(function(o) { return o.id === orderId; });
  if (!order) return;

  // 2. If not yet fully loaded from disk, read the file now
  if (!order.loaded && order.fileHandle) {
    S.setActiveOrderId(orderId);   // set early so guards see correct state
    FS.readOrderFile(order.fileHandle)
      .then(function(payload) {
        applyPayloadToState(payload);
        order.loaded = true;
        S.setIsDirty(false);
        refreshOrdersPanel();
      })
      .catch(function(err) {
        S.setActiveOrderId(currentId || null);  // roll back on failure
        showToast('Failed to open order: ' + err.message);
      });
    return;
  }

  // 3. Already loaded in memory — apply directly
  S.setActiveOrderId(orderId);   // set early so all refresh guards see correct state
  applyOrderToState(order);
  S.setIsDirty(false);
  refreshOrdersPanel();
}

// Apply a fully loaded order object (from memory) into the live state
function applyOrderToState(order) {
  // Clear existing canvas nodes
  S.getNodes().forEach(function(n) { removeNodeEl(n.id); });
  S.setNodes([]);
  S.setConnections([]);

  // Reset general to blank defaults first, then overlay saved fields if they exist
  S.resetGeneral();
  if (order.general) S.patchGeneral(order.general);
  S.setNid(order.nid || 0);
  S.setCid(order.cid || 0);

  (order.nodes || []).forEach(function(nd) {
    S.pushNode(nd);
    renderNodeEl(nd);
  });

  S.setConnections(JSON.parse(JSON.stringify(order.connections || [])));

  refreshConnections();
  refreshLeftPanel();
  refreshRightPanel();
  refreshCalcPanel();
  refreshStatusBadge();
  S.resetViewport();
  applyWorldTransform();

  refreshCanvasOverlay();
}

// Apply a raw JSON payload (from file read) into the live state — with migration
function applyPayloadToState(payload) {
  var warnings = [];

  // v3.0 migration: jobNumber → doNumber
  if (payload.general && payload.general.jobNumber && !payload.general.doNumber) {
    payload.general.doNumber = payload.general.jobNumber;
  }

  // v4.0 → v5.0 migration: fill in new parent/child fields with safe defaults
  // so old files load correctly without any data loss
  if (payload.general) {
    if (payload.general.isParent       === undefined) payload.general.isParent       = false;
    if (payload.general.isChild        === undefined) payload.general.isChild        = false;
    if (payload.general.parentDoNumber === undefined) payload.general.parentDoNumber = null;
    if (payload.general.childCount     === undefined) payload.general.childCount     = 0;
    if (payload.general.totalQuantity  === undefined) payload.general.totalQuantity  = 0;
    if (payload.general.batchQuantity  === undefined) payload.general.batchQuantity  = 0;
    if (payload.general.batchNotes     === undefined) payload.general.batchNotes     = '';
  }

  S.resetGeneral();
  if (payload.general) S.patchGeneral(payload.general);

  if (payload._unitSystem === 'si' || payload._unitSystem === 'imperial') {
    S.setUnitSystem(payload._unitSystem);
    setDisplaySystem(S.getUnitSystem());
    ['si', 'imperial'].forEach(function(v) {
      var lbl = document.getElementById('mr-unit-label-' + v);
      if (lbl) lbl.style.color = S.getUnitSystem() === v ? ACCENT : '#7a9aaa';
      var rb = document.querySelector('input[name="mr-unit-system"][value="' + v + '"]');
      if (rb) rb.checked = S.getUnitSystem() === v;
    });
  }

  S.getNodes().forEach(function(n) { removeNodeEl(n.id); });
  S.setNodes([]);
  S.setConnections([]);
  S.setNid(payload._nid || 0);
  S.setCid(payload._cid || 0);

  (payload.nodes || []).forEach(function(nd) {
    var def = NODE_DEFS[nd.type];
    if (!def) { warnings.push('Unknown node type "' + nd.type + '" — skipped.'); return; }
    var migratedParams = JSON.parse(JSON.stringify(def.defaultParams || {}));
    if (nd.params) Object.keys(nd.params).forEach(function(k) { migratedParams[k] = nd.params[k]; });
    var node = { id: nd.id, type: nd.type, label: nd.label || def.label,
                 x: nd.x || 100, y: nd.y || 100, params: migratedParams };
    S.pushNode(node);
    renderNodeEl(node);
  });

  var validNodeIds = S.getNodes().map(function(n) { return n.id; });
  S.setConnections((payload.connections || []).filter(function(c) {
    var ok = validNodeIds.indexOf(c.fromId) > -1 && validNodeIds.indexOf(c.toId) > -1;
    if (!ok) warnings.push('Connection ' + c.id + ' references missing node — removed.');
    return ok;
  }));

  refreshConnections();
  refreshLeftPanel();
  refreshRightPanel();
  refreshCalcPanel();
  refreshStatusBadge();
  S.resetViewport();
  applyWorldTransform();

  if (warnings.length > 0) showToast('Warnings:\n' + warnings.join('\n'));
}

function importJson() {
  var fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.json';
  fi.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var p = JSON.parse(ev.target.result);

        // Type check
        if (p._type !== 'forgeworks-mfg-review') {
          alert('Not a valid Forgeworks Manufacturing Review file.\n\nExpected _type "forgeworks-mfg-review".');
          return;
        }

        // jobNumber → doNumber migration for v3.0 files
        if (p.general && p.general.jobNumber && !p.general.doNumber) {
          p.general.doNumber = p.general.jobNumber;
        }

        var fileVer = parseFloat(p._version || '1.0');

        // Add as a new in-memory order and open it
        var g = p.general || {};
        var newOrder = {
          id:          S.nextOid(),
          filename:    file.name,
          fileHandle:  null,    // imported from outside the working folder — no handle
          doNumber:    g.doNumber   || '',
          partNumber:  g.partNumber || '',
          partName:    g.partName   || '',
          customer:    g.customer   || '',
          status:      g.status     || 'draft',
          dateCreated: g.dateCreated|| '',
          version:     p._version   || '1.0',
          loaded:      true,
          general:     g,
          nodes:       p.nodes       || [],
          connections: p.connections || [],
          nid:         p._nid || 0,
          cid:         p._cid || 0,
          isDirty:     false,
        };
        S.pushOrder(newOrder);
        S.setSelectedOrderId(newOrder.id);
        S.setActiveOrderId(newOrder.id);   // set before apply so guards unlock correctly

        applyPayloadToState(p);
        S.setIsDirty(false);

        var msg = 'Imported: ' + file.name +
          '\n' + S.getNodes().length + ' nodes · ' + S.getConnections().length + ' connections' +
          (fileVer < parseFloat(SAVE_VERSION) ? '\nMigrated from v' + fileVer + ' → v' + SAVE_VERSION : '');
        showToast(msg);

      } catch (err) {
        alert('Failed to import:\n' + err.message);
      }
    };
    reader.readAsText(file);
  });
  fi.click();
}

// Brief non-blocking toast notification
function showToast(msg) {
  var existing = document.getElementById('mr-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'mr-toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(10,20,30,0.95)', border: '1px solid rgba(100,180,255,0.3)',
    color: '#99ccee', fontFamily: 'inherit', fontSize: '10px', letterSpacing: '0.8px',
    padding: '10px 20px', borderRadius: '4px', zIndex: '99999',
    maxWidth: '480px', textAlign: 'center', lineHeight: '1.5',
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
    whiteSpace: 'pre-line',
    opacity: '0', transition: 'opacity 0.2s ease',
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.style.opacity = '1'; });
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
  }, 3500);
}

// ---------------------------------------------------------------------------
// Export — shared filter helpers
// Apply the current UI toggles to a workings array, returning only the
// cells that are currently visible in the summary panel.
// ---------------------------------------------------------------------------

function exportFilterWorkings(workings) {
  return workings.filter(function(w) {
    var tag = w.tag || 'information';
    if (tag === 'information' && !S.getShowTagInformation()) return false;
    if (tag === 'direction'   && !S.getShowTagDirection())   return false;
    if (tag === 'calculation' && !S.getShowTagCalculation()) return false;
    return true;
  });
}

function exportActiveFilters() {
  var tags = [];
  if (S.getShowTagInformation()) tags.push('Information');
  if (S.getShowTagCalculation()) tags.push('Calculations');
  if (S.getShowTagDirection())   tags.push('Directions');
  return {
    tags:         tags,
    descriptions: S.getShowDescriptions(),
    mathematics:  S.getShowMathematics(),
    units:        S.getUnitSystem() === 'imperial' ? 'Imperial' : 'Metric',
    summary:      'Tags: ' + (tags.join(', ') || 'None') +
                  '  |  Descriptions: ' + (S.getShowDescriptions() ? 'On' : 'Off') +
                  '  |  Mathematics: ' + (S.getShowMathematics() ? 'On' : 'Off'),
  };
}

function printToPDF() {
  var chain = computeChain();
  if (chain.length === 0) { alert('Build a process chain first.'); return; }

  var first    = chain[0];
  var last     = chain[chain.length - 1];
  var massIn   = first.massOut;
  var massOut  = last.massOut;
  var totalLoss = round3(massIn - massOut);
  var yieldPct  = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var unitLabel = S.getUnitSystem() === 'imperial' ? 'Imperial (in / lb / °F)' : 'Metric (mm / kg / °C)';
  var ts        = new Date().toLocaleString();
  var filters   = exportActiveFilters();

  var C_sans  = "'Segoe UI','Helvetica Neue',Arial,sans-serif";
  var C_mono  = "'Consolas','SF Mono','Courier New',monospace";
  var C_ink   = '#1a1f2a';
  var C_sub   = '#5a6878';
  var C_faint = '#9aaabb';
  var C_border= '#dde3ea';
  var C_accent= '#b04010';
  var C_aLt   = '#fff3ee';
  var C_aBd   = '#e8c0a8';
  var C_blue  = '#1a3a5c';
  var C_bLt   = '#eef3f8';
  var C_bBd   = '#b8ccde';
  var C_green = '#1a6040';
  var C_gLt   = '#eefaf4';
  var C_gBd   = '#a8d8c0';
  var C_gold  = '#7a5000';
  var C_yLt   = '#fdf8ee';
  var C_yBd   = '#e0c878';

  var NODE_COLORS = {
    stock_in:   { bg:'#3a1208', text:'#ffb090', border:'#e05c3a' },
    cut:        { bg:'#101820', text:'#99bbcc', border:'#405060' },
    heat:       { bg:'#201000', text:'#ffe090', border:'#b07010' },
    forge:      { bg:'#200800', text:'#ffaa70', border:'#a03008' },
    trim:       { bg:'#101828', text:'#90b0e0', border:'#304880' },
    heat_treat: { bg:'#140828', text:'#c0a0f0', border:'#5838a8' },
    machine:    { bg:'#081a14', text:'#70e0c0', border:'#187050' },
    inspect:    { bg:'#081a0a', text:'#80e090', border:'#188030' },
    stock_out:  { bg:'#001828', text:'#80d0f0', border:'#0070a0' },
  };

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function mRow(label, val) {
    return '<tr><td style="padding:4px 12px 4px 0;font-size:10px;color:'+C_sub+';white-space:nowrap;vertical-align:top">'+esc(label)+'</td>'+
           '<td style="padding:4px 0;font-size:10px;font-weight:600;color:'+C_ink+'">'+esc(val)+'</td></tr>';
  }

  // ── COVER PAGE ───────────────────────────────────────────────────────────
  var coverHTML =
    '<div style="page-break-after:always;min-height:99vh;display:flex;flex-direction:column;justify-content:space-between;padding:64px 64px 40px">'+
    '<div>'+
      '<div style="font-size:38px;font-weight:200;letter-spacing:14px;text-transform:uppercase;color:'+C_ink+';margin-bottom:6px">Forgeworks</div>'+
      '<div style="font-size:10px;letter-spacing:6px;text-transform:uppercase;color:'+C_faint+';margin-bottom:40px">Manufacturing Review Package</div>'+
      '<div style="height:3px;background:linear-gradient(to right,'+C_accent+',transparent);margin-bottom:44px"></div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:40px">'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px;border-bottom:1px solid '+C_border+';padding-bottom:6px">Delivery Order</div>'+
          '<table style="border-collapse:collapse;width:100%">'+
            mRow('DO Number',  S.getGeneral().doNumber   || '—')+
            mRow('Part Number', S.getGeneral().partNumber || '—')+
            mRow('Part Name',   S.getGeneral().partName   || '—')+
            mRow('Revision',    S.getGeneral().revision   || '—')+
            mRow('Customer',    S.getGeneral().customer   || '—')+
          '</table>'+
        '</div>'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px;border-bottom:1px solid '+C_border+';padding-bottom:6px">Document Information</div>'+
          '<table style="border-collapse:collapse;width:100%">'+
            mRow('Engineer',      S.getGeneral().engineer     || '—')+
            mRow('Date Created',  S.getGeneral().dateCreated  || '—')+
            mRow('Status',       (S.getGeneral().status||'—').replace(/_/g,' '))+
            mRow('Unit System',   unitLabel)+
            mRow('Process Steps', chain.length + ' steps')+
            mRow('Generated',     ts)+
            mRow('View Filters',  filters.summary)+
          '</table>'+
        '</div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:36px">'+
        '<div style="padding:18px;border:2px solid '+C_bBd+';border-radius:4px;background:'+C_bLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_blue+';margin-bottom:8px">Raw Stock In</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_blue+';font-family:'+C_mono+'">'+esc(dMass(massIn))+'</div>'+
        '</div>'+
        '<div style="padding:18px;border:2px solid '+C_gBd+';border-radius:4px;background:'+C_gLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_green+';margin-bottom:8px">Final Part Out</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_green+';font-family:'+C_mono+'">'+esc(dMass(massOut))+'</div>'+
        '</div>'+
        '<div style="padding:18px;border:2px solid '+C_aBd+';border-radius:4px;background:'+C_aLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_accent+';margin-bottom:8px">Total Loss</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_accent+';font-family:'+C_mono+'">'+esc(dMass(totalLoss))+'</div>'+
        '</div>'+
        '<div style="padding:18px;border:2px solid '+C_yBd+';border-radius:4px;background:'+C_yLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_gold+';margin-bottom:8px">Material Yield</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_gold+';font-family:'+C_mono+'">'+yieldPct+'%</div>'+
        '</div>'+
      '</div>'+

      '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px">Process Sequence</div>'+
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:32px">'+
      chain.map(function(step,i){
        var nc=NODE_COLORS[step.nodeType]||{bg:'#333',text:'#fff',border:'#555'};
        return '<span style="padding:6px 14px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:'+nc.bg+';color:'+nc.text+';border:1px solid '+nc.border+'">'+esc(step.label)+'</span>'+
          (i<chain.length-1?'<span style="color:'+C_faint+';font-size:16px">→</span>':'');
      }).join('')+
      '</div>'+

      (S.getGeneral().notes?'<div style="padding:16px;border:1px solid '+C_border+';border-radius:4px;background:#fafafa">'+
        '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Notes</div>'+
        '<div style="font-size:11px;color:'+C_ink+';line-height:1.6">'+esc(S.getGeneral().notes)+'</div></div>':'')+
    '</div>'+
    '<div style="border-top:1px solid '+C_border+';padding-top:12px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
      '<span>Forgeworks · Manufacturing Review</span><span>CONFIDENTIAL — FOR INTERNAL USE</span><span>Page 1</span>'+
    '</div></div>';

  // ── ONE PAGE PER STEP ────────────────────────────────────────────────────
  var stepsHTML = chain.map(function(step, idx) {
    var node = S.getNodes().find(function(n){ return n.id===step.nodeId; })||{};
    var def  = NODE_DEFS[step.nodeType]||{paramDefs:[]};
    var p    = node.params||{};
    var nc   = NODE_COLORS[step.nodeType]||{bg:'#222',text:'#fff',border:'#444'};
    var workings = exportFilterWorkings(buildStepWorkings(step));

    // Build param sections
    var paramSections = [];
    var curSec = {title:'Parameters',rows:[]};
    def.paramDefs.forEach(function(pd){
      if (pd.section!==undefined){
        if (curSec.rows.length) paramSections.push(curSec);
        curSec={title:pd.section,rows:[]};
      } else {
        var raw=p[pd.key];
        if (raw===undefined||raw==='') return;
        var displayVal;
        if (pd.unitType) {
          displayVal = toDisplay(raw,pd.unitType)+unitSuffix(pd.unitType);
        } else if (pd.type === 'material_family') {
          displayVal = (MATERIAL_CATALOG[raw]||{}).label || raw;
        } else if (pd.type === 'grade_lookup') {
          displayVal = raw;
        } else if (pd.type === 'select') {
          displayVal = String(raw).replace(/_/g,' ');
        } else {
          displayVal = raw;
        }
        curSec.rows.push({label:pd.label, value:displayVal});
      }
    });
    if (curSec.rows.length) paramSections.push(curSec);

    var paramsHTML = paramSections.filter(function(s){return s.rows.length>0;}).map(function(sec){
      return '<div style="margin-bottom:14px">'+
        '<div style="font-size:7px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:1px solid '+C_border+';padding-bottom:4px;margin-bottom:6px">'+esc(sec.title)+'</div>'+
        '<table style="width:100%;border-collapse:collapse">'+
        sec.rows.map(function(r,ri){
          var bg=ri%2===0?'#f9fafb':'#fff';
          return '<tr style="background:'+bg+'">'+
            '<td style="padding:4px 8px 4px 0;font-size:9px;color:'+C_sub+';width:48%;border-bottom:1px solid #f0f2f4;vertical-align:top">'+esc(r.label)+'</td>'+
            '<td style="padding:4px 0;font-size:10px;font-weight:600;color:'+C_ink+';font-family:'+C_mono+';border-bottom:1px solid #f0f2f4">'+esc(String(r.value))+'</td>'+
          '</tr>';
        }).join('')+
        '</table></div>';
    }).join('');

    var calcsHTML = workings.length === 0
      ? '<div style="color:'+C_faint+';font-size:10px;padding:8px 0">No workings visible — check tag filters.</div>'
      : workings.map(function(w,wi){
      var isInfo = w.symbolic==='—';
      var showDesc = S.getShowDescriptions();
      var showMath = S.getShowMathematics();
      return '<div style="border:1px solid '+C_border+';border-radius:4px;margin-bottom:10px;overflow:hidden;page-break-inside:avoid">'+

        // Header row with title + tag + number
        '<div style="background:#f0f4f8;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid '+C_border+'">'+
          '<div style="font-size:10px;font-weight:700;color:'+C_ink+'">'+esc(w.title)+'</div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            (function(){
              var tagCfg={information:{bg:C_bLt,color:C_blue},direction:{bg:C_yLt,color:C_gold},calculation:{bg:C_gLt,color:C_green}}[w.tag||'information']||{bg:C_bLt,color:C_blue};
              return '<span style="font-size:7px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:1px 6px;border-radius:2px;background:'+tagCfg.bg+';color:'+tagCfg.color+'">'+(w.tag||'information')+'</span>';
            })()+
            '<div style="font-size:8px;color:'+C_faint+';font-family:'+C_mono+'">'+esc((idx+1)+'.'+(wi+1))+'</div>'+
          '</div>'+
        '</div>'+

        // Description — only if descriptions toggle is on
        (showDesc ?
          '<div style="padding:8px 12px;background:'+C_bLt+';border-bottom:1px solid '+C_bBd+';font-size:10px;color:'+C_blue+';line-height:1.5;border-left:3px solid '+C_bBd+'">'+
            esc(w.desc)+
          '</div>'
        : '') +

        // Formula + answer — only if mathematics toggle is on
        (!isInfo && showMath ?
          '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid '+C_border+'">'+
            '<div style="padding:10px 12px;border-right:1px solid '+C_border+'">'+
              '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Symbolic Formula</div>'+
              '<div style="font-size:11px;font-family:'+C_mono+';color:'+C_blue+';line-height:1.6">'+esc(w.symbolic)+'</div>'+
            '</div>'+
            '<div style="padding:10px 12px">'+
              '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Values Substituted</div>'+
              '<div style="font-size:11px;font-family:'+C_mono+';color:'+C_sub+';line-height:1.6">'+esc(w.substituted)+'</div>'+
            '</div>'+
          '</div>'+
          '<div style="padding:10px 14px;background:'+C_aLt+';display:flex;align-items:center;gap:14px">'+
            '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_accent+';white-space:nowrap">Answer</div>'+
            '<div style="font-size:15px;font-weight:700;font-family:'+C_mono+';color:'+C_accent+'">'+esc(w.answer)+'</div>'+
          '</div>'
        : (!isInfo ?
          // Mathematics off — show answer only
          '<div style="padding:10px 14px;background:'+C_aLt+';display:flex;align-items:center;gap:14px">'+
            '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_accent+';white-space:nowrap">Result</div>'+
            '<div style="font-size:15px;font-weight:700;font-family:'+C_mono+';color:'+C_accent+'">'+esc(w.answer)+'</div>'+
          '</div>'
        : '')) +

      '</div>';
    }).join('');

    // Mass flow banner
    var lc = step.massLoss>0?C_accent:C_faint;
    var massBar =
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:12px 14px;background:'+C_bLt+';border:1px solid '+C_bBd+';border-radius:4px;margin-bottom:16px">'+
        '<div><div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_blue+';margin-bottom:4px">Mass In</div>'+
          '<div style="font-size:16px;font-weight:700;font-family:'+C_mono+';color:'+C_blue+'">'+esc(dMass(step.massIn))+'</div></div>'+
        '<div><div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+lc+';margin-bottom:4px">Material Lost</div>'+
          '<div style="font-size:16px;font-weight:700;font-family:'+C_mono+';color:'+lc+'">'+
          (step.massLoss>0 ? '−'+esc(dMass(step.massLoss))+' <span style="font-size:10px;font-weight:400">('+step.lossPct+'%)</span>' : '—')+
          '</div></div>'+
        '<div><div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_green+';margin-bottom:4px">Mass Out</div>'+
          '<div style="font-size:16px;font-weight:700;font-family:'+C_mono+';color:'+C_green+'">'+esc(dMass(step.massOut))+'</div></div>'+
      '</div>';

    return '<div style="page-break-before:always;padding:40px 48px 48px">'+

      // Step header
      '<div style="background:'+nc.bg+';border:2px solid '+nc.border+';border-radius:4px;padding:18px 22px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:center">'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+nc.text+'99;margin-bottom:5px">Step '+(idx+1)+' of '+chain.length+'</div>'+
          '<div style="font-size:22px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:'+nc.text+'">'+esc(step.label)+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+nc.text+'80;margin-bottom:5px">Type</div>'+
          '<div style="font-size:11px;font-weight:600;color:'+nc.text+'">'+esc((step.nodeType||'').replace(/_/g,' ').toUpperCase())+'</div>'+
        '</div>'+
      '</div>'+

      // Two-column: params | calcs
      '<div style="display:grid;grid-template-columns:260px 1fr;gap:22px">'+

        // LEFT — parameters
        '<div>'+
          '<div style="font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:2px solid '+C_border+';padding-bottom:6px;margin-bottom:14px">All Parameters</div>'+
          (paramsHTML||'<div style="color:'+C_faint+';font-size:10px;padding:8px 0">No parameters set</div>')+
        '</div>'+

        // RIGHT — mass flow + workings
        '<div>'+
          '<div style="font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:2px solid '+C_border+';padding-bottom:6px;margin-bottom:14px">Mass Flow</div>'+
          massBar+
          '<div style="font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:2px solid '+C_border+';padding-bottom:6px;margin:16px 0 14px">Calculation Workings — Step by Step</div>'+
          calcsHTML+
        '</div>'+

      '</div>'+

      // Footer
      '<div style="margin-top:24px;border-top:1px solid '+C_border+';padding-top:10px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
        '<span>Forgeworks · '+esc(step.label)+'</span>'+
        '<span>DO: '+esc(S.getGeneral().doNumber||'—')+'</span>'+
        '<span>Step '+(idx+1)+' of '+chain.length+'</span>'+
      '</div>'+
    '</div>';
  }).join('');

  // ── FINAL SUMMARY TABLE PAGE ─────────────────────────────────────────────
  var summaryPage = '<div style="page-break-before:always;padding:40px 48px">'+
    '<div style="font-size:22px;font-weight:200;letter-spacing:8px;text-transform:uppercase;color:'+C_ink+';margin-bottom:4px">Mass Balance</div>'+
    '<div style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Complete chain summary</div>'+
    '<div style="height:2px;background:linear-gradient(to right,'+C_accent+',transparent);margin-bottom:24px"></div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:10px">'+
    '<thead><tr style="background:'+C_ink+'">'+
      '<th style="text-align:left;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">#</th>'+
      '<th style="text-align:left;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">STEP</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">MASS IN</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">LOSS</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">LOSS %</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">MASS OUT</th>'+
      '<th style="text-align:left;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">KEY NOTES</th>'+
    '</tr></thead><tbody>'+
    chain.map(function(step,i){
      var bg  = i%2===0?'#f8f9fb':'#fff';
      var nc  = NODE_COLORS[step.nodeType]||{bg:'#333',text:'#fff',border:'#444'};
      var key = step.calcs.slice(0,3).map(function(c){return c.label+': '+c.result;}).join('  ·  ');
      return '<tr style="background:'+bg+';border-bottom:1px solid '+C_border+'">'+
        '<td style="padding:9px 12px;font-weight:700;color:'+C_faint+';font-size:11px">'+(i+1)+'</td>'+
        '<td style="padding:9px 12px"><span style="padding:3px 10px;border-radius:2px;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:'+nc.bg+';color:'+nc.text+';border:1px solid '+nc.border+'">'+esc(step.label)+'</span></td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';color:'+C_blue+'">'+esc(dMass(step.massIn))+'</td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';color:'+(step.massLoss>0?C_accent:C_faint)+'">'+
          (step.massLoss>0?'−'+esc(dMass(step.massLoss)):'—')+'</td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';color:'+(step.lossPct>0?C_accent:C_faint)+'">'+
          (step.lossPct>0?step.lossPct+'%':'—')+'</td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';font-weight:700;color:'+C_green+'">'+esc(dMass(step.massOut))+'</td>'+
        '<td style="padding:9px 12px;color:'+C_sub+';font-size:9px">'+esc(key)+'</td>'+
      '</tr>';
    }).join('')+
    '</tbody><tfoot><tr style="background:'+C_ink+'">'+
      '<td colspan="2" style="padding:11px 12px;color:#fff;font-weight:700;font-size:9px;letter-spacing:1px">TOTALS</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#80d0ff;font-weight:700;font-family:'+C_mono+'">'+esc(dMass(massIn))+'</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#ff9070;font-weight:700;font-family:'+C_mono+'">−'+esc(dMass(totalLoss))+'</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#ff9070;font-weight:700;font-family:'+C_mono+'">'+round3(100-yieldPct)+'%</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#80f0b0;font-weight:700;font-family:'+C_mono+'">'+esc(dMass(massOut))+'</td>'+
      '<td style="padding:11px 12px;color:#80f0b0;font-weight:700;font-size:12px">Yield: '+yieldPct+'%</td>'+
    '</tr></tfoot></table>'+

    '<div style="margin-top:40px;border-top:1px solid '+C_border+';padding-top:14px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
      '<span>Forgeworks · Manufacturing Review</span><span>Generated: '+esc(ts)+'</span><span>END OF REPORT</span>'+
    '</div></div>';

  var css = [
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{font-family:'+C_sans+';background:#f7f8fa;color:'+C_ink+';font-size:11px}',
    '@media print{',
    '  @page{margin:0;size:letter}',
    '  body{background:#fff}',
    '  .nobreak{page-break-inside:avoid}',
    '}',
  ].join('');

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>Forgeworks MFG Review \u2014 '+(S.getGeneral().doNumber||'Export')+'</title>'+
    '<style>'+css+'</style></head><body>'+
    coverHTML + stepsHTML + summaryPage +
    '</body></html>';

  var win = window.open('','_blank','width=1060,height=860');
  win.document.write(html); win.document.close(); win.focus();
  setTimeout(function(){ win.print(); }, 600);
}

// ---------------------------------------------------------------------------
// Export — shared helpers
// ---------------------------------------------------------------------------

function exportGetChain() {
  var chain = computeChain();
  if (chain.length === 0) { alert('Build a process chain first.'); return null; }
  return chain;
}

function exportDownload(filename, content, mime) {
  var blob = new Blob([content], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
}

// ---------------------------------------------------------------------------
// Export — Excel (.xlsx via SpreadsheetML XML)
// ---------------------------------------------------------------------------

function exportToExcel() {
  var chain = exportGetChain(); if (!chain) return;
  var first = chain[0], last = chain[chain.length - 1];
  var massIn  = first.massOut;
  var massOut = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var filters = exportActiveFilters();

  var rows = [];
  rows.push(['FORGEWORKS — MANUFACTURING REVIEW', '', '', '', '']);
  rows.push(['', '', '', '', '']);
  rows.push(['DO Number', S.getGeneral().doNumber || '—', 'Customer', S.getGeneral().customer || '—', '']);
  rows.push(['Engineer',   S.getGeneral().engineer  || '—', 'Date',     S.getGeneral().dateCreated || '—', '']);
  rows.push(['Status',     S.getGeneral().status    || '—', 'Units',    filters.units, '']);
  rows.push(['View Filters', filters.summary, '', '', '']);
  rows.push(['', '', '', '', '']);
  rows.push(['SUMMARY', '', '', '', '']);
  rows.push(['Mass In', dMass(massIn), 'Mass Out', dMass(massOut), '']);
  rows.push(['Yield', yieldPct + '%', 'Steps', chain.length, '']);
  rows.push(['', '', '', '', '']);
  rows.push(['STEP', 'TAG', 'WORKING', 'RESULT', 'LOSS']);

  chain.forEach(function(step) {
    var workings = exportFilterWorkings(buildStepWorkings(step));
    if (workings.length === 0) return;
    var firstRow = true;
    workings.forEach(function(w) {
      rows.push([
        firstRow ? step.label : '',
        firstRow ? (w.tag || 'information') : '',
        w.title,
        w.answer,
        firstRow && step.massLoss > 0 ? '−' + dMass(step.massLoss) + ' (' + step.lossPct + '%)' : '',
      ]);
      firstRow = false;
    });
    rows.push(['', '', '', '', '']);
  });

  // SpreadsheetML XML
  var xml = '<?xml version="1.0"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    '<Styles>' +
      '<Style ss:ID="h"><Font ss:Bold="1" ss:Size="11"/></Style>' +
      '<Style ss:ID="b"><Font ss:Bold="1"/></Style>' +
      '<Style ss:ID="s"><Interior ss:Color="#1a2a3a" ss:Pattern="Solid"/><Font ss:Color="#ffffff" ss:Bold="1"/></Style>' +
    '</Styles>\n' +
    '<Worksheet ss:Name="Mfg Review"><Table>\n';

  rows.forEach(function(row, ri) {
    var styleId = ri === 0 ? 'h' : (row[0] === 'SUMMARY' || row[0] === 'STEP' ? 'b' : '');
    xml += '<Row>';
    row.forEach(function(cell) {
      var val = String(cell || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      xml += '<Cell' + (styleId ? ' ss:StyleID="' + styleId + '"' : '') + '>' +
             '<Data ss:Type="String">' + val + '</Data></Cell>';
    });
    xml += '</Row>\n';
  });

  xml += '</Table></Worksheet></Workbook>';
  var fn = 'mfg-review-' + (S.getGeneral().doNumber || 'export').replace(/\s+/g,'-') + '.xls';
  exportDownload(fn, xml, 'application/vnd.ms-excel');
}

// ---------------------------------------------------------------------------
// Export — CSV
// ---------------------------------------------------------------------------

function exportToCSV() {
  var chain = exportGetChain(); if (!chain) return;
  var first = chain[0], last = chain[chain.length - 1];
  var massIn  = first.massOut;
  var massOut = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var filters = exportActiveFilters();

  function csvRow(cells) {
    return cells.map(function(c) {
      var s = String(c || '');
      if (s.indexOf(',') > -1 || s.indexOf('"') > -1 || s.indexOf('\n') > -1)
        s = '"' + s.replace(/"/g,'""') + '"';
      return s;
    }).join(',');
  }

  var lines = [];
  lines.push(csvRow(['Forgeworks Manufacturing Review']));
  lines.push(csvRow(['DO Number', S.getGeneral().doNumber||'', 'Customer', S.getGeneral().customer||'']));
  lines.push(csvRow(['Engineer', S.getGeneral().engineer||'', 'Date', S.getGeneral().dateCreated||'']));
  lines.push(csvRow(['Units', filters.units]));
  lines.push(csvRow(['View Filters', filters.summary]));
  lines.push('');
  lines.push(csvRow(['SUMMARY', '', '', '']));
  lines.push(csvRow(['Mass In', dMass(massIn), 'Mass Out', dMass(massOut)]));
  lines.push(csvRow(['Yield', yieldPct + '%', 'Steps', chain.length]));
  lines.push('');
  lines.push(csvRow(['Step', 'Tag', 'Working', 'Result', 'Loss']));

  chain.forEach(function(step) {
    var workings = exportFilterWorkings(buildStepWorkings(step));
    if (workings.length === 0) return;
    var firstRow = true;
    workings.forEach(function(w) {
      lines.push(csvRow([
        firstRow ? step.label : '',
        firstRow ? (w.tag || 'information') : '',
        w.title,
        w.answer,
        firstRow && step.massLoss > 0 ? '-' + dMass(step.massLoss) + ' (' + step.lossPct + '%)' : '',
      ]));
      firstRow = false;
    });
    lines.push('');
  });

  var fn = 'mfg-review-' + (S.getGeneral().doNumber || 'export').replace(/\s+/g,'-') + '.csv';
  exportDownload(fn, lines.join('\r\n'), 'text/csv');
}

// ---------------------------------------------------------------------------
// Export — plain text
// ---------------------------------------------------------------------------

function exportToTxt() {
  var chain = exportGetChain(); if (!chain) return;
  var first = chain[0], last = chain[chain.length - 1];
  var massIn  = first.massOut;
  var massOut = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var filters = exportActiveFilters();
  var HR = '─'.repeat(56);
  var lines = [];

  lines.push('FORGEWORKS  ·  MANUFACTURING REVIEW');
  lines.push(HR);
  lines.push('DO        ' + (S.getGeneral().doNumber    || '—'));
  lines.push('Customer  ' + (S.getGeneral().customer   || '—'));
  lines.push('Engineer  ' + (S.getGeneral().engineer   || '—'));
  lines.push('Date      ' + (S.getGeneral().dateCreated|| '—'));
  lines.push('Status    ' + (S.getGeneral().status     || '—'));
  lines.push('Units     ' + filters.units);
  lines.push('Filters   ' + filters.summary);
  lines.push(HR);
  lines.push('SUMMARY');
  lines.push('  Mass In   ' + dMass(massIn));
  lines.push('  Mass Out  ' + dMass(massOut));
  lines.push('  Yield     ' + yieldPct + '%');
  lines.push('  Steps     ' + chain.length);
  lines.push(HR);

  chain.forEach(function(step, i) {
    var workings = exportFilterWorkings(buildStepWorkings(step));
    if (workings.length === 0) return;
    lines.push((i + 1) + '.  ' + step.label.toUpperCase());
    if (step.massLoss > 0) {
      lines.push('    Loss  −' + dMass(step.massLoss) + '  (' + step.lossPct + '%)');
    }
    workings.forEach(function(w) {
      var pad = '    [' + (w.tag||'info').slice(0,4).toUpperCase() + ']  ' + w.title;
      while (pad.length < 36) pad += ' ';
      lines.push(pad + w.answer);
      if (S.getShowMathematics() && w.symbolic !== '—') {
        lines.push('           = ' + w.symbolic);
        lines.push('           = ' + w.substituted);
      }
    });
    lines.push('');
  });

  lines.push(HR);
  lines.push('Generated  ' + new Date().toLocaleString());
  lines.push('Forgeworks MFG-REVIEW v2.0');

  var fn = 'mfg-review-' + (S.getGeneral().doNumber || 'export').replace(/\s+/g,'-') + '.txt';
  exportDownload(fn, lines.join('\n'), 'text/plain');
}


// ===========================================================================
// REUSABLE INPUT COMPONENTS
// ===========================================================================

// ===========================================================================
// STYLES
// ===========================================================================

function injectStyles() {
  if (document.getElementById('mr-styles')) return;
  var style = document.createElement('style');
  style.id = 'mr-styles';
  style.textContent =
    '#forgeworks-mfg-review ::-webkit-scrollbar{width:5px}' +
    '#forgeworks-mfg-review ::-webkit-scrollbar-track{background:rgba(0,0,0,0.2)}' +
    '#forgeworks-mfg-review ::-webkit-scrollbar-thumb{background:' + ACCENT_DIM + '0.2);border-radius:3px}' +
    '#forgeworks-mfg-review ::-webkit-scrollbar-thumb:hover{background:' + ACCENT_DIM + '0.4)}' +
    '#forgeworks-mfg-review input[type=number]::-webkit-inner-spin-button{opacity:0.3}' +
    '#forgeworks-mfg-review select option{background:#0d1520;color:#aabbcc}' +
    '.mr-node:active{cursor:grabbing!important}' +
    '#mr-ctx-menu{user-select:none}';
  document.head.appendChild(style);
}


// ===========================================================================
// EXAMPLE ORDER
// ===========================================================================

// Builds the permanent coded-in example delivery order as a plain data object.
// Does NOT touch the DOM — nodes are rendered only when the user opens it.
// The example always sits at the top of the Orders list with an EXAMPLE badge.

function buildExampleOrder() {
  var sp  = NODE_W + 80;
  var sx  = 60, sy = 160;
  var nid = 0;
  var cid = 0;

  function exNode(type, x, y) {
    var def = NODE_DEFS[type];
    return {
      id:     'ex_' + (nid++),
      type:   type,
      label:  def.label,
      x:      x,
      y:      y,
      params: JSON.parse(JSON.stringify(def.defaultParams || {})),
    };
  }

  var n0 = exNode('stock_in',   sx,          sy);
  var n1 = exNode('cut',        sx + sp,     sy);
  var n2 = exNode('heat',       sx + sp * 2, sy);
  var n3 = exNode('forge',      sx + sp * 3, sy);
  var n4 = exNode('heat_treat', sx + sp * 4, sy);
  var n5 = exNode('inspect',    sx + sp * 5, sy);
  var n6 = exNode('stock_out',  sx + sp * 6, sy);

  var nodes = [n0, n1, n2, n3, n4, n5, n6];
  var connections = [
    { id: 'ec_' + (cid++), fromId: n0.id, toId: n1.id, cycle: 1 },
    { id: 'ec_' + (cid++), fromId: n1.id, toId: n2.id, cycle: 1 },
    { id: 'ec_' + (cid++), fromId: n2.id, toId: n3.id, cycle: 1 },
    { id: 'ec_' + (cid++), fromId: n3.id, toId: n4.id, cycle: 1 },
    { id: 'ec_' + (cid++), fromId: n4.id, toId: n5.id, cycle: 1 },
    { id: 'ec_' + (cid++), fromId: n5.id, toId: n6.id, cycle: 1 },
  ];

  return {
    id:             'example-order',
    isExample:      true,
    filename:       null,
    fileHandle:     null,
    doNumber:       'EXAMPLE',
    partNumber:     'EX-001',
    partName:       'Example Forge Part',
    customer:       'Forgeworks',
    status:         'draft',
    dateCreated:    '',
    version:        SAVE_VERSION,
    loaded:         true,
    isDirty:        false,
    isParent:       false,
    isChild:        false,
    parentDoNumber: null,
    childCount:     0,
    isExpanded:     false,
    general: {
      doNumber:       'EXAMPLE',
      partNumber:     'EX-001',
      partName:       'Example Forge Part',
      revision:       'A',
      customer:       'Forgeworks',
      engineer:       '',
      dateCreated:    '',
      status:         'draft',
      notes:          'Built-in example delivery order. Shows a complete forge process chain: Stock In → Cut → Heat → Forge → Heat Treat → Inspect → Stock Out.',
      material:       '4140',
      condition:      'annealed',
      density:        7.85,
      isParent:       false,
      isChild:        false,
      parentDoNumber: null,
      childCount:     0,
      totalQuantity:  0,
      batchQuantity:  0,
      batchNotes:     '',
    },
    nodes:       nodes,
    connections: connections,
    nid:         nid,
    cid:         cid,
  };
}


// ===========================================================================
// PUBLIC API
// ===========================================================================

export function show() {
  buildOverlay();
  S.getOverlay().style.display = 'flex';
  S.setVisible(true);
  setDisplaySystem(S.getUnitSystem());   // sync unit lib to current default
  refreshLeftPanel();
  refreshStatusBadge();
  S.resetViewport();
  applyWorldTransform();
}

export function hide() {
  if (S.getOverlay()) S.getOverlay().style.display = 'none';
  S.setVisible(false);
  dismissContextMenu();
}

export function isVisible() { return S.isVisible(); }

export function onBack(callback) { S.setBackCallback(callback); }