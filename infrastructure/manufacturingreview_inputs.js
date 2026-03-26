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
import * as DON from './manufacturingreview_donumber.js';

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
    width: '280px', minWidth: '60px', maxWidth: '800px', flexShrink: '0',
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

  // Left side: fixed "Delivery Order : " prefix + dynamic DO number value
  var jobLabel = document.createElement('div');
  Object.assign(jobLabel.style, {
    fontSize: '9px', color: '#7a9aaa', letterSpacing: '0.5px',
    display: 'flex', alignItems: 'center', gap: '0',
    overflow: 'hidden', whiteSpace: 'nowrap',
  });
  var jobPrefix = document.createElement('span');
  jobPrefix.textContent = 'Delivery Order:';
  var jobValue = document.createElement('span');
  jobValue.id = 'mr-strip-do-value';
  jobValue.textContent = '';
  jobLabel.appendChild(jobPrefix);
  jobLabel.appendChild(jobValue);

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

// ---------------------------------------------------------------------------
// buildCollapsibleSection — like buildInputSection but with a chevron toggle
// startOpen defaults to true. State is stored on the returned element.
// ---------------------------------------------------------------------------

function buildCollapsibleSection(title, fields, startOpen) {
  var open = startOpen !== false;
  var section = document.createElement('div');
  Object.assign(section.style, { display: 'flex', flexDirection: 'column', gap: '8px' });

  // Header row
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: '9px', letterSpacing: '2.5px', textTransform: 'uppercase', color: ACCENT,
    paddingBottom: '6px', borderBottom: '1px solid ' + ACCENT_DIM + '0.25)',
    cursor: 'pointer', userSelect: 'none',
  });

  var hdrTitle = document.createElement('span');
  hdrTitle.textContent = title;

  var chevron = document.createElement('span');
  Object.assign(chevron.style, {
    fontSize: '12px', transition: 'transform 0.2s ease', display: 'inline-block',
    color: ACCENT,
  });
  chevron.textContent = '▾';

  hdr.appendChild(hdrTitle);
  hdr.appendChild(chevron);
  section.appendChild(hdr);

  // Content wrapper
  var body = document.createElement('div');
  Object.assign(body.style, {
    display:    'flex',
    flexDirection: 'column',
    gap:        '8px',
    overflow:   'hidden',
    transition: 'max-height 0.28s ease, opacity 0.2s ease',
    opacity:    '1',
  });
  fields.forEach(function(f) { if (f) body.appendChild(f); });
  section.appendChild(body);

  function applyState(animate) {
    if (open) {
      // Expand: set max-height to scrollHeight so it slides open
      body.style.display  = 'flex';
      requestAnimationFrame(function() {
        body.style.maxHeight = body.scrollHeight + 'px';
        body.style.opacity   = '1';
        // After the slide-open completes, release the height constraint
        body.addEventListener('transitionend', function handler(e) {
          if (e.propertyName === 'max-height' && open) {
            body.style.maxHeight = 'none';
          }
          body.removeEventListener('transitionend', handler);
        });
      });
    } else {
      // Collapse: lock current height and force reflow so the browser commits
      // it as the transition start point, then animate to 0
      body.style.maxHeight = body.scrollHeight + 'px';
      body.offsetHeight;   // force reflow — without this the first collapse skips the slide
      requestAnimationFrame(function() {
        body.style.maxHeight = '0px';
        body.style.opacity   = '0';
      });
      // Hide from layout after transition ends so it doesn't take up space
      body.addEventListener('transitionend', function handler() {
        if (!open) body.style.display = 'none';
        body.removeEventListener('transitionend', handler);
      });
    }
    chevron.style.transform = open ? 'scaleY(1)' : 'scaleY(-1)';
  }

  // Initial state without animation
  if (open) {
    body.style.maxHeight = 'none';   // no numeric ceiling — collapse will measure scrollHeight
    body.style.opacity   = '1';
  } else {
    body.style.maxHeight = '0px';
    body.style.opacity   = '0';
    body.style.display   = 'none';
  }
  chevron.style.transform = open ? 'scaleY(1)' : 'scaleY(-1)';

  hdr.addEventListener('click', function() {
    open = !open;
    applyState(true);
  });

  return section;
}

function buildGeneralInputs() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '18px' });
  var gen = S.getGeneral();

  // ── Document section ─────────────────────────────────────────────────────
  var docSection = buildCollapsibleSection('Document', [
    buildDoNumberInput(),
    buildTextInput('Author',    'mr-g-author',    gen.author,    function(v) { S.getGeneral().author    = v; S.setIsDirty(true); }),
    buildTextInput('Estimator', 'mr-g-estimator', gen.estimator, function(v) { S.getGeneral().estimator = v; S.setIsDirty(true); }),
    buildTextInput('Revision',  'mr-g-rev',       gen.revision,  function(v) { S.getGeneral().revision  = v; S.setIsDirty(true); }),
  ]);
  wrap.appendChild(docSection);

  // ── Customer section ─────────────────────────────────────────────────────
  wrap.appendChild(buildCollapsibleSection('Customer', [
    buildTextInput('Company Name',          'mr-g-company',  gen.company,      function(v) { S.getGeneral().company      = v; S.setIsDirty(true); }),
    buildTextInput('Customer Number',       'mr-g-custnum',  gen.customerNum,  function(v) { S.getGeneral().customerNum  = v; S.setIsDirty(true); }),
    buildTextInput('Purchase Order Number', 'mr-g-ponum',    gen.poNumber,     function(v) { S.getGeneral().poNumber     = v; S.setIsDirty(true); }),
    buildTextInput('Company Phone',         'mr-g-cophone',  gen.companyPhone, function(v) { S.getGeneral().companyPhone = v; S.setIsDirty(true); }),
    buildTextInput('Company Fax',           'mr-g-cofax',    gen.companyFax,   function(v) { S.getGeneral().companyFax   = v; S.setIsDirty(true); }),
    buildTextInput('Company Email',         'mr-g-coemail',  gen.companyEmail, function(v) { S.getGeneral().companyEmail = v; S.setIsDirty(true); }),
    buildTextInput('Address',               'mr-g-addr1',    gen.addrLine1,    function(v) { S.getGeneral().addrLine1    = v; S.setIsDirty(true); }),
    buildTextInput('Address Line 2',        'mr-g-addr2',    gen.addrLine2,    function(v) { S.getGeneral().addrLine2    = v; S.setIsDirty(true); }),
    buildTextInput('City',                  'mr-g-city',     gen.addrCity,     function(v) { S.getGeneral().addrCity     = v; S.setIsDirty(true); }),
    buildTextInput('State / Province',      'mr-g-state',    gen.addrState,    function(v) { S.getGeneral().addrState    = v; S.setIsDirty(true); }),
    buildTextInput('Postal Code',           'mr-g-zip',      gen.addrZip,      function(v) { S.getGeneral().addrZip      = v; S.setIsDirty(true); }),
    buildTextInput('Country',               'mr-g-country',  gen.addrCountry,  function(v) { S.getGeneral().addrCountry  = v; S.setIsDirty(true); }),
  ]));

  // ── Buyer section ─────────────────────────────────────────────────────────
  wrap.appendChild(buildCollapsibleSection('Buyer', [
    buildTextInput('Buyer Name',  'mr-g-buyername',  gen.buyerName,  function(v) { S.getGeneral().buyerName  = v; S.setIsDirty(true); }),
    buildTextInput('Buyer Phone', 'mr-g-buyerphone', gen.buyerPhone, function(v) { S.getGeneral().buyerPhone = v; S.setIsDirty(true); }),
    buildTextInput('Buyer Email', 'mr-g-buyeremail', gen.buyerEmail, function(v) { S.getGeneral().buyerEmail = v; S.setIsDirty(true); }),
    buildTextInput('Buyer Fax',   'mr-g-buyerfax',   gen.buyerFax,   function(v) { S.getGeneral().buyerFax   = v; S.setIsDirty(true); }),
  ]));

  // ── Status section ───────────────────────────────────────────────────────
  wrap.appendChild(buildCollapsibleSection('Status', [
    buildTextInput('Order Written Date', 'mr-g-datewritten', gen.dateWritten, function(v) { S.getGeneral().dateWritten = v; S.setIsDirty(true); }),
    buildTextInput('Promise Date',       'mr-g-datepromise', gen.datePromise, function(v) { S.getGeneral().datePromise = v; S.setIsDirty(true); }),
    buildTextInput('Ship Date',          'mr-g-dateship',    gen.dateShip,    function(v) { S.getGeneral().dateShip    = v; S.setIsDirty(true); }),
    buildTextInput('Arrival Date',       'mr-g-datearrival', gen.dateArrival, function(v) { S.getGeneral().dateArrival = v; S.setIsDirty(true); }),
    buildSelectEl('Status', 'mr-g-status', [
      { value: 'draft',    label: 'Draft'     },
      { value: 'review',   label: 'In Review' },
      { value: 'approved', label: 'Approved'  },
      { value: 'released', label: 'Released'  },
      { value: 'complete', label: 'Complete'  },
      { value: 'obsolete', label: 'Obsolete'  },
    ], gen.status, function(v) { S.getGeneral().status = v; S.setIsDirty(true); _refreshStatusBadge(); }),
  ]));

  // ── Batch section — only shown for parent or child orders ────────────────
  if (gen.isParent || gen.isChild) {
    var batchFields = [];

    if (gen.isParent) {
      batchFields.push(buildNumberInputEl(
        'Total Quantity', 'mr-g-totalqty', gen.totalQuantity || 0,
        0, 999999, 1,
        function(v) { S.getGeneral().totalQuantity = v; S.setIsDirty(true); }
      ));
      var childInfo = document.createElement('div');
      Object.assign(childInfo.style, {
        fontSize: '9px', color: '#7a9aaa', lineHeight: '1.6',
        padding: '6px 8px', background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.10)', borderRadius: '3px',
      });
      childInfo.textContent = gen.childCount + ' batch' + (gen.childCount !== 1 ? 'es' : '') + ' assigned to this order.';
      batchFields.push(childInfo);
    }

    if (gen.isChild) {
      batchFields.push(buildNumberInputEl(
        'Batch Quantity', 'mr-g-batchqty', gen.batchQuantity || 0,
        0, 999999, 1,
        function(v) { S.getGeneral().batchQuantity = v; S.setIsDirty(true); }
      ));
      var parentInfo = document.createElement('div');
      Object.assign(parentInfo.style, {
        fontSize: '9px', color: '#7a9aaa', lineHeight: '1.6',
        padding: '6px 8px', background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.10)', borderRadius: '3px',
      });
      parentInfo.textContent = 'Part of parent DO ' + (gen.parentDoNumber || '—') + '.';
      if (DON.isTerminating(gen.doNumber)) {
        parentInfo.textContent += '\nThis is the final batch — receipt closes the order.';
        parentInfo.style.color = '#2ec4b6';
      }
      batchFields.push(parentInfo);
    }

    batchFields.push(buildTextareaInput(
      'Batch Notes', 'mr-g-batchnotes', gen.batchNotes || '',
      function(v) { S.getGeneral().batchNotes = v; S.setIsDirty(true); }
    ));

    wrap.appendChild(buildCollapsibleSection('Batch', batchFields));
  }

  // ── Notes section ────────────────────────────────────────────────────────
  wrap.appendChild(buildCollapsibleSection('Notes', [
    buildTextareaInput('Additional Details', 'mr-g-notes', gen.notes, function(v) { S.getGeneral().notes = v; S.setIsDirty(true); }),
  ]));

  return wrap;
}

// ---------------------------------------------------------------------------
// DO Number input — validated, structured, zero-pads on blur.
// Children show the full DO number read-only with suffix highlighted.
// Parents and standalones show an editable base field with live validation.
// ---------------------------------------------------------------------------

function buildDoNumberInput() {
  var gen = S.getGeneral();
  var wrap = fWrap();
  wrap.appendChild(fLabel('DO Number', 'mr-g-do-base'));

  if (gen.isChild) {
    // ── Child: full DO number read-only, suffix and total visually highlighted
    var row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '0' });

    var basePart = document.createElement('div');
    var parsed = DON.parseDoNumber(gen.doNumber);
    Object.assign(basePart.style, {
      padding: '6px 8px', fontSize: '11px', fontFamily: 'inherit',
      background: 'rgba(255,255,255,0.07)', border: '2px solid rgba(255,255,255,0.12)',
      borderRight: 'none', borderRadius: '3px 0 0 3px', color: '#c0ccd8',
      flex: '1',
    });
    basePart.textContent = parsed.base || gen.doNumber;

    // Look up total batch count from the parent order in the session
    var parentOrder = S.findOrder(function(o) {
      return !o.isChild && DON.getBaseNumber(o.doNumber || '') === gen.parentDoNumber;
    });
    var totalBatches = parentOrder ? parentOrder.childCount : null;
    var suffixDisplay = '-' + (parsed.suffix || '??');
    if (totalBatches) suffixDisplay += '/' + String(totalBatches).padStart(2, '0');

    var isFinal = DON.isTerminating(gen.doNumber);
    var suffixPart = document.createElement('div');
    Object.assign(suffixPart.style, {
      padding: '6px 10px', fontSize: '11px', fontFamily: 'inherit',
      background: isFinal ? 'rgba(46,196,182,0.15)' : 'rgba(255,255,255,0.04)',
      border: '2px solid ' + (isFinal ? 'rgba(46,196,182,0.4)' : 'rgba(255,255,255,0.12)'),
      borderRadius: '0 3px 3px 0',
      color: isFinal ? '#2ec4b6' : '#e9c46a',
      fontWeight: '700', letterSpacing: '1px',
      flexShrink: '0',
    });
    suffixPart.textContent = suffixDisplay;
    if (totalBatches) suffixPart.title = 'Batch ' + (parseInt(parsed.suffix, 10) + 1) + ' of ' + totalBatches;

    row.appendChild(basePart);
    row.appendChild(suffixPart);
    wrap.appendChild(row);

  } else {
    // ── Standalone / parent: editable base field with validation ─────────
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.id   = 'mr-g-do-base';
    inp.value = gen.doNumber || '';
    inp.placeholder = '000001';
    inp.maxLength = 9;
    sInput(inp);

    // Inline validation error element
    var errEl = document.createElement('div');
    Object.assign(errEl.style, {
      fontSize: '8px', color: '#ef7777', letterSpacing: '0.5px',
      minHeight: '12px', marginTop: '2px',
      display: 'none',
    });
    wrap.appendChild(inp);
    wrap.appendChild(errEl);

    // Live validation on input — strip non-digits, flag errors
    inp.addEventListener('input', function() {
      // Only allow digits (no hyphen — suffix is assigned at split, never typed)
      var digitsOnly = inp.value.replace(/\D/g, '');
      if (inp.value !== digitsOnly) inp.value = digitsOnly;

      var err = DON.validateDoNumber(digitsOnly || '0');
      if (err && digitsOnly.length > 0) {
        errEl.textContent = err;
        errEl.style.display = 'block';
        inp.style.borderColor = 'rgba(239,68,68,0.6)';
      } else {
        errEl.style.display = 'none';
        inp.style.borderColor = '';
      }

      // Update state on every keystroke so the strip stays live
      S.getGeneral().doNumber = digitsOnly;
      S.setIsDirty(true);
      var val = document.getElementById('mr-strip-do-value');
      if (val) val.textContent = digitsOnly ? '\u00a0' + digitsOnly : '';

      // Also update the in-memory order slot so the list row reflects the change
      var activeId = S.getActiveOrderId();
      if (activeId) {
        var slot = S.findOrder(function(o) { return o.id === activeId; });
        if (slot) slot.doNumber = digitsOnly;
      }
    });

    // On blur — zero-pad to 6 digits if valid
    inp.addEventListener('blur', function() {
      var v = inp.value.replace(/\D/g, '');
      if (v && DON.validateDoNumber(v) === null) {
        var padded = DON.formatBase(v);
        inp.value = padded;
        S.getGeneral().doNumber = padded;
        errEl.style.display = 'none';
        inp.style.borderColor = '';
        var val = document.getElementById('mr-strip-do-value');
        if (val) val.textContent = padded ? '\u00a0' + padded : '';

        var activeId = S.getActiveOrderId();
        if (activeId) {
          var slot = S.findOrder(function(o) { return o.id === activeId; });
          if (slot) {
            var oldBase = slot.doNumber ? DON.getBaseNumber(slot.doNumber) : null;
            slot.doNumber = padded;

            // If this is a parent order, cascade the new base to all its children
            if (slot.isParent && oldBase && oldBase !== padded) {
              S.getOrders().forEach(function(child) {
                if (child.isChild && child.parentDoNumber === oldBase) {
                  var suffix = DON.getSuffix(child.doNumber);
                  child.doNumber       = DON.buildDoNumber(padded, suffix);
                  child.parentDoNumber = padded;
                  if (child.general) {
                    child.general.doNumber       = child.doNumber;
                    child.general.parentDoNumber = padded;
                  }
                }
              });
              // Update parentDoNumber on the slot itself
              slot.parentDoNumber = null; // parent has no parent
            }
          }
        }
      }
    });
  }

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
    if (o.isExample)                         return true;
    if (!o.fileHandle && !o.filename)        return true;
    if (o.id === S.getActiveOrderId())       return true;
    return false;
  });

  // Step 2 — Add fresh scan results.
  // Match by DID1 or DID2 first (most reliable), fall back to filename for
  // old files that predate the DID system.
  scanResults.forEach(function(result) {
    var existing = null;

    // DID match — finds the same order even if it was renamed on disk
    if (result.did1 || result.did2) {
      existing = S.findOrder(function(o) {
        return (result.did1 && o.did1 && o.did1 === result.did1) ||
               (result.did2 && o.did2 && o.did2 === result.did2);
      });
    }

    // Filename fallback for pre-DID files
    if (!existing) {
      existing = S.findOrder(function(o) { return o.filename === result.filename; });
    }

    if (existing) {
      existing.fileHandle     = result.fileHandle;
      existing.filename       = result.filename;   // update in case of rename
      existing.doNumber       = result.doNumber;
      existing.partNumber     = result.partNumber;
      existing.partName       = result.partName;
      existing.customer       = result.customer;
      existing.status         = result.status;
      existing.dateCreated    = result.dateCreated;
      existing.version        = result.version;
      if (result.did1) existing.did1 = result.did1;
      if (result.did2) existing.did2 = result.did2;
      existing.isParent       = result.isParent;
      existing.isChild        = result.isChild;
      existing.parentDoNumber = result.parentDoNumber;
      existing.childCount     = result.childCount;
    } else {
      S.pushOrder({
        id:             S.nextOid(),
        did1:           result.did1 || '',
        did2:           result.did2 || '',
        filename:       result.filename,
        fileHandle:     result.fileHandle,
        doNumber:       result.doNumber,
        partNumber:     result.partNumber,
        partName:       result.partName,
        customer:       result.customer,
        status:         result.status,
        dateCreated:    result.dateCreated,
        version:        result.version,
        isParent:       result.isParent,
        isChild:        result.isChild,
        parentDoNumber: result.parentDoNumber,
        childCount:     result.childCount,
        isExpanded:     false,
        loaded:         false,
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
// Order list section — scrollable, tree-grouped
// ---------------------------------------------------------------------------

function buildOrderListSection() {
  var container = document.createElement('div');
  Object.assign(container.style, {
    flex: '1', overflowY: 'auto', minHeight: '0',
    display: 'flex', flexDirection: 'column', gap: '4px',
  });

  var allOrders = S.getOrders();

  var nonExample = allOrders.filter(function(o) { return !o.isExample; });
  if (allOrders.length === 0 || (nonExample.length === 0 && !allOrders.find(function(o){ return o.isExample; }))) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      color: '#506070', fontSize: '9px', textAlign: 'center',
      marginTop: '24px', lineHeight: '1.8', whiteSpace: 'pre-line',
    });
    empty.textContent = 'No delivery orders yet.\nClick + New to create one,\nor select a folder to scan for existing files.';
    container.appendChild(empty);
    return container;
  }

  // Group into tree entries:
  //   { order, children[] }
  // Example always first. Then parents/standalones sorted numerically,
  // each with their children sorted suffix-descending (02→01→00).
  var groups = groupOrdersForDisplay(allOrders);

  groups.forEach(function(group) {
    // Parent / standalone row
    container.appendChild(buildOrderRow(group.order, false, group.children.length > 0));

    // Children — only shown when parent is expanded
    if (group.order.isExpanded && group.children.length > 0) {
      group.children.forEach(function(child, idx) {
        var isLast = idx === group.children.length - 1;
        container.appendChild(buildOrderRow(child, true, false, isLast));
      });
    }
  });

  return container;
}

// ---------------------------------------------------------------------------
// Group all orders into display tree entries
// ---------------------------------------------------------------------------

function groupOrdersForDisplay(allOrders) {
  var example   = allOrders.filter(function(o) { return  o.isExample;  });
  var children  = allOrders.filter(function(o) { return !o.isExample && o.isChild;  });
  var topLevel  = allOrders.filter(function(o) { return !o.isExample && !o.isChild; });

  // Sort top-level numerically by DO number
  topLevel.sort(function(a, b) {
    return DON.compareDoNumbers(a.doNumber || '', b.doNumber || '');
  });

  // Build child lookup by parentDoNumber
  var childMap = {};
  children.forEach(function(c) {
    var key = c.parentDoNumber || '';
    if (!childMap[key]) childMap[key] = [];
    childMap[key].push(c);
  });

  // Sort each child group suffix-descending (02 first, 00 last)
  Object.keys(childMap).forEach(function(key) {
    childMap[key].sort(function(a, b) {
      return DON.compareDoNumbers(a.doNumber || '', b.doNumber || '');
    });
  });

  // Assemble groups: example first, then top-level with their children
  var groups = [];

  example.forEach(function(o) {
    groups.push({ order: o, children: [] });
  });

  topLevel.forEach(function(o) {
    var parsed   = DON.parseDoNumber(o.doNumber || '');
    var kids     = (parsed.isValid ? childMap[parsed.base] : null) || [];
    groups.push({ order: o, children: kids });
  });

  // Orphaned children (parent not in list) — append as standalone rows
  children.forEach(function(c) {
    var parentBase = c.parentDoNumber || '';
    var parentInList = topLevel.find(function(t) {
      var p = DON.parseDoNumber(t.doNumber || '');
      return p.isValid && p.base === parentBase;
    });
    if (!parentInList) {
      c._isOrphan = true;
      groups.push({ order: c, children: [] });
    }
  });

  return groups;
}

// ---------------------------------------------------------------------------
// Single order row
// indented   — true for child rows (adds left indent + connector)
// hasChildren — true for parent rows that can be expanded
// isLastChild — true for the -00 terminating child
// ---------------------------------------------------------------------------

function buildOrderRow(order, indented, hasChildren, isLastChild) {
  var isActive   = order.id === S.getActiveOrderId();
  var isSelected = order.id === S.getSelectedOrderId();

  var row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'stretch',
    borderRadius: '3px', cursor: 'pointer',
    border: '1px solid ' + (isSelected ? ACCENT_DIM + '0.55)' : 'rgba(255,255,255,0.08)'),
    background: isSelected ? ACCENT_DIM + '0.08)' : 'rgba(255,255,255,0.02)',
    transition: 'all 0.15s ease',
    marginLeft: indented ? '12px' : '0',
  });

  row.addEventListener('mouseenter', function() {
    if (!isSelected) {
      row.style.background  = 'rgba(255,255,255,0.04)';
      row.style.borderColor = 'rgba(255,255,255,0.18)';
    }
  });
  row.addEventListener('mouseleave', function() {
    if (!isSelected) {
      row.style.background  = 'rgba(255,255,255,0.02)';
      row.style.borderColor = 'rgba(255,255,255,0.08)';
    }
  });
  row.addEventListener('click', function() {
    S.setSelectedOrderId(order.id);
    refreshLeftPanel();
  });

  // ── Left gutter: expand triangle (parents) or connector line (children) ──
  var gutter = document.createElement('div');
  Object.assign(gutter.style, {
    width: '20px', flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '8px', color: '#4a6070',
    borderRight: indented ? '1px solid rgba(255,255,255,0.08)' : 'none',
  });

  if (hasChildren) {
    gutter.textContent = order.isExpanded ? '▼' : '▶';
    gutter.style.cursor = 'pointer';
    gutter.style.color  = '#7a9aaa';
    gutter.addEventListener('click', function(e) {
      e.stopPropagation();
      order.isExpanded = !order.isExpanded;
      refreshLeftPanel();
    });
  } else if (indented) {
    gutter.textContent = '│';
  }

  row.appendChild(gutter);

  // ── Content area ──────────────────────────────────────────────────────────
  var content = document.createElement('div');
  Object.assign(content.style, { flex: '1', padding: '7px 8px', minWidth: '0' });

  // Line 1: DO number + badges
  var line1 = document.createElement('div');
  Object.assign(line1.style, {
    display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px',
  });

  var doNum = document.createElement('span');
  Object.assign(doNum.style, {
    fontSize: '9px', fontWeight: '700', letterSpacing: '0.5px',
    color: isActive ? ACCENT : (order._isOrphan ? '#e9c46a' : '#aabbcc'),
    flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  doNum.textContent = order.doNumber || '—';
  line1.appendChild(doNum);

  // Parent row: show child count hint
  if (hasChildren) {
    var countHint = document.createElement('span');
    Object.assign(countHint.style, { fontSize: '7px', color: '#4a6070', flexShrink: '0' });
    countHint.textContent = order.childCount + ' batch' + (order.childCount !== 1 ? 'es' : '');
    line1.appendChild(countHint);
  }

  // For the active order, use the live S.getIsDirty() state
  var effectiveDirty = isActive ? S.getIsDirty() : !!order.isDirty;
  var isExample      = !!order.isExample;
  var hasFile        = !isExample && (!!order.fileHandle || !!order.filename);

  // Helper to build a consistent badge span
  function makeBadge(text, color, borderAlpha, bgAlpha, tooltip) {
    var b = document.createElement('span');
    Object.assign(b.style, {
      fontSize: '7px', letterSpacing: '1px', textTransform: 'uppercase',
      padding: '1px 5px', borderRadius: '2px', flexShrink: '0',
      color: color,
      border: '1px solid ' + color.replace(')', ', ' + (borderAlpha || '0.5)').replace('rgb', 'rgba')),
      background: color.replace(')', ', ' + (bgAlpha || '0.08)').replace('rgb', 'rgba')),
    });
    // Simpler approach — inline the colors directly
    b.style.border      = '1px solid ' + color + '80';
    b.style.background  = color + '14';
    b.textContent = text;
    if (tooltip) b.title = tooltip;
    return b;
  }

  // ACTIVE
  if (isActive) {
    line1.appendChild(makeBadge('active', ACCENT));
  }

  // EXAMPLE
  if (isExample) {
    line1.appendChild(makeBadge('example', '#9a70d0'));   // purple
  }

  // PARENT / CHILD / ORPHAN — structural relationship tags
  if (!isExample) {
    if (order._isOrphan) {
      line1.appendChild(makeBadge('orphan', '#d4763b', null, null, 'Parent DO not found in this session'));  // burnt orange — distinct from everything
    } else if (order.isParent) {
      line1.appendChild(makeBadge('parent', '#60a0e0'));  // blue
    } else if (order.isChild) {
      line1.appendChild(makeBadge('child',  '#e879a0'));  // pink
    }
  }

  // FINAL — -00 terminating batch
  if (isLastChild && order.isChild && !order._isOrphan) {
    line1.appendChild(makeBadge('final', '#2ec4b6'));     // teal
  }

  // SAVED / UNSAVED — always shown, purely reflects whether a file exists
  if (!isExample) {
    if (hasFile) {
      line1.appendChild(makeBadge('saved',   '#50d080'));  // green
    } else {
      line1.appendChild(makeBadge('unsaved', '#99aacc'));  // grey
    }
  }

  // DRAFT — additional tag when file exists but has unsaved edits
  if (!isExample && hasFile && effectiveDirty) {
    line1.appendChild(makeBadge('draft', '#e9c46a'));     // amber
  }

  content.appendChild(line1);

  // Line 2: part name · part number
  if (order.partName || order.partNumber) {
    var line2 = document.createElement('div');
    Object.assign(line2.style, {
      fontSize: '8px', color: '#6a8898', letterSpacing: '0.3px',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      marginBottom: '1px',
    });
    line2.textContent = [order.partName, order.partNumber].filter(Boolean).join('  ·  ');
    content.appendChild(line2);
  }

  // Line 3: date
  if (order.dateCreated) {
    var line3 = document.createElement('div');
    Object.assign(line3.style, { fontSize: '8px', color: '#4a6070' });
    line3.textContent = order.dateCreated;
    content.appendChild(line3);
  }

  row.appendChild(content);
  return row;
}

// ---------------------------------------------------------------------------
// Action button row — New, Split, Open, Close, Save, Delete
// ---------------------------------------------------------------------------

function buildOrderActionRow() {
  var row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', gap: '5px', flexShrink: '0', paddingTop: '4px',
    flexWrap: 'wrap',
  });

  var selectedId  = S.getSelectedOrderId();
  var activeId    = S.getActiveOrderId();
  var selectedOrder = selectedId ? S.findOrder(function(o) { return o.id === selectedId; }) : null;

  // Open: enabled when selected is not active
  var canOpen   = selectedId && selectedId !== activeId;
  // Split: enabled when selected is the active order AND standalone (not example, not already parent, not a child)
  var canSplit  = selectedOrder && !selectedOrder.isExample &&
                  !selectedOrder.isParent && !selectedOrder.isChild &&
                  selectedId === activeId;
  var canClose  = !!activeId;
  var canSave   = !!activeId;
  var canDelete = !!selectedId;

  var newBtn    = makeOrderBtn('+ New',  false);
  var splitBtn  = makeOrderBtn('Split',  !canSplit);
  var openBtn   = makeOrderBtn('Open',   !canOpen);
  var closeBtn  = makeOrderBtn('Close',  !canClose);
  var saveBtn   = makeOrderBtn('Save',   !canSave);
  var deleteBtn = makeOrderBtn('Delete', !canDelete);

  // Tooltip on Open when blocked by parent-with-children
  if (selectedOrder && !canSplit && !selectedOrder.isExample &&
      !selectedOrder.isParent && !selectedOrder.isChild) {
    splitBtn.title = 'Open this order first to split it.';
  }

  // + New
  newBtn.addEventListener('click', function() {
    var today = new Date().toISOString().slice(0, 10);
    var newOrder = {
      id:             S.nextOid(),
      did1:           DON.generateDID1(),
      did2:           DON.generateDID2(),
      filename:       null,
      fileHandle:     null,
      doNumber:       '',
      partNumber:     '',
      partName:       '',
      customer:       '',
      status:         'draft',
      dateCreated:    today,
      isParent:       false,
      isChild:        false,
      parentDoNumber: null,
      childCount:     0,
      isExpanded:     false,
      loaded:         true,
      general:        null,
      nodes:          [],
      connections:    [],
      nid:            0,
      cid:            0,
      isDirty:        false,
    };
    S.pushOrder(newOrder);
    S.setSelectedOrderId(newOrder.id);
    refreshLeftPanel();
  });

  // Split — replace button row with inline form
  splitBtn.addEventListener('click', function() {
    if (!canSplit) return;
    var actionArea = row.parentNode;
    if (!actionArea) return;
    actionArea.removeChild(row);
    actionArea.appendChild(buildSplitForm(selectedOrder, function() {
      // On cancel or confirm — restore the normal button row
      actionArea.removeChild(actionArea.lastChild);
      actionArea.appendChild(buildOrderActionRow());
    }));
  });

  // Open
  openBtn.addEventListener('click', function() {
    if (!canOpen) return;
    _openOrder(selectedId);
  });

  // Close
  closeBtn.addEventListener('click', function() {
    if (!canClose) return;
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
    _refreshStatusBadge();
    _refreshRightPanel();
    _refreshCalcPanel();
    refreshLeftPanel();
  });

  // Save
  saveBtn.addEventListener('click', function() {
    if (!canSave) return;
    _saveActiveOrder();
  });

  // Delete — removes the selected order; children of a deleted parent become orphans
  deleteBtn.addEventListener('click', function() {
    if (!canDelete) return;
    var order = S.findOrder(function(o) { return o.id === selectedId; });
    if (!order) return;

    var label    = order.doNumber || order.filename || 'this order';
    var children = order.isParent
      ? S.getOrders().filter(function(o) { return o.isChild && o.parentDoNumber === DON.getBaseNumber(order.doNumber); })
      : [];

    var msg = order.isParent && children.length > 0
      ? 'Remove parent ' + label + ' from the list?' +
        (order.fileHandle ? '\nThe parent file will be deleted from disk.' : '') +
        '\n\nIts ' + children.length + ' batch' + (children.length !== 1 ? 'es' : '') +
        ' will remain as orphaned orders.'
      : (order.fileHandle
          ? 'Remove ' + label + ' from the list and delete the file from disk?'
          : 'Remove ' + label + ' from the list?');

    if (!window.confirm(msg)) return;

    // If deleting the active order, clear canvas
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
      _refreshStatusBadge();
      _refreshRightPanel();
      _refreshCalcPanel();
    }

    // Delete only the selected order's file from disk — never touch child files
    if (order.fileHandle) {
      FS.deleteOrderFile(order.fileHandle).catch(function(err) {
        console.warn('forgeworks: file delete failed:', err.message);
      });
    }

    // Orphan any children — clear their parentDoNumber link so they show as orphans
    if (order.isParent && children.length > 0) {
      children.forEach(function(child) {
        child.isChild        = false;
        child.parentDoNumber = null;
        child._isOrphan      = true;
        if (child.general) {
          child.general.isChild        = false;
          child.general.parentDoNumber = null;
        }
      });
    }

    // If deleting a child, decrement its parent's childCount
    if (order.isChild && order.parentDoNumber) {
      var parent = S.findOrder(function(o) {
        return !o.isChild && DON.getBaseNumber(o.doNumber) === order.parentDoNumber;
      });
      if (parent) {
        parent.childCount = Math.max(0, (parent.childCount || 1) - 1);
        if (parent.childCount === 0) {
          parent.isParent = false;
          if (parent.general) parent.general.isParent = false;
          if (parent.general) parent.general.childCount = 0;
        }
      }
    }

    // Remove only the selected order from the list
    S.filterOrders(function(o) { return o.id !== selectedId; });
    S.setSelectedOrderId(null);
    refreshLeftPanel();
  });

  row.appendChild(newBtn);
  row.appendChild(splitBtn);
  row.appendChild(openBtn);
  row.appendChild(closeBtn);
  row.appendChild(saveBtn);
  row.appendChild(deleteBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Inline split form — replaces the button row when Split is clicked
// onDone() is called on both Confirm and Cancel to restore the button row
// ---------------------------------------------------------------------------

function buildSplitForm(order, onDone) {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
    flexShrink: '0', paddingTop: '4px',
  });

  // Header
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    fontSize: '9px', color: '#99aacc', letterSpacing: '0.5px',
    paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.10)',
  });
  hdr.textContent = 'Split ' + (order.doNumber || 'order') + ' into batches:';
  wrap.appendChild(hdr);

  // Input row
  var inputRow = document.createElement('div');
  Object.assign(inputRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });

  var lbl = document.createElement('label');
  Object.assign(lbl.style, {
    fontSize: '8px', letterSpacing: '1px', textTransform: 'uppercase', color: '#7a9aaa',
    flexShrink: '0',
  });
  lbl.textContent = 'Batches:';

  var inp = document.createElement('input');
  inp.type = 'number'; inp.min = '2'; inp.max = '99'; inp.value = '2';
  inp.style.cssText = 'width:60px;padding:5px 8px;background:rgba(255,255,255,0.12);' +
    'border:2px solid rgba(255,255,255,0.18);border-radius:3px;color:#c0ccd8;' +
    'font-size:11px;font-family:inherit;outline:none;';

  var errEl = document.createElement('div');
  Object.assign(errEl.style, {
    fontSize: '8px', color: '#ef7777', display: 'none', letterSpacing: '0.3px',
  });

  inputRow.appendChild(lbl);
  inputRow.appendChild(inp);
  inputRow.appendChild(errEl);
  wrap.appendChild(inputRow);

  // Preview — updates as user types
  var preview = document.createElement('div');
  Object.assign(preview.style, {
    fontSize: '8px', color: '#4a6070', lineHeight: '1.7',
    padding: '6px 8px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px',
  });
  wrap.appendChild(preview);

  function updatePreview() {
    var n = parseInt(inp.value, 10);
    if (isNaN(n) || n < 2 || n > 99) { preview.textContent = ''; return; }
    try {
      var suffixes = DON.generateChildSuffixes(n);
      var base     = DON.getBaseNumber(order.doNumber || '');
      preview.textContent = suffixes.map(function(s, i) {
        return base + '-' + s + (i === suffixes.length - 1 ? '  ← final' : '');
      }).join('\n');
    } catch(e) { preview.textContent = ''; }
  }
  inp.addEventListener('input', updatePreview);
  updatePreview();

  // Confirm / Cancel buttons
  var btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '5px' });

  var confirmBtn = makeOrderBtn('Confirm', false);
  var cancelBtn  = makeOrderBtn('Cancel',  false);

  confirmBtn.addEventListener('click', function() {
    errEl.style.display = 'none';
    var n = parseInt(inp.value, 10);
    if (isNaN(n) || n < 2) {
      errEl.textContent = 'Enter at least 2 batches.';
      errEl.style.display = 'block';
      return;
    }
    if (n > 99) {
      errEl.textContent = 'Maximum 99 batches.';
      errEl.style.display = 'block';
      return;
    }

    var base     = DON.getBaseNumber(order.doNumber || '');
    var suffixes = DON.generateChildSuffixes(n);
    var today    = new Date().toISOString().slice(0, 10);

    // Mark the parent
    order.isParent   = true;
    order.childCount = n;
    order.isExpanded = true;
    order.isDirty    = true;   // parent file is now out of date — needs resave
    S.setIsDirty(true);        // also set live flag so the draft badge shows immediately
    if (order.general) {
      order.general.isParent   = true;
      order.general.childCount = n;
    }

    // Create child orders
    suffixes.forEach(function(suffix) {
      var childDoNumber = DON.buildDoNumber(base, suffix);
      var childGeneral  = order.general
        ? JSON.parse(JSON.stringify(order.general))
        : JSON.parse(JSON.stringify(S.getGeneral()));
      childGeneral.doNumber       = childDoNumber;
      childGeneral.isParent       = false;
      childGeneral.isChild        = true;
      childGeneral.parentDoNumber = base;
      childGeneral.childCount     = 0;
      childGeneral.batchQuantity  = 0;
      childGeneral.batchNotes     = '';

      S.pushOrder({
        id:             S.nextOid(),
        did1:           DON.generateDID1(),
        did2:           DON.generateDID2(),
        filename:       null,
        fileHandle:     null,
        doNumber:       childDoNumber,
        partNumber:     order.partNumber || '',
        partName:       order.partName   || '',
        customer:       order.customer   || '',
        status:         'draft',
        dateCreated:    today,
        isParent:       false,
        isChild:        true,
        parentDoNumber: base,
        childCount:     0,
        isExpanded:     false,
        loaded:         true,
        general:        childGeneral,
        nodes:          [],
        connections:    [],
        nid:            0,
        cid:            0,
        isDirty:        true,
      });
    });

    onDone();
    refreshLeftPanel();
  });

  cancelBtn.addEventListener('click', onDone);

  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  wrap.appendChild(btnRow);
  return wrap;
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
    whiteSpace: 'nowrap',
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