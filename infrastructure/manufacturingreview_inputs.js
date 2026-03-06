// ============================================================================
// manufacturingreview_inputs.js — Left Panel (General / Node / Path tabs)
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Owns the left panel with three tab modes:
//   general      — job metadata fields
//   node_detail  — per-node parameter inputs for the selected node
//   path         — connection cycle count for the selected connection
//
// Cross-panel refresh calls are injected once via init() to avoid circular
// imports.  refreshLeftPanel() is defined here and calls itself directly.
//
// Imports:  manufacturingreview_states.js (S)
//           manufacturingreview.js (NODE_DEFS, MATERIAL_CATALOG, ACCENT, ACCENT_DIM,
//                                   round3, toDisplay, fromDisplay, unitSuffix, scaleParam,
//                                   buildInputSection, buildTextInput, buildNumberInputEl,
//                                   buildSelectEl, buildTextareaInput, fWrap, fLabel, sInput)
//           manufacturingreview_process.js (refreshConnections)
// Exports:  init(), buildLeftPanel(), refreshLeftPanel()
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
import { refreshConnections, deleteNode, deleteConn } from './manufacturingreview_process.js';

// ---------------------------------------------------------------------------
// Injected cross-panel refresh callbacks (set once via init())
// ---------------------------------------------------------------------------

var _refreshRightPanel  = function() {};
var _refreshCalcPanel   = function() {};
var _refreshNodeEl      = function() {};
var _refreshStatusBadge = function() {};

export function init(callbacks) {
  if (callbacks.refreshRightPanel)  _refreshRightPanel  = callbacks.refreshRightPanel;
  if (callbacks.refreshCalcPanel)   _refreshCalcPanel   = callbacks.refreshCalcPanel;
  if (callbacks.refreshNodeEl)      _refreshNodeEl      = callbacks.refreshNodeEl;
  if (callbacks.refreshStatusBadge) _refreshStatusBadge = callbacks.refreshStatusBadge;
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
  ['General', 'Node', 'Path'].forEach(function(label, i) {
    var key = label.toLowerCase().replace(' ', '_');
    var modeVal = key === 'node' ? 'node_detail' : key;
    var tab = document.createElement('div');
    tab.id = 'mr-tab-' + key;
    Object.assign(tab.style, {
      flex: '1', padding: '10px 0', textAlign: 'center',
      fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase',
      cursor: 'pointer', transition: 'all 0.2s ease',
      color: i === 0 ? ACCENT : '#7a9aaa',
      borderBottom: i === 0 ? '2px solid ' + ACCENT : '2px solid transparent',
    });
    tab.textContent = label;
    tab.addEventListener('click', function() {
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
  jobLabel.textContent = S.getGeneral().jobNumber || '—';
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
  var gTab = document.getElementById('mr-tab-general');
  var nTab = document.getElementById('mr-tab-node');
  var pTab = document.getElementById('mr-tab-path');
  [
    { el: gTab, mode: 'general'     },
    { el: nTab, mode: 'node_detail' },
    { el: pTab, mode: 'path'        },
  ].forEach(function(t) {
    if (!t.el) return;
    var active = S.getLeftMode() === t.mode;
    t.el.style.color        = active ? ACCENT : '#7a9aaa';
    t.el.style.borderBottom = active ? '2px solid ' + ACCENT : '2px solid transparent';
  });

  var content = document.getElementById('mr-left-content');
  if (!content) return;
  content.innerHTML = '';

  if (S.getLeftMode() === 'general') {
    content.appendChild(buildGeneralInputs());
  } else if (S.getLeftMode() === 'node_detail') {
    var node = S.getNodes().find(function(n) { return n.id === S.getSelectedId(); });
    if (node) {
      content.appendChild(buildNodeDetail(node));
    } else {
      var ph = document.createElement('div');
      Object.assign(ph.style, { color: '#607888', fontSize: '10px', textAlign: 'center', marginTop: '40px' });
      ph.textContent = 'Click a node to edit its parameters';
      content.appendChild(ph);
    }
  } else if (S.getLeftMode() === 'path') {
    var conn = S.getConnections().find(function(c) { return c.id === S.getSelectedConnId(); });
    if (conn) {
      content.appendChild(buildPathDetail(conn));
    } else {
      var ph2 = document.createElement('div');
      Object.assign(ph2.style, { color: '#607888', fontSize: '10px', textAlign: 'center', marginTop: '40px', lineHeight: '1.8' });
      ph2.textContent = 'Click a connection to edit its path settings';
      content.appendChild(ph2);
    }
  }
}

function buildGeneralInputs() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '18px' });

  wrap.appendChild(buildInputSection('Document', [
    buildTextInput('Job Number',  'mr-g-job',  S.getGeneral().jobNumber,  function(v) {
      S.getGeneral().jobNumber = v;
      var s = document.getElementById('mr-strip-job');
      if (s) s.textContent = v || '—';
    }),
    buildTextInput('Part Number', 'mr-g-pn',   S.getGeneral().partNumber, function(v) { S.getGeneral().partNumber = v; }),
    buildTextInput('Part Name',   'mr-g-pname',S.getGeneral().partName,   function(v) { S.getGeneral().partName   = v; }),
    buildTextInput('Revision',    'mr-g-rev',  S.getGeneral().revision,   function(v) { S.getGeneral().revision   = v; }),
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