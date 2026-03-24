// ============================================================================
// manufacturingreview_inputs.js — Left Panel (Orders / General / Node / Path tabs)
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Owns the left panel with four tab modes:
//   orders       — delivery order list, folder management, open/save/new/delete
//   general      — delivery order metadata fields
//   node_detail  — per-node parameter inputs for the selected node
//   path         — connection cycle count for the selected connection
//
// Cross-panel refresh calls are injected once via init() to avoid circular
// imports.  refreshLeftPanel() is defined here and calls itself directly.
// _openOrder and _saveActiveOrder are also injected from manufacturingreview.js
// because they require renderNodeEl and showToast which live there.
//
// Imports:  manufacturingreview_states.js (S)
//           manufacturingreview_defs.js (NODE_DEFS, MATERIAL_CATALOG, helpers)
//           manufacturingreview_process.js (refreshConnections, removeNodeEl, ...)
//           manufacturingreview_deliveryorder.js (FS)
// Exports:  init(), buildLeftPanel(), refreshLeftPanel(), refreshOrdersPanel()
// ============================================================================

import * as S from './manufacturingreview_states.js';
import {
  NODE_DEFS, MATERIAL_CATALOG,
  ACCENT, ACCENT_DIM,
  round3,
  toDisplay, fromDisplay, unitSuffix, scaleParam,
  buildInputSection, buildTextInput, buildNumberInputEl,
  buildSelectEl, buildTextareaInput,
  fWrap, fLabel, sInput,
} from './manufacturingreview_defs.js';
import { refreshConnections, deleteNode, deleteConn, removeNodeEl, refreshCanvasOverlay } from './manufacturingreview_process.js';
import * as FS from './manufacturingreview_deliveryorder.js';

// ---------------------------------------------------------------------------
// Injected cross-panel refresh callbacks (set once via init())
// ---------------------------------------------------------------------------

var _refreshRightPanel  = function() {};
var _refreshCalcPanel   = function() {};
var _refreshNodeEl      = function() {};
var _refreshStatusBadge = function() {};

// Injected from manufacturingreview.js — these require renderNodeEl / showToast
// which live there and cannot be imported here without a circular dependency.
var _openOrder       = function() {};   // _openOrder(orderId)
var _saveActiveOrder = function() {};   // _saveActiveOrder()

export function init(callbacks) {
  if (callbacks.refreshRightPanel)  _refreshRightPanel  = callbacks.refreshRightPanel;
  if (callbacks.refreshCalcPanel)   _refreshCalcPanel   = callbacks.refreshCalcPanel;
  if (callbacks.refreshNodeEl)      _refreshNodeEl      = callbacks.refreshNodeEl;
  if (callbacks.refreshStatusBadge) _refreshStatusBadge = callbacks.refreshStatusBadge;
  if (callbacks.openOrder)          _openOrder          = callbacks.openOrder;
  if (callbacks.saveActiveOrder)    _saveActiveOrder    = callbacks.saveActiveOrder;
}

// Called externally (e.g. from manufacturingreview.js after async folder ops)
// to force a re-render of the Orders tab list without switching away from the
// current tab.
export function refreshOrdersPanel() {
  if (S.getLeftMode() === 'orders') refreshLeftPanel();
}

// ---------------------------------------------------------------------------
// Left Panel
// ---------------------------------------------------------------------------

export function buildLeftPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-left';
  Object.assign(panel.style, {
    width: '280px', minWidth: '240px', maxWidth: '320px', flexShrink: '0',
    display: 'flex', flexDirection: 'column',
    borderRight: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(4,8,14,0.5)',
  });

  var tabs = document.createElement('div');
  Object.assign(tabs.style, { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.20)', flexShrink: '0' });
  ['Orders', 'General', 'Node', 'Path'].forEach(function(label) {
    var key      = label.toLowerCase().replace(' ', '_');
    var modeVal  = key === 'node' ? 'node_detail' : key;
    var isLocked = modeVal !== 'orders';   // General / Node / Path require an open DO
    var tab = document.createElement('div');
    tab.id = 'mr-tab-' + key;
    Object.assign(tab.style, {
      flex: '1', padding: '10px 0', textAlign: 'center',
      fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase',
      transition: 'all 0.2s ease',
      color: modeVal === S.getLeftMode() ? ACCENT : '#7a9aaa',
      borderBottom: modeVal === S.getLeftMode() ? '2px solid ' + ACCENT : '2px solid transparent',
      cursor: 'pointer',
    });
    tab.textContent = label;
    tab.addEventListener('click', function() {
      // Locked tabs are only reachable when a delivery order is open
      if (isLocked && !S.getActiveOrderId()) return;
      S.setLeftMode(modeVal);
      refreshLeftPanel();
    });
    tabs.appendChild(tab);
  });
  panel.appendChild(tabs);

  // Status badge strip — always visible below tabs
  var statusStrip = document.createElement('div');
  Object.assign(statusStrip.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 14px', flexShrink: '0',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0,0,0,0.2)',
  });
  var jobLabel = document.createElement('div');
  Object.assign(jobLabel.style, { fontSize: '9px', color: '#7a9aaa', letterSpacing: '0.5px' });
  jobLabel.id = 'mr-strip-job';
  jobLabel.textContent = S.getGeneral().doNumber || '—';
  var statusBadge = document.createElement('div');
  statusBadge.id = 'mr-g-status-badge';
  Object.assign(statusBadge.style, {
    fontSize: '8px', fontWeight: '700', letterSpacing: '1.5px',
    textTransform: 'uppercase', padding: '2px 8px', borderRadius: '2px',
    border: '1px solid', transition: 'all 0.2s ease',
  });
  statusStrip.appendChild(jobLabel);
  statusStrip.appendChild(statusBadge);
  panel.appendChild(statusStrip);

  var content = document.createElement('div');
  content.id = 'mr-left-content';
  Object.assign(content.style, { flex: '1', overflowY: 'auto', padding: '16px' });
  panel.appendChild(content);
  return panel;
}

export function refreshLeftPanel() {
  var hasOrder = !!S.getActiveOrderId();

  var oTab = document.getElementById('mr-tab-orders');
  var gTab = document.getElementById('mr-tab-general');
  var nTab = document.getElementById('mr-tab-node');
  var pTab = document.getElementById('mr-tab-path');

  // Orders tab — always accessible
  if (oTab) {
    var oActive = S.getLeftMode() === 'orders';
    oTab.style.color        = oActive ? ACCENT : '#7a9aaa';
    oTab.style.borderBottom = oActive ? '2px solid ' + ACCENT : '2px solid transparent';
    oTab.style.cursor       = 'pointer';
    oTab.style.opacity      = '1';
  }

  // General / Node / Path — locked until a DO is open
  [
    { el: gTab, mode: 'general'     },
    { el: nTab, mode: 'node_detail' },
    { el: pTab, mode: 'path'        },
  ].forEach(function(t) {
    if (!t.el) return;
    var active = S.getLeftMode() === t.mode;
    if (hasOrder) {
      t.el.style.color        = active ? ACCENT : '#7a9aaa';
      t.el.style.borderBottom = active ? '2px solid ' + ACCENT : '2px solid transparent';
      t.el.style.cursor       = 'pointer';
      t.el.style.opacity      = '1';
    } else {
      t.el.style.color        = '#3a5060';
      t.el.style.borderBottom = '2px solid transparent';
      t.el.style.cursor       = 'default';
      t.el.style.opacity      = '0.5';
    }
  });

  // If a locked tab is active but the order was closed, snap back to Orders
  if (!hasOrder && S.getLeftMode() !== 'orders') {
    S.setLeftMode('orders');
  }

  var content = document.getElementById('mr-left-content');
  if (!content) return;
  content.innerHTML = '';

  if (S.getLeftMode() === 'orders') {
    content.appendChild(buildOrdersPanel());
  } else if (S.getLeftMode() === 'general') {
    if (!hasOrder) {
      content.appendChild(buildLockedPlaceholder('Open a delivery order\nto view its details.'));
    } else {
      content.appendChild(buildGeneralInputs());
    }
  } else if (S.getLeftMode() === 'node_detail') {
    var node = S.getNodes().find(function(n) { return n.id === S.getSelectedId(); });
    if (node) {
      content.appendChild(buildNodeDetail(node));
    } else {
      content.appendChild(buildLockedPlaceholder('Click a node to edit\nits parameters.'));
    }
  } else if (S.getLeftMode() === 'path') {
    var conn = S.getConnections().find(function(c) { return c.id === S.getSelectedConnId(); });
    if (conn) {
      content.appendChild(buildPathDetail(conn));
    } else {
      content.appendChild(buildLockedPlaceholder('Click a connection to edit\nits path settings.'));
    }
  }
}

// Shared placeholder for locked or empty tab states
function buildLockedPlaceholder(msg) {
  var ph = document.createElement('div');
  Object.assign(ph.style, {
    color: '#3a5060', fontSize: '10px', textAlign: 'center',
    marginTop: '40px', lineHeight: '2.0', whiteSpace: 'pre-line',
  });
  ph.textContent = msg;
  return ph;
}

function buildGeneralInputs() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '18px' });

  wrap.appendChild(buildInputSection('Document', [
    buildTextInput('DO Number',   'mr-g-do',   S.getGeneral().doNumber,   function(v) {
      S.getGeneral().doNumber = v;
      S.setIsDirty(true);
      var s = document.getElementById('mr-strip-job');
      if (s) s.textContent = v || '—';
    }),
    buildTextInput('Part Number', 'mr-g-pn',   S.getGeneral().partNumber, function(v) { S.getGeneral().partNumber = v; S.setIsDirty(true); }),
    buildTextInput('Part Name',   'mr-g-pname',S.getGeneral().partName,   function(v) { S.getGeneral().partName   = v; S.setIsDirty(true); }),
    buildTextInput('Revision',    'mr-g-rev',  S.getGeneral().revision,   function(v) { S.getGeneral().revision   = v; S.setIsDirty(true); }),
  ]));

  wrap.appendChild(buildInputSection('People', [
    buildTextInput('Customer',   'mr-g-customer', S.getGeneral().customer, function(v) { S.getGeneral().customer = v; }),
    buildTextInput('Engineer',   'mr-g-engineer', S.getGeneral().engineer, function(v) { S.getGeneral().engineer = v; }),
  ]));

  wrap.appendChild(buildInputSection('Status', [
    buildTextInput('Date',  'mr-g-date', S.getGeneral().dateCreated, function(v) { S.getGeneral().dateCreated = v; }),
    buildSelectEl('Status', 'mr-g-status', [
      { value: 'draft',     label: 'Draft'      },
      { value: 'review',    label: 'In Review'  },
      { value: 'approved',  label: 'Approved'   },
      { value: 'released',  label: 'Released'   },
      { value: 'obsolete',  label: 'Obsolete'   },
    ], S.getGeneral().status, function(v) { S.getGeneral().status = v; _refreshStatusBadge(); }),
  ]));

  wrap.appendChild(buildInputSection('Notes', [
    buildTextareaInput('Notes', 'mr-g-notes', S.getGeneral().notes, function(v) { S.getGeneral().notes = v; }),
  ]));

  return wrap;
}

function buildNodeDetail(node) {
  var def = NODE_DEFS[node.type];
  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '16px' });

  var badge = document.createElement('div');
  Object.assign(badge.style, {
    padding: '8px 12px', borderRadius: '3px',
    background: def.color, border: '2px solid ' + def.borderColor,
    fontSize: '10px', fontWeight: '700', letterSpacing: '2px',
    textTransform: 'uppercase', color: def.textColor, textAlign: 'center',
  });
  badge.textContent = def.label;
  wrap.appendChild(badge);

  wrap.appendChild(buildInputSection('Label', [
    buildTextInput('Label', 'mr-node-label', node.label || def.label, function(v) {
      node.label = v; _refreshNodeEl(node.id);
    }),
  ]));

  if (def.paramDefs.length > 0) {
    // Group paramDefs by section
    var sections = [];
    var currentSection = { title: 'Parameters', defs: [] };
    def.paramDefs.forEach(function(pd) {
      if (pd.section !== undefined) {
        if (currentSection.defs.length > 0) sections.push(currentSection);
        currentSection = { title: pd.section, defs: [], showWhen: pd.showWhen };
      } else {
        currentSection.defs.push(pd);
      }
    });
    if (currentSection.defs.length > 0) sections.push(currentSection);

    sections.forEach(function(sec) {
      // ── Section-level conditional visibility ─────────────────────────────
      if (sec.showWhen && !sec.showWhen(node.params)) return;

      var fields = sec.defs.map(function(pd) {
        // ── Field-level conditional visibility ───────────────────────────
        if (pd.showWhen && !pd.showWhen(node.params)) return null;

        // ── Cascading material family selector ────────────────────────────
        if (pd.type === 'material_family') {
          var familyOptions = Object.keys(MATERIAL_CATALOG).map(function(k) {
            return { value: k, label: MATERIAL_CATALOG[k].label };
          });
          return buildSelectEl(pd.label, 'mr-nd-' + pd.key,
            familyOptions,
            node.params.materialFamily || 'carbon_steel',
            function(v) {
              node.params.materialFamily = v;
              var cat = MATERIAL_CATALOG[v];
              if (cat) {
                node.params.grade   = cat.grades[0];
                node.params.density = cat.densityDefault;
              }
              _refreshRightPanel(); _refreshCalcPanel(); _refreshNodeEl(node.id);
              refreshLeftPanel();   // re-render to update grade dropdown
            }
          );
        }

        // ── Grade dropdown — options driven by current materialFamily ─────
        if (pd.type === 'grade_lookup') {
          var cat = MATERIAL_CATALOG[node.params.materialFamily] || { grades: [] };
          var gradeOptions = cat.grades.map(function(g) { return { value: g, label: g }; });
          return buildSelectEl(pd.label, 'mr-nd-' + pd.key,
            gradeOptions,
            node.params.grade || (cat.grades[0] || ''),
            function(v) {
              node.params.grade = v;
              _refreshRightPanel(); _refreshCalcPanel(); _refreshNodeEl(node.id);
            }
          );
        }

        if (pd.type === 'select') {
          // optionsFor allows dynamic option lists driven by other params
          var selOpts = pd.optionsFor ? pd.optionsFor(node.params) : pd.options;
          // If stored value is no longer valid, reset to first valid option
          var selVal = node.params[pd.key];
          if (selVal === undefined || selOpts.indexOf(selVal) === -1) {
            selVal = selOpts[0];
            node.params[pd.key] = selVal;
          }
          return buildSelectEl(pd.label, 'mr-nd-' + pd.key,
            selOpts.map(function(o) { return { value: o, label: o.replace(/_/g, ' ') }; }),
            selVal,
            function(v) {
              node.params[pd.key] = v;
              _refreshRightPanel(); _refreshCalcPanel(); _refreshNodeEl(node.id);
              // refreshPanel: true means this field controls visibility of other fields
              if (pd.refreshPanel) refreshLeftPanel();
            }
          );
        }
        if (pd.type === 'text') {
          return buildTextInput(pd.label, 'mr-nd-' + pd.key,
            node.params[pd.key] !== undefined ? node.params[pd.key] : '',
            function(v) { node.params[pd.key] = v; }
          );
        }
        // Number — convert to display units
        var sc        = scaleParam(pd);
        var dispVal   = toDisplay(node.params[pd.key] !== undefined ? node.params[pd.key] : 0, pd.unitType);
        var fullLabel = pd.label + unitSuffix(pd.unitType);
        return buildNumberInputEl(fullLabel, 'mr-nd-' + pd.key,
          dispVal, sc.min, sc.max, sc.step,
          function(v) {
            node.params[pd.key] = fromDisplay(v, pd.unitType);
            _refreshRightPanel(); _refreshCalcPanel(); _refreshNodeEl(node.id);
          }
        );
      });
      wrap.appendChild(buildInputSection(sec.title, fields));
    });
  }

  // Unit system note
  var unitNote = document.createElement('div');
  Object.assign(unitNote.style, {
    fontSize: '8px', color: '#506070', letterSpacing: '0.5px',
    textAlign: 'right', marginTop: '-8px',
  });
  unitNote.textContent = 'Values stored as SI · displaying ' + (S.getUnitSystem() === 'imperial' ? 'Imperial' : 'Metric');
  wrap.appendChild(unitNote);

  var delBtn = document.createElement('button');
  Object.assign(delBtn.style, {
    marginTop: '8px', padding: '8px', background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '3px',
    color: '#ef7777', fontSize: '10px', fontFamily: 'inherit',
    letterSpacing: '1px', cursor: 'pointer', transition: 'all 0.2s ease',
  });
  delBtn.textContent = 'Delete Node';
  delBtn.addEventListener('mouseenter', function() { delBtn.style.background = 'rgba(239,68,68,0.15)'; delBtn.style.borderColor = 'rgba(239,68,68,0.6)'; });
  delBtn.addEventListener('mouseleave', function() { delBtn.style.background = 'rgba(239,68,68,0.08)'; delBtn.style.borderColor = 'rgba(239,68,68,0.3)'; });
  delBtn.addEventListener('click', function() { deleteNode(node.id); });
  wrap.appendChild(delBtn);

  return wrap;
}

// ---------------------------------------------------------------------------
// Path Detail (left panel when a connection is selected)
// ---------------------------------------------------------------------------

function buildPathDetail(conn) {
  var fromNode = S.getNodes().find(function(n) { return n.id === conn.fromId; });
  var toNode   = S.getNodes().find(function(n) { return n.id === conn.toId;   });
  var fromDef  = fromNode ? NODE_DEFS[fromNode.type] : null;
  var toDef    = toNode   ? NODE_DEFS[toNode.type]   : null;

  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '20px' });

  // ── Connection badge ─────────────────────────────────────────────────────
  var badge = document.createElement('div');
  Object.assign(badge.style, {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 12px', borderRadius: '3px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.12)',
  });

  function nodePill(def, node) {
    var pill = document.createElement('div');
    Object.assign(pill.style, {
      flex: '1', padding: '5px 8px', borderRadius: '2px', textAlign: 'center',
      background: def ? def.color : 'rgba(255,255,255,0.05)',
      border: '1px solid ' + (def ? def.borderColor : 'rgba(255,255,255,0.2)'),
      fontSize: '8px', fontWeight: '700', letterSpacing: '1.5px',
      textTransform: 'uppercase', color: def ? def.textColor : '#aabbcc',
    });
    pill.textContent = (node && node.label) || (def && def.label) || '—';
    return pill;
  }
  var arr = document.createElement('div');
  Object.assign(arr.style, { color: '#4a6070', fontSize: '14px', flexShrink: '0' });
  arr.textContent = '→';

  badge.appendChild(nodePill(fromDef, fromNode));
  badge.appendChild(arr);
  badge.appendChild(nodePill(toDef, toNode));
  wrap.appendChild(badge);

  // ── Cycle count ──────────────────────────────────────────────────────────
  var cycleSection = buildInputSection('Cycle Count', []);
  wrap.appendChild(cycleSection);

  var cycleDesc = document.createElement('div');
  Object.assign(cycleDesc.style, {
    fontSize: '9px', color: '#7a9aaa', lineHeight: '1.6', marginBottom: '12px',
  });
  cycleDesc.textContent = 'Repeat the destination node N times before continuing. Mass from each pass feeds the next.';
  cycleSection.appendChild(cycleDesc);

  var btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '6px', marginBottom: '10px' });

  [1, 2, 3, 4, 5, 6].forEach(function(n) {
    var btn = document.createElement('button');
    var isActive = (conn.cycle || 1) === n;
    Object.assign(btn.style, {
      flex: '1', padding: '7px 0', borderRadius: '2px', cursor: 'pointer',
      fontSize: '10px', fontWeight: '700', letterSpacing: '1px',
      border: '1px solid ' + (isActive ? ACCENT : 'rgba(255,255,255,0.18)'),
      background: isActive ? ACCENT_DIM + '0.15)' : 'transparent',
      color: isActive ? ACCENT : '#7a9aaa',
      transition: 'all 0.15s ease',
    });
    btn.textContent = n + 'x';
    btn.addEventListener('click', function() {
      conn.cycle = n;
      refreshConnections();
      _refreshRightPanel(); _refreshCalcPanel();
      refreshLeftPanel();   // re-render buttons with new active state
    });
    btnRow.appendChild(btn);
  });
  cycleSection.appendChild(btnRow);

  // Preview of what the cycle means
  var preview = document.createElement('div');
  Object.assign(preview.style, {
    padding: '10px 12px', borderRadius: '3px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.10)',
    fontSize: '9px', color: '#7a9aaa', lineHeight: '1.8',
  });
  var toLabel = (toNode && (toNode.label || (toDef && toDef.label))) || 'node';
  var cyc = conn.cycle || 1;
  if (cyc === 1) {
    preview.textContent = 'No repetition — passes through ' + toLabel + ' once.';
  } else {
    var seq = [];
    for (var i = 0; i < cyc; i++) seq.push(toLabel + ' [pass ' + (i + 1) + ']');
    preview.textContent = seq.join('  →  ');
  }
  cycleSection.appendChild(preview);

  // ── Delete connection ────────────────────────────────────────────────────
  var delBtn = document.createElement('button');
  Object.assign(delBtn.style, {
    marginTop: 'auto', padding: '9px', borderRadius: '2px', cursor: 'pointer',
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
    color: '#ef9999', fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
    transition: 'all 0.2s ease',
  });
  delBtn.textContent = 'Delete Connection';
  delBtn.addEventListener('mouseenter', function() { delBtn.style.background = 'rgba(239,68,68,0.18)'; });
  delBtn.addEventListener('mouseleave', function() { delBtn.style.background = 'rgba(239,68,68,0.08)'; });
  delBtn.addEventListener('click', function() { deleteConn(conn.id); });
  wrap.appendChild(delBtn);

  return wrap;
}

// ===========================================================================
// ORDERS PANEL
// ===========================================================================

// ---------------------------------------------------------------------------
// Merge scan results from the FS module into the in-memory orders array.
// Preserves loaded/dirty state for orders already open; adds new; removes
// stale entries (unless active or dirty).
// ---------------------------------------------------------------------------

function mergeScanResults(scanResults) {
  // Step 1 — Remove all disk-based entries from the current list.
  // Keep only: the example order, unsaved in-memory orders (no fileHandle/filename),
  // and the currently active order even if its file was externally deleted.
  S.filterOrders(function(o) {
    if (o.isExample)                         return true;  // always keep the example
    if (!o.fileHandle && !o.filename)        return true;  // unsaved, in-memory only
    if (o.id === S.getActiveOrderId())       return true;  // currently open — never evict
    return false;                                           // remove all other disk entries
  });

  // Step 2 — Add fresh scan results.
  // If the active order happens to be one of the scanned files, update its
  // handle/metadata in-place rather than adding a duplicate.
  scanResults.forEach(function(result) {
    var existing = S.findOrder(function(o) { return o.filename === result.filename; });
    if (existing) {
      existing.fileHandle  = result.fileHandle;
      existing.doNumber    = result.doNumber;
      existing.partNumber  = result.partNumber;
      existing.partName    = result.partName;
      existing.customer    = result.customer;
      existing.status      = result.status;
      existing.dateCreated = result.dateCreated;
      existing.version     = result.version;
    } else {
      S.pushOrder({
        id:          S.nextOid(),
        filename:    result.filename,
        fileHandle:  result.fileHandle,
        doNumber:    result.doNumber,
        partNumber:  result.partNumber,
        partName:    result.partName,
        customer:    result.customer,
        status:      result.status,
        dateCreated: result.dateCreated,
        version:     result.version,
        loaded:      false,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Status badge color helper — matches the existing refreshStatusBadge logic
// ---------------------------------------------------------------------------

function statusColor(status) {
  var map = {
    draft:    '#99aacc',
    review:   '#e9c46a',
    approved: '#50d080',
    released: '#60b0ff',
    obsolete: '#cc8888',
  };
  return map[status] || map.draft;
}

// ---------------------------------------------------------------------------
// buildOrdersPanel — top-level panel builder (called by refreshLeftPanel)
// ---------------------------------------------------------------------------

function buildOrdersPanel() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', flexDirection: 'column', gap: '10px',
    height: '100%', overflow: 'hidden',
  });

  // ── Browser support warning ──────────────────────────────────────────────
  if (!FS.isSupported()) {
    var warn = document.createElement('div');
    Object.assign(warn.style, {
      padding: '10px 12px', borderRadius: '3px',
      background: 'rgba(255,200,50,0.06)',
      border: '1px solid rgba(255,200,50,0.25)',
      fontSize: '9px', color: '#c9a060', lineHeight: '1.7',
    });
    warn.textContent = 'Folder access requires Chrome or Edge. Orders can still be created and managed in memory, but folder sync and file save are unavailable in this browser.';
    wrap.appendChild(warn);
  }

  // ── Folder section ───────────────────────────────────────────────────────
  wrap.appendChild(buildFolderSection());

  // ── Order list ───────────────────────────────────────────────────────────
  wrap.appendChild(buildOrderListSection());

  // ── Action buttons ───────────────────────────────────────────────────────
  wrap.appendChild(buildOrderActionRow());

  return wrap;
}

// ---------------------------------------------------------------------------
// Folder section — path display, Change Folder, Scan buttons
// ---------------------------------------------------------------------------

function buildFolderSection() {
  var section = document.createElement('div');
  Object.assign(section.style, {
    flexShrink: '0',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '3px',
  });

  // Folder path display
  var pathEl = document.createElement('div');
  Object.assign(pathEl.style, {
    fontSize: '9px', color: '#7a9aaa', letterSpacing: '0.3px',
    marginBottom: '8px', lineHeight: '1.5',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  });
  var handle = S.getWorkingFolderHandle();
  pathEl.textContent = handle ? handle.name : 'No folder selected';
  pathEl.title       = handle ? handle.name : '';
  section.appendChild(pathEl);

  // Button row
  var btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '6px' });

  var folderBtn = makeOrderBtn(handle ? 'Change Folder' : 'Select Folder', false);
  var scanBtn   = makeOrderBtn('⟳ Scan', !handle);

  folderBtn.addEventListener('click', function() {
    if (!FS.isSupported()) return;
    FS.requestWorkingFolder()
      .then(function(newHandle) {
        S.setWorkingFolderHandle(newHandle);
        pathEl.textContent = newHandle.name;
        pathEl.title       = newHandle.name;
        folderBtn.textContent = 'Change Folder';
        scanBtn.disabled      = false;
        scanBtn.style.opacity = '1';
        return FS.scanFolder(newHandle);
      })
      .then(function(results) {
        mergeScanResults(results);
        refreshLeftPanel();
      })
      .catch(function(err) {
        if (err && err.name !== 'AbortError') {
          console.warn('forgeworks: folder select failed:', err);
        }
      });
  });

  scanBtn.addEventListener('click', function() {
    var h = S.getWorkingFolderHandle();
    if (!h) return;
    scanBtn.textContent = '...';
    scanBtn.disabled    = true;
    FS.scanFolder(h)
      .then(function(results) {
        mergeScanResults(results);
        refreshLeftPanel();
      })
      .catch(function(err) {
        console.warn('forgeworks: scan failed:', err);
        scanBtn.textContent = '⟳ Scan';
        scanBtn.disabled    = false;
      });
  });

  btnRow.appendChild(folderBtn);
  btnRow.appendChild(scanBtn);
  section.appendChild(btnRow);
  return section;
}

// ---------------------------------------------------------------------------
// Order list section — scrollable list of all known orders
// ---------------------------------------------------------------------------

function buildOrderListSection() {
  var container = document.createElement('div');
  Object.assign(container.style, {
    flex: '1', overflowY: 'auto', minHeight: '0',
    display: 'flex', flexDirection: 'column', gap: '4px',
  });

  // Example order always sits at the top; the rest keep their natural order
  var orders = S.getOrders().slice().sort(function(a, b) {
    if (a.isExample && !b.isExample) return -1;
    if (!a.isExample && b.isExample) return  1;
    return 0;
  });

  if (orders.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      color: '#506070', fontSize: '9px', textAlign: 'center',
      marginTop: '24px', lineHeight: '1.8',
    });
    empty.textContent = 'No delivery orders yet.\nClick + New to create one,\nor select a folder to scan for existing files.';
    empty.style.whiteSpace = 'pre-line';
    container.appendChild(empty);
    return container;
  }

  orders.forEach(function(order) {
    container.appendChild(buildOrderRow(order));
  });

  return container;
}

// ---------------------------------------------------------------------------
// Single order row
// ---------------------------------------------------------------------------

function buildOrderRow(order) {
  var isActive   = order.id === S.getActiveOrderId();
  var isSelected = order.id === S.getSelectedOrderId();

  var row = document.createElement('div');
  Object.assign(row.style, {
    padding: '8px 10px', borderRadius: '3px', cursor: 'pointer',
    border: '1px solid ' + (isSelected ? ACCENT_DIM + '0.55)' : 'rgba(255,255,255,0.08)'),
    background: isSelected ? ACCENT_DIM + '0.08)' : 'rgba(255,255,255,0.02)',
    transition: 'all 0.15s ease',
    position: 'relative',
  });

  row.addEventListener('mouseenter', function() {
    if (!isSelected) {
      row.style.background = 'rgba(255,255,255,0.04)';
      row.style.borderColor = 'rgba(255,255,255,0.18)';
    }
  });
  row.addEventListener('mouseleave', function() {
    if (!isSelected) {
      row.style.background = 'rgba(255,255,255,0.02)';
      row.style.borderColor = 'rgba(255,255,255,0.08)';
    }
  });

  // Single click — highlight only
  row.addEventListener('click', function() {
    S.setSelectedOrderId(order.id);
    refreshLeftPanel();
  });

  // ── First line: DO number + dirty dot + badges ───────────────────────────
  var line1 = document.createElement('div');
  Object.assign(line1.style, {
    display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px',
  });

  var doNum = document.createElement('span');
  Object.assign(doNum.style, {
    fontSize: '9px', fontWeight: '700', letterSpacing: '0.5px',
    color: isActive ? ACCENT : '#aabbcc',
    flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  doNum.textContent = order.doNumber || '—';
  line1.appendChild(doNum);

  if (order.isDirty) {
    var dot = document.createElement('span');
    Object.assign(dot.style, { color: '#e9c46a', fontSize: '8px', flexShrink: '0' });
    dot.textContent = '●';
    dot.title = 'Unsaved changes';
    line1.appendChild(dot);
  }

  // Badge logic:
  //   EXAMPLE  — the built-in coded example
  //   SAVED    — exists on disk (has a fileHandle or filename)
  //   DRAFT    — created in memory, never saved to disk
  var isUnsaved = !order.fileHandle && !order.filename && !order.isExample;
  var isExample = !!order.isExample;
  var isSaved   = !isExample && !isUnsaved;

  // ACTIVE badge — shown to the left of the status badge when this order is open
  if (isActive) {
    var activeBadge = document.createElement('span');
    Object.assign(activeBadge.style, {
      fontSize: '7px', letterSpacing: '1px', textTransform: 'uppercase',
      padding: '1px 5px', borderRadius: '2px', flexShrink: '0',
      color: ACCENT, border: '1px solid ' + ACCENT_DIM + '0.5)',
      background: ACCENT_DIM + '0.10)',
    });
    activeBadge.textContent = 'active';
    line1.appendChild(activeBadge);
  }

  var badge = document.createElement('span');
  var badgeColor  = isExample ? '#2ec4b6' : isSaved ? '#50d080' : '#e9c46a';
  var badgeBorder = isExample ? 'rgba(46,196,182,0.5)' : isSaved ? 'rgba(80,208,128,0.5)' : 'rgba(233,196,106,0.5)';
  var badgeBg     = isExample ? 'rgba(46,196,182,0.08)' : isSaved ? 'rgba(80,208,128,0.06)' : 'rgba(233,196,106,0.08)';
  Object.assign(badge.style, {
    fontSize: '7px', letterSpacing: '1px', textTransform: 'uppercase',
    padding: '1px 5px', borderRadius: '2px', flexShrink: '0',
    color:      badgeColor,
    border:     '1px solid ' + badgeBorder,
    background: badgeBg,
    opacity:    '1',
  });
  badge.textContent = isExample ? 'example' : isSaved ? 'saved' : 'draft';
  line1.appendChild(badge);
  row.appendChild(line1);

  // ── Second line: part name ────────────────────────────────────────────────
  if (order.partName || order.partNumber) {
    var line2 = document.createElement('div');
    Object.assign(line2.style, {
      fontSize: '8px', color: '#6a8898', letterSpacing: '0.3px',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      marginBottom: '2px',
    });
    line2.textContent = [order.partName, order.partNumber].filter(Boolean).join('  ·  ');
    row.appendChild(line2);
  }

  // ── Third line: date ──────────────────────────────────────────────────────
  if (order.dateCreated) {
    var line3 = document.createElement('div');
    Object.assign(line3.style, { fontSize: '8px', color: '#4a6070' });
    line3.textContent = order.dateCreated;
    row.appendChild(line3);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Action button row — New, Open, Close, Save, Delete
// ---------------------------------------------------------------------------

function buildOrderActionRow() {
  var row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', gap: '5px', flexShrink: '0', paddingTop: '4px',
  });

  var selectedId = S.getSelectedOrderId();
  var activeId   = S.getActiveOrderId();
  var canOpen    = selectedId && selectedId !== activeId;
  var canClose   = !!activeId;
  var canSave    = !!activeId;
  var canDelete  = !!selectedId;

  var newBtn    = makeOrderBtn('+ New',  false);
  var openBtn   = makeOrderBtn('Open',   !canOpen);
  var closeBtn  = makeOrderBtn('Close',  !canClose);
  var saveBtn   = makeOrderBtn('Save',   !canSave);
  var deleteBtn = makeOrderBtn('Delete', !canDelete);

  // + New — create a blank order, add to list, and select it (do NOT open)
  newBtn.addEventListener('click', function() {
    var today = new Date().toISOString().slice(0, 10);
    var newOrder = {
      id:          S.nextOid(),
      filename:    null,
      fileHandle:  null,
      doNumber:    'DO-' + today,
      partNumber:  '',
      partName:    '',
      customer:    '',
      status:      'draft',
      dateCreated: today,
      loaded:      true,
      general:     null,
      nodes:       [],
      connections: [],
      nid:         0,
      cid:         0,
      isDirty:     false,
    };
    S.pushOrder(newOrder);
    S.setSelectedOrderId(newOrder.id);
    refreshLeftPanel();   // re-render list with new entry highlighted, Open button enabled
  });

  // Open — load the selected order into the editor
  openBtn.addEventListener('click', function() {
    if (!canOpen) return;
    _openOrder(selectedId);
  });

  // Close — deactivate the current order, lock all panels, clear the canvas
  closeBtn.addEventListener('click', function() {
    if (!canClose) return;

    // Serialize active order back to its slot before closing
    var slot = S.findOrder(function(o) { return o.id === activeId; });
    if (slot) {
      slot.general     = JSON.parse(JSON.stringify(S.getGeneral()));
      slot.nodes       = JSON.parse(JSON.stringify(S.getNodes()));
      slot.connections = JSON.parse(JSON.stringify(S.getConnections()));
      slot.nid         = S.getNid();
      slot.cid         = S.getCid();
      slot.loaded      = true;
      slot.isDirty     = S.getIsDirty();
    }

    // Clear canvas and deactivate
    S.getNodes().forEach(function(n) { removeNodeEl(n.id); });
    S.setNodes([]);
    S.setConnections([]);
    S.setNid(0);
    S.setCid(0);
    S.resetGeneral();
    S.setActiveOrderId(null);
    S.setIsDirty(false);

    refreshConnections();
    refreshCanvasOverlay();
    _refreshRightPanel();
    _refreshCalcPanel();
    refreshLeftPanel();   // re-renders Orders tab and re-locks General/Node/Path
  });

  // Save — save the active order to folder (or download fallback)
  saveBtn.addEventListener('click', function() {
    if (!canSave) return;
    _saveActiveOrder();
  });

  // Delete — remove order from list and optionally delete file
  deleteBtn.addEventListener('click', function() {
    if (!canDelete) return;
    var order = S.findOrder(function(o) { return o.id === selectedId; });
    if (!order) return;

    var label = order.doNumber || order.filename || 'this order';
    var msg   = order.fileHandle
      ? 'Remove ' + label + ' from the list and delete the file from disk?'
      : 'Remove ' + label + ' from the list?';

    if (!window.confirm(msg)) return;

    // If deleting the active order, clear the canvas
    if (selectedId === activeId) {
      S.getNodes().forEach(function(n) { removeNodeEl(n.id); });
      S.setNodes([]);
      S.setConnections([]);
      S.setNid(0);
      S.setCid(0);
      S.resetGeneral();
      S.setActiveOrderId(null);
      S.setIsDirty(false);
      refreshConnections();
      refreshCanvasOverlay();
      _refreshRightPanel();
      _refreshCalcPanel();
    }

    // Delete file from disk if we have a handle
    if (order.fileHandle) {
      FS.deleteOrderFile(order.fileHandle).catch(function(err) {
        console.warn('forgeworks: file delete failed:', err.message);
      });
    }

    S.filterOrders(function(o) { return o.id !== selectedId; });
    S.setSelectedOrderId(null);
    refreshLeftPanel();
  });

  row.appendChild(newBtn);
  row.appendChild(openBtn);
  row.appendChild(closeBtn);
  row.appendChild(saveBtn);
  row.appendChild(deleteBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Shared button factory for the Orders panel
// ---------------------------------------------------------------------------

function makeOrderBtn(label, disabled) {
  var btn = document.createElement('button');
  Object.assign(btn.style, {
    flex: '1', padding: '7px 4px',
    background: 'none',
    border: '1px solid ' + (disabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.20)'),
    borderRadius: '2px',
    color: disabled ? '#3a5060' : '#99aacc',
    fontSize: '9px', fontFamily: 'inherit', letterSpacing: '1px',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'all 0.15s ease',
  });
  btn.textContent = label;
  btn.disabled    = !!disabled;

  if (!disabled) {
    btn.addEventListener('mouseenter', function() {
      btn.style.borderColor = ACCENT_DIM + '0.5)';
      btn.style.color = ACCENT;
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.borderColor = 'rgba(255,255,255,0.20)';
      btn.style.color = '#99aacc';
    });
  }

  return btn;
}