// ============================================================================
// purchaseorders.js — Purchase Order Management
// Forgeworks Infrastructure
// ============================================================================
// Full-screen page for creating and tracking production orders. Allows users
// to specify material grades, forging processes, heat treatments, quantities,
// dimensions, and review cost estimates before submission.
//
// Displays a live order book of pending, in-progress, and completed orders.
//
// Exports: show(), hide(), isVisible(), onBack(callback)
// ============================================================================

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

var overlay = null;
var backCallback = null;
var visible = false;
var orders = [];          // Local order list (demo data)
var orderCounter = 1000;
var activeTab = 'new';    // 'new' or 'book'

// ---------------------------------------------------------------------------
// Reference Data
// ---------------------------------------------------------------------------

var MATERIAL_GRADES = [
  { code: '1018',  name: '1018 Carbon Steel',       category: 'Carbon',    costPerKg: 1.20 },
  { code: '1045',  name: '1045 Medium Carbon',      category: 'Carbon',    costPerKg: 1.45 },
  { code: '4130',  name: '4130 Chromoly',            category: 'Alloy',     costPerKg: 2.80 },
  { code: '4140',  name: '4140 Chrome-Moly',         category: 'Alloy',     costPerKg: 3.10 },
  { code: '4340',  name: '4340 Nickel-Chrome-Moly',  category: 'Alloy',     costPerKg: 4.50 },
  { code: '8620',  name: '8620 Case Hardening',      category: 'Alloy',     costPerKg: 3.40 },
  { code: '304SS', name: '304 Stainless Steel',      category: 'Stainless', costPerKg: 5.20 },
  { code: '316SS', name: '316 Stainless Steel',      category: 'Stainless', costPerKg: 6.10 },
  { code: 'H13',   name: 'H13 Tool Steel',           category: 'Tool',      costPerKg: 8.50 },
  { code: 'D2',    name: 'D2 Tool Steel',            category: 'Tool',      costPerKg: 9.20 },
];

var FORGING_PROCESSES = [
  { id: 'open_die',       name: 'Open Die Forging',       ratePerKg: 2.50, desc: 'Free-form shaping between flat or simple dies' },
  { id: 'closed_die',     name: 'Closed Die Forging',     ratePerKg: 4.00, desc: 'Precision shaping in machined die cavities' },
  { id: 'upset_forging',  name: 'Upset Forging',          ratePerKg: 3.20, desc: 'Axial compression to increase cross-section' },
  { id: 'ring_rolling',   name: 'Ring Rolling',           ratePerKg: 5.00, desc: 'Seamless ring production by radial-axial rolling' },
  { id: 'press_forging',  name: 'Press Forging',          ratePerKg: 3.80, desc: 'Slow continuous pressure via hydraulic press' },
  { id: 'hammer_forging', name: 'Hammer Forging',         ratePerKg: 2.80, desc: 'Rapid impact shaping with drop or power hammers' },
];

var HEAT_TREATMENTS = [
  { id: 'normalize',    name: 'Normalizing',          ratePerKg: 0.80, desc: 'Air cool from above critical — refine grain structure' },
  { id: 'anneal',       name: 'Annealing',            ratePerKg: 0.90, desc: 'Furnace cool — relieve stress, improve machinability' },
  { id: 'quench_temper', name: 'Quench & Temper',     ratePerKg: 1.40, desc: 'Harden by quench, then temper for toughness' },
  { id: 'case_harden',  name: 'Case Hardening',       ratePerKg: 2.20, desc: 'Carburize surface layer for wear resistance' },
  { id: 'induction',    name: 'Induction Hardening',  ratePerKg: 1.80, desc: 'Localized surface hardening via electromagnetic field' },
  { id: 'stress_relief', name: 'Stress Relief',       ratePerKg: 0.60, desc: 'Sub-critical heat to reduce residual stress' },
  { id: 'none',          name: 'No Heat Treatment',   ratePerKg: 0.00, desc: 'Ship as-forged' },
];

var PRIORITY_LEVELS = [
  { id: 'standard',  name: 'Standard',  multiplier: 1.0,  leadDays: '10–14', color: '#556677' },
  { id: 'expedited', name: 'Expedited', multiplier: 1.35, leadDays: '5–7',   color: '#e9c46a' },
  { id: 'rush',      name: 'Rush',      multiplier: 1.75, leadDays: '2–3',   color: '#ef4444' },
];

// Demo orders for the order book
var DEMO_ORDERS = [
  { id: 'PO-0997', material: '4140', process: 'Closed Die', treatment: 'Quench & Temper', qty: 24, weight: 15.0, status: 'complete', priority: 'standard', total: 5832.00, date: '2025-11-02' },
  { id: 'PO-0998', material: '1045', process: 'Hammer Forging', treatment: 'Normalizing', qty: 60, weight: 8.5, status: 'in_progress', priority: 'standard', total: 8721.00, date: '2025-11-15' },
  { id: 'PO-0999', material: '4340', process: 'Open Die', treatment: 'Quench & Temper', qty: 12, weight: 42.0, status: 'in_progress', priority: 'expedited', total: 12474.00, date: '2025-12-01' },
  { id: 'PO-1000', material: '8620', process: 'Press Forging', treatment: 'Case Hardening', qty: 36, weight: 11.0, status: 'pending', priority: 'rush', total: 9188.64, date: '2025-12-10' },
];


// ---------------------------------------------------------------------------
// Build DOM
// ---------------------------------------------------------------------------

function buildOverlay() {
  if (overlay) return;

  injectStyles();

  overlay = document.createElement('div');
  overlay.id = 'forgeworks-purchase-orders';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    background: '#060b11',
    overflow: 'hidden',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', 'Monaco', monospace",
    color: '#aabbcc',
  });

  // --- Subtle background ---
  var bg = document.createElement('div');
  Object.assign(bg.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
    background:
      'radial-gradient(ellipse 70% 50% at 30% 100%, rgba(0,180,216,0.04) 0%, transparent 70%),' +
      'radial-gradient(ellipse 50% 50% at 80% 10%, rgba(0,80,140,0.03) 0%, transparent 60%)',
  });
  overlay.appendChild(bg);

  // --- Grid texture ---
  var gridTex = document.createElement('div');
  Object.assign(gridTex.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none', opacity: '0.02',
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  });
  overlay.appendChild(gridTex);

  // --- Top bar ---
  var topBar = buildTopBar();
  overlay.appendChild(topBar);

  // --- Content area ---
  var contentArea = document.createElement('div');
  contentArea.id = 'po-content-area';
  Object.assign(contentArea.style, {
    position: 'relative', zIndex: '2',
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  });
  overlay.appendChild(contentArea);

  // Build both tabs
  contentArea.appendChild(buildNewOrderTab());
  contentArea.appendChild(buildOrderBookTab());

  switchTab('new');

  document.body.appendChild(overlay);
}


// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function buildTopBar() {
  var bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative', zIndex: '3',
    display: 'flex', alignItems: 'center',
    padding: '0 24px',
    height: '52px', minHeight: '52px',
    borderBottom: '1px solid rgba(0,180,216,0.15)',
    background: 'rgba(4, 8, 14, 0.9)',
    backdropFilter: 'blur(8px)',
  });

  // Back button
  var backBtn = document.createElement('button');
  Object.assign(backBtn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px', color: '#667788', cursor: 'pointer',
    padding: '5px 12px', fontSize: '10px', fontFamily: 'inherit',
    letterSpacing: '1px', transition: 'all 0.2s ease',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  backBtn.innerHTML = '<span style="font-size:14px;line-height:1">\u2039</span> MENU';
  backBtn.addEventListener('mouseenter', function() {
    backBtn.style.borderColor = '#00b4d8';
    backBtn.style.color = '#00b4d8';
  });
  backBtn.addEventListener('mouseleave', function() {
    backBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    backBtn.style.color = '#667788';
  });
  backBtn.addEventListener('click', function() {
    if (backCallback) backCallback();
  });
  bar.appendChild(backBtn);

  // Title
  var title = document.createElement('div');
  Object.assign(title.style, {
    marginLeft: '20px',
    fontSize: '12px', fontWeight: '600',
    letterSpacing: '3px', textTransform: 'uppercase',
    color: '#00b4d8',
  });
  title.textContent = 'Purchase Orders';
  bar.appendChild(title);

  // Accent line
  var accent = document.createElement('div');
  Object.assign(accent.style, {
    marginLeft: '16px', flex: '1', height: '1px',
    background: 'linear-gradient(90deg, rgba(0,180,216,0.3), transparent 60%)',
  });
  bar.appendChild(accent);

  // Tab buttons
  var tabWrap = document.createElement('div');
  Object.assign(tabWrap.style, {
    display: 'flex', gap: '2px',
  });

  var tabs = [
    { key: 'new', label: 'New Order' },
    { key: 'book', label: 'Order Book' },
  ];

  for (var i = 0; i < tabs.length; i++) {
    (function(tab) {
      var btn = document.createElement('button');
      btn.className = 'po-tab-btn';
      btn.dataset.tab = tab.key;
      Object.assign(btn.style, {
        background: 'none', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '3px', color: '#556677', cursor: 'pointer',
        padding: '5px 16px', fontSize: '9px', fontFamily: 'inherit',
        letterSpacing: '1.5px', textTransform: 'uppercase',
        transition: 'all 0.2s ease',
      });
      btn.textContent = tab.label;
      btn.addEventListener('click', function() { switchTab(tab.key); });
      tabWrap.appendChild(btn);
    })(tabs[i]);
  }

  bar.appendChild(tabWrap);
  return bar;
}

function switchTab(key) {
  activeTab = key;
  var newTab = document.getElementById('po-tab-new');
  var bookTab = document.getElementById('po-tab-book');
  if (newTab) newTab.style.display = key === 'new' ? 'flex' : 'none';
  if (bookTab) bookTab.style.display = key === 'book' ? 'flex' : 'none';

  // Update tab button styles
  var btns = overlay ? overlay.querySelectorAll('.po-tab-btn') : [];
  for (var i = 0; i < btns.length; i++) {
    var isActive = btns[i].dataset.tab === key;
    btns[i].style.borderColor = isActive ? 'rgba(0,180,216,0.4)' : 'rgba(255,255,255,0.06)';
    btns[i].style.color = isActive ? '#00b4d8' : '#556677';
    btns[i].style.background = isActive ? 'rgba(0,180,216,0.08)' : 'none';
  }
}


// ---------------------------------------------------------------------------
// New Order Tab
// ---------------------------------------------------------------------------

function buildNewOrderTab() {
  var tab = document.createElement('div');
  tab.id = 'po-tab-new';
  Object.assign(tab.style, {
    flex: '1', display: 'flex',
    overflow: 'hidden',
  });

  // --- Left column: form ---
  var formCol = document.createElement('div');
  Object.assign(formCol.style, {
    flex: '1', overflowY: 'auto',
    padding: '24px 28px',
    borderRight: '1px solid rgba(255,255,255,0.04)',
  });

  formCol.appendChild(buildSection('Material Selection', buildMaterialSection()));
  formCol.appendChild(buildSection('Forging Process', buildProcessSection()));
  formCol.appendChild(buildSection('Heat Treatment', buildTreatmentSection()));
  formCol.appendChild(buildSection('Order Details', buildDetailsSection()));

  tab.appendChild(formCol);

  // --- Right column: cost summary ---
  var summaryCol = document.createElement('div');
  Object.assign(summaryCol.style, {
    width: '320px', minWidth: '320px',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(4, 8, 14, 0.5)',
    borderLeft: '1px solid rgba(255,255,255,0.04)',
  });

  summaryCol.appendChild(buildCostSummary());

  tab.appendChild(summaryCol);
  return tab;
}


function buildSection(title, content) {
  var section = document.createElement('div');
  section.style.marginBottom = '24px';

  var header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '10px', fontWeight: '600',
    letterSpacing: '2px', textTransform: 'uppercase',
    color: '#5a7a8a', marginBottom: '12px',
    paddingBottom: '6px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    display: 'flex', alignItems: 'center', gap: '8px',
  });

  var dot = document.createElement('span');
  Object.assign(dot.style, {
    width: '4px', height: '4px', borderRadius: '50%',
    background: '#00b4d8', flexShrink: '0',
  });
  header.appendChild(dot);
  header.appendChild(document.createTextNode(title));
  section.appendChild(header);
  section.appendChild(content);
  return section;
}


function buildMaterialSection() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: '6px',
  });

  for (var i = 0; i < MATERIAL_GRADES.length; i++) {
    (function(mat) {
      var card = document.createElement('div');
      card.className = 'po-select-card';
      card.dataset.group = 'material';
      card.dataset.value = mat.code;
      Object.assign(card.style, {
        padding: '10px 12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,8,16,0.5)',
        cursor: 'pointer', transition: 'all 0.2s ease',
        position: 'relative',
      });

      var code = document.createElement('div');
      Object.assign(code.style, {
        fontSize: '12px', fontWeight: '700', color: '#b0bec5', marginBottom: '2px',
      });
      code.textContent = mat.code;
      card.appendChild(code);

      var name = document.createElement('div');
      Object.assign(name.style, { fontSize: '9px', color: '#4a5a6a', marginBottom: '4px' });
      name.textContent = mat.name;
      card.appendChild(name);

      var row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      });
      var cat = document.createElement('span');
      Object.assign(cat.style, {
        fontSize: '8px', letterSpacing: '1px', textTransform: 'uppercase',
        color: '#3a4a5a', background: 'rgba(255,255,255,0.03)',
        padding: '1px 5px', borderRadius: '2px',
      });
      cat.textContent = mat.category;
      row.appendChild(cat);

      var price = document.createElement('span');
      Object.assign(price.style, { fontSize: '9px', color: '#4a6a5a' });
      price.textContent = '$' + mat.costPerKg.toFixed(2) + '/kg';
      row.appendChild(price);
      card.appendChild(row);

      card.addEventListener('click', function() {
        selectCard('material', mat.code);
        recalcCost();
      });

      wrap.appendChild(card);
    })(MATERIAL_GRADES[i]);
  }

  return wrap;
}


function buildProcessSection() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '6px',
  });

  for (var i = 0; i < FORGING_PROCESSES.length; i++) {
    (function(proc) {
      var card = document.createElement('div');
      card.className = 'po-select-card';
      card.dataset.group = 'process';
      card.dataset.value = proc.id;
      Object.assign(card.style, {
        padding: '10px 12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,8,16,0.5)',
        cursor: 'pointer', transition: 'all 0.2s ease',
      });

      var name = document.createElement('div');
      Object.assign(name.style, { fontSize: '11px', fontWeight: '600', color: '#b0bec5', marginBottom: '3px' });
      name.textContent = proc.name;
      card.appendChild(name);

      var desc = document.createElement('div');
      Object.assign(desc.style, { fontSize: '9px', color: '#4a5a6a', lineHeight: '1.4', marginBottom: '4px' });
      desc.textContent = proc.desc;
      card.appendChild(desc);

      var rate = document.createElement('div');
      Object.assign(rate.style, { fontSize: '9px', color: '#4a6a5a' });
      rate.textContent = '$' + proc.ratePerKg.toFixed(2) + '/kg';
      card.appendChild(rate);

      card.addEventListener('click', function() {
        selectCard('process', proc.id);
        recalcCost();
      });

      wrap.appendChild(card);
    })(FORGING_PROCESSES[i]);
  }

  return wrap;
}


function buildTreatmentSection() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '6px',
  });

  for (var i = 0; i < HEAT_TREATMENTS.length; i++) {
    (function(ht) {
      var card = document.createElement('div');
      card.className = 'po-select-card';
      card.dataset.group = 'treatment';
      card.dataset.value = ht.id;
      Object.assign(card.style, {
        padding: '10px 12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,8,16,0.5)',
        cursor: 'pointer', transition: 'all 0.2s ease',
      });

      var name = document.createElement('div');
      Object.assign(name.style, { fontSize: '11px', fontWeight: '600', color: '#b0bec5', marginBottom: '3px' });
      name.textContent = ht.name;
      card.appendChild(name);

      var desc = document.createElement('div');
      Object.assign(desc.style, { fontSize: '9px', color: '#4a5a6a', lineHeight: '1.4', marginBottom: '4px' });
      desc.textContent = ht.desc;
      card.appendChild(desc);

      if (ht.ratePerKg > 0) {
        var rate = document.createElement('div');
        Object.assign(rate.style, { fontSize: '9px', color: '#4a6a5a' });
        rate.textContent = '$' + ht.ratePerKg.toFixed(2) + '/kg';
        card.appendChild(rate);
      }

      card.addEventListener('click', function() {
        selectCard('treatment', ht.id);
        recalcCost();
      });

      wrap.appendChild(card);
    })(HEAT_TREATMENTS[i]);
  }

  return wrap;
}


function buildDetailsSection() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px 16px',
  });

  // Quantity
  wrap.appendChild(buildInputField('po-qty', 'Quantity (pcs)', '24', 'number'));
  // Weight per piece
  wrap.appendChild(buildInputField('po-weight', 'Weight per Piece (kg)', '15.0', 'number'));

  // Dimensions
  wrap.appendChild(buildInputField('po-dim-l', 'Length (mm)', '300', 'number'));
  wrap.appendChild(buildInputField('po-dim-w', 'Width (mm)', '150', 'number'));
  wrap.appendChild(buildInputField('po-dim-h', 'Height (mm)', '80', 'number'));

  // Priority
  var prioWrap = document.createElement('div');
  Object.assign(prioWrap.style, { gridColumn: '1 / -1' });
  var prioLabel = document.createElement('div');
  Object.assign(prioLabel.style, {
    fontSize: '9px', color: '#556677', letterSpacing: '1px',
    textTransform: 'uppercase', marginBottom: '6px',
  });
  prioLabel.textContent = 'Priority';
  prioWrap.appendChild(prioLabel);

  var prioRow = document.createElement('div');
  Object.assign(prioRow.style, { display: 'flex', gap: '6px' });

  for (var i = 0; i < PRIORITY_LEVELS.length; i++) {
    (function(prio) {
      var card = document.createElement('div');
      card.className = 'po-select-card';
      card.dataset.group = 'priority';
      card.dataset.value = prio.id;
      Object.assign(card.style, {
        flex: '1', padding: '10px 12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,8,16,0.5)',
        cursor: 'pointer', transition: 'all 0.2s ease',
        textAlign: 'center',
      });

      var name = document.createElement('div');
      Object.assign(name.style, { fontSize: '11px', fontWeight: '600', color: prio.color, marginBottom: '2px' });
      name.textContent = prio.name;
      card.appendChild(name);

      var lead = document.createElement('div');
      Object.assign(lead.style, { fontSize: '9px', color: '#4a5a6a' });
      lead.textContent = prio.leadDays + ' days';
      card.appendChild(lead);

      if (prio.multiplier > 1) {
        var mult = document.createElement('div');
        Object.assign(mult.style, { fontSize: '8px', color: '#5a4a3a', marginTop: '2px' });
        mult.textContent = prio.multiplier.toFixed(2) + 'x rate';
        card.appendChild(mult);
      }

      card.addEventListener('click', function() {
        selectCard('priority', prio.id);
        recalcCost();
      });

      prioRow.appendChild(card);
    })(PRIORITY_LEVELS[i]);
  }

  prioWrap.appendChild(prioRow);
  wrap.appendChild(prioWrap);

  // Customer notes
  var notesWrap = document.createElement('div');
  Object.assign(notesWrap.style, { gridColumn: '1 / -1' });
  var notesLabel = document.createElement('div');
  Object.assign(notesLabel.style, {
    fontSize: '9px', color: '#556677', letterSpacing: '1px',
    textTransform: 'uppercase', marginBottom: '6px',
  });
  notesLabel.textContent = 'Notes';
  notesWrap.appendChild(notesLabel);

  var textarea = document.createElement('textarea');
  textarea.id = 'po-notes';
  Object.assign(textarea.style, {
    width: '100%', height: '60px', resize: 'vertical',
    background: 'rgba(0,8,16,0.6)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', color: '#8899aa', fontSize: '10px',
    fontFamily: 'inherit', padding: '8px', boxSizing: 'border-box',
    outline: 'none', transition: 'border-color 0.2s ease',
  });
  textarea.placeholder = 'Special instructions, tolerances, certifications required...';
  textarea.addEventListener('focus', function() { textarea.style.borderColor = 'rgba(0,180,216,0.3)'; });
  textarea.addEventListener('blur', function() { textarea.style.borderColor = 'rgba(255,255,255,0.08)'; });
  notesWrap.appendChild(textarea);
  wrap.appendChild(notesWrap);

  // Hook up recalc on input changes
  setTimeout(function() {
    var inputs = ['po-qty', 'po-weight'];
    for (var j = 0; j < inputs.length; j++) {
      var el = document.getElementById(inputs[j]);
      if (el) el.addEventListener('input', recalcCost);
    }
  }, 0);

  return wrap;
}


function buildInputField(id, label, placeholder, type) {
  var wrap = document.createElement('div');

  var lbl = document.createElement('div');
  Object.assign(lbl.style, {
    fontSize: '9px', color: '#556677', letterSpacing: '1px',
    textTransform: 'uppercase', marginBottom: '6px',
  });
  lbl.textContent = label;
  wrap.appendChild(lbl);

  var input = document.createElement('input');
  input.id = id;
  input.type = type || 'text';
  input.placeholder = placeholder || '';
  Object.assign(input.style, {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,8,16,0.6)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', color: '#aabbcc', fontSize: '11px',
    fontFamily: 'inherit', padding: '8px 10px',
    outline: 'none', transition: 'border-color 0.2s ease',
  });
  input.addEventListener('focus', function() { input.style.borderColor = 'rgba(0,180,216,0.3)'; });
  input.addEventListener('blur', function() { input.style.borderColor = 'rgba(255,255,255,0.08)'; });
  wrap.appendChild(input);

  return wrap;
}


// ---------------------------------------------------------------------------
// Card Selection Logic
// ---------------------------------------------------------------------------

var selections = { material: null, process: null, treatment: null, priority: 'standard' };

function selectCard(group, value) {
  selections[group] = value;

  var cards = overlay.querySelectorAll('.po-select-card[data-group="' + group + '"]');
  for (var i = 0; i < cards.length; i++) {
    var isSelected = cards[i].dataset.value === value;
    cards[i].style.borderColor = isSelected ? 'rgba(0,180,216,0.5)' : 'rgba(255,255,255,0.06)';
    cards[i].style.background = isSelected ? 'rgba(0,180,216,0.08)' : 'rgba(0,8,16,0.5)';
    cards[i].style.boxShadow = isSelected ? '0 0 12px rgba(0,180,216,0.1)' : 'none';
  }
}


// ---------------------------------------------------------------------------
// Cost Summary Panel
// ---------------------------------------------------------------------------

function buildCostSummary() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    flex: '1', display: 'flex', flexDirection: 'column',
    padding: '24px 20px',
  });

  // Header
  var header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '10px', fontWeight: '600', letterSpacing: '2px',
    textTransform: 'uppercase', color: '#5a7a8a', marginBottom: '20px',
    paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)',
  });
  header.textContent = 'Cost Estimate';
  wrap.appendChild(header);

  // Line items container
  var lines = document.createElement('div');
  lines.id = 'po-cost-lines';
  Object.assign(lines.style, { flex: '1' });
  wrap.appendChild(lines);

  // Divider
  var div = document.createElement('div');
  Object.assign(div.style, {
    height: '1px', margin: '16px 0',
    background: 'linear-gradient(90deg, rgba(0,180,216,0.2), transparent)',
  });
  wrap.appendChild(div);

  // Total
  var totalRow = document.createElement('div');
  Object.assign(totalRow.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    marginBottom: '20px',
  });
  var totalLabel = document.createElement('span');
  Object.assign(totalLabel.style, { fontSize: '11px', color: '#778899', letterSpacing: '1px', textTransform: 'uppercase' });
  totalLabel.textContent = 'Estimated Total';
  totalRow.appendChild(totalLabel);

  var totalValue = document.createElement('span');
  totalValue.id = 'po-cost-total';
  Object.assign(totalValue.style, { fontSize: '20px', fontWeight: '300', color: '#00b4d8' });
  totalValue.textContent = '$0.00';
  totalRow.appendChild(totalValue);
  wrap.appendChild(totalRow);

  // Submit button
  var submitBtn = document.createElement('button');
  submitBtn.id = 'po-submit-btn';
  Object.assign(submitBtn.style, {
    width: '100%', padding: '12px',
    background: 'linear-gradient(135deg, rgba(0,180,216,0.15), rgba(0,180,216,0.05))',
    border: '1px solid rgba(0,180,216,0.3)',
    borderRadius: '4px', color: '#00b4d8',
    fontSize: '11px', fontWeight: '600', fontFamily: 'inherit',
    letterSpacing: '2px', textTransform: 'uppercase',
    cursor: 'pointer', transition: 'all 0.2s ease',
  });
  submitBtn.textContent = 'Submit Order';
  submitBtn.addEventListener('mouseenter', function() {
    submitBtn.style.background = 'linear-gradient(135deg, rgba(0,180,216,0.25), rgba(0,180,216,0.1))';
    submitBtn.style.borderColor = 'rgba(0,180,216,0.6)';
    submitBtn.style.boxShadow = '0 0 20px rgba(0,180,216,0.15)';
  });
  submitBtn.addEventListener('mouseleave', function() {
    submitBtn.style.background = 'linear-gradient(135deg, rgba(0,180,216,0.15), rgba(0,180,216,0.05))';
    submitBtn.style.borderColor = 'rgba(0,180,216,0.3)';
    submitBtn.style.boxShadow = 'none';
  });
  submitBtn.addEventListener('click', submitOrder);
  wrap.appendChild(submitBtn);

  return wrap;
}


function recalcCost() {
  var linesEl = document.getElementById('po-cost-lines');
  var totalEl = document.getElementById('po-cost-total');
  if (!linesEl || !totalEl) return;

  var qty = parseFloat((document.getElementById('po-qty') || {}).value) || 0;
  var weight = parseFloat((document.getElementById('po-weight') || {}).value) || 0;
  var totalWeight = qty * weight;

  var matCost = 0, procCost = 0, treatCost = 0, prioMult = 1;

  // Material
  for (var m = 0; m < MATERIAL_GRADES.length; m++) {
    if (MATERIAL_GRADES[m].code === selections.material) {
      matCost = MATERIAL_GRADES[m].costPerKg * totalWeight;
      break;
    }
  }

  // Process
  for (var p = 0; p < FORGING_PROCESSES.length; p++) {
    if (FORGING_PROCESSES[p].id === selections.process) {
      procCost = FORGING_PROCESSES[p].ratePerKg * totalWeight;
      break;
    }
  }

  // Treatment
  for (var t = 0; t < HEAT_TREATMENTS.length; t++) {
    if (HEAT_TREATMENTS[t].id === selections.treatment) {
      treatCost = HEAT_TREATMENTS[t].ratePerKg * totalWeight;
      break;
    }
  }

  // Priority
  for (var pr = 0; pr < PRIORITY_LEVELS.length; pr++) {
    if (PRIORITY_LEVELS[pr].id === selections.priority) {
      prioMult = PRIORITY_LEVELS[pr].multiplier;
      break;
    }
  }

  var subtotal = matCost + procCost + treatCost;
  var total = subtotal * prioMult;

  // Render line items
  linesEl.innerHTML = '';
  var items = [
    { label: 'Material (' + (selections.material || '—') + ')', value: matCost },
    { label: 'Forging Process', value: procCost },
    { label: 'Heat Treatment', value: treatCost },
  ];

  if (totalWeight > 0) {
    var wtLine = document.createElement('div');
    Object.assign(wtLine.style, {
      fontSize: '9px', color: '#445566', marginBottom: '12px',
      padding: '6px 8px', background: 'rgba(255,255,255,0.02)',
      borderRadius: '3px',
    });
    wtLine.textContent = qty + ' pcs × ' + weight + ' kg = ' + totalWeight.toFixed(1) + ' kg total';
    linesEl.appendChild(wtLine);
  }

  for (var li = 0; li < items.length; li++) {
    var row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', justifyContent: 'space-between',
      fontSize: '10px', marginBottom: '8px',
    });
    var lbl = document.createElement('span');
    lbl.style.color = '#667788';
    lbl.textContent = items[li].label;
    row.appendChild(lbl);
    var val = document.createElement('span');
    val.style.color = items[li].value > 0 ? '#8899aa' : '#334455';
    val.textContent = '$' + items[li].value.toFixed(2);
    row.appendChild(val);
    linesEl.appendChild(row);
  }

  if (prioMult > 1) {
    var prioRow = document.createElement('div');
    Object.assign(prioRow.style, {
      display: 'flex', justifyContent: 'space-between',
      fontSize: '10px', marginBottom: '8px', marginTop: '8px',
      paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)',
    });
    var prioLbl = document.createElement('span');
    prioLbl.style.color = '#7a6a4a';
    prioLbl.textContent = 'Priority surcharge (' + prioMult.toFixed(2) + 'x)';
    prioRow.appendChild(prioLbl);
    var prioVal = document.createElement('span');
    prioVal.style.color = '#aa9966';
    prioVal.textContent = '+$' + (total - subtotal).toFixed(2);
    prioRow.appendChild(prioVal);
    linesEl.appendChild(prioRow);
  }

  totalEl.textContent = '$' + total.toFixed(2);
}


function submitOrder() {
  var qty = parseFloat((document.getElementById('po-qty') || {}).value) || 0;
  var weight = parseFloat((document.getElementById('po-weight') || {}).value) || 0;
  if (!selections.material || !selections.process || qty <= 0) {
    flashSubmitButton('Select material, process, and quantity');
    return;
  }

  orderCounter++;
  var total = parseFloat((document.getElementById('po-cost-total') || {}).textContent.replace('$', '')) || 0;

  var matName = selections.material;
  var procName = '';
  for (var p = 0; p < FORGING_PROCESSES.length; p++) {
    if (FORGING_PROCESSES[p].id === selections.process) { procName = FORGING_PROCESSES[p].name; break; }
  }
  var treatName = '';
  for (var t = 0; t < HEAT_TREATMENTS.length; t++) {
    if (HEAT_TREATMENTS[t].id === selections.treatment) { treatName = HEAT_TREATMENTS[t].name; break; }
  }

  var newOrder = {
    id: 'PO-' + orderCounter,
    material: matName,
    process: procName,
    treatment: treatName || 'None',
    qty: qty,
    weight: weight,
    status: 'pending',
    priority: selections.priority || 'standard',
    total: total,
    date: new Date().toISOString().split('T')[0],
  };

  orders.unshift(newOrder);
  flashSubmitButton('Order PO-' + orderCounter + ' submitted!');
  refreshOrderBook();

  console.log('Order submitted:', newOrder);
}


function flashSubmitButton(msg) {
  var btn = document.getElementById('po-submit-btn');
  if (!btn) return;
  var orig = btn.textContent;
  btn.textContent = msg;
  btn.style.borderColor = 'rgba(34,197,94,0.5)';
  btn.style.color = '#22c55e';
  setTimeout(function() {
    btn.textContent = orig;
    btn.style.borderColor = 'rgba(0,180,216,0.3)';
    btn.style.color = '#00b4d8';
  }, 2000);
}


// ---------------------------------------------------------------------------
// Order Book Tab
// ---------------------------------------------------------------------------

function buildOrderBookTab() {
  var tab = document.createElement('div');
  tab.id = 'po-tab-book';
  Object.assign(tab.style, {
    flex: '1', display: 'none',
    flexDirection: 'column',
    overflow: 'hidden',
  });

  // Stats row
  var stats = document.createElement('div');
  stats.id = 'po-book-stats';
  Object.assign(stats.style, {
    display: 'flex', gap: '12px',
    padding: '16px 28px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  });
  tab.appendChild(stats);

  // Table
  var tableWrap = document.createElement('div');
  tableWrap.id = 'po-book-table';
  Object.assign(tableWrap.style, {
    flex: '1', overflowY: 'auto',
    padding: '0 28px 28px',
  });
  tab.appendChild(tableWrap);

  return tab;
}


function refreshOrderBook() {
  var allOrders = DEMO_ORDERS.concat(orders);
  allOrders.sort(function(a, b) { return b.id.localeCompare(a.id); });

  // Stats
  var statsEl = document.getElementById('po-book-stats');
  if (statsEl) {
    var pending = 0, inProg = 0, complete = 0, totalVal = 0;
    for (var s = 0; s < allOrders.length; s++) {
      if (allOrders[s].status === 'pending') pending++;
      else if (allOrders[s].status === 'in_progress') inProg++;
      else if (allOrders[s].status === 'complete') complete++;
      totalVal += allOrders[s].total;
    }

    statsEl.innerHTML = '';
    var statItems = [
      { label: 'Total Orders', value: allOrders.length, color: '#00b4d8' },
      { label: 'Pending', value: pending, color: '#e9c46a' },
      { label: 'In Progress', value: inProg, color: '#2ec4b6' },
      { label: 'Complete', value: complete, color: '#22c55e' },
      { label: 'Total Value', value: '$' + totalVal.toFixed(0), color: '#8899aa' },
    ];

    for (var si = 0; si < statItems.length; si++) {
      var card = document.createElement('div');
      Object.assign(card.style, {
        flex: '1', padding: '10px 14px',
        background: 'rgba(0,8,16,0.5)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '3px',
      });
      var cv = document.createElement('div');
      Object.assign(cv.style, { fontSize: '18px', fontWeight: '300', color: statItems[si].color, marginBottom: '2px' });
      cv.textContent = statItems[si].value;
      card.appendChild(cv);
      var cl = document.createElement('div');
      Object.assign(cl.style, { fontSize: '8px', color: '#556677', letterSpacing: '1px', textTransform: 'uppercase' });
      cl.textContent = statItems[si].label;
      card.appendChild(cl);
      statsEl.appendChild(card);
    }
  }

  // Table
  var tableEl = document.getElementById('po-book-table');
  if (!tableEl) return;
  tableEl.innerHTML = '';

  // Header row
  var headerRow = document.createElement('div');
  Object.assign(headerRow.style, {
    display: 'grid',
    gridTemplateColumns: '80px 70px 130px 130px 50px 80px 80px 90px 80px',
    gap: '0', padding: '10px 12px',
    fontSize: '8px', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: '#445566', borderBottom: '1px solid rgba(255,255,255,0.06)',
    position: 'sticky', top: '0',
    background: '#060b11',
  });
  var cols = ['Order ID', 'Date', 'Material', 'Process', 'Qty', 'Wt/pc', 'Treatment', 'Status', 'Total'];
  for (var c = 0; c < cols.length; c++) {
    var th = document.createElement('div');
    th.textContent = cols[c];
    headerRow.appendChild(th);
  }
  tableEl.appendChild(headerRow);

  // Data rows
  for (var r = 0; r < allOrders.length; r++) {
    var order = allOrders[r];
    var row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '80px 70px 130px 130px 50px 80px 80px 90px 80px',
      gap: '0', padding: '9px 12px',
      fontSize: '10px', color: '#778899',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      transition: 'background 0.15s ease',
    });
    row.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.02)'; });
    row.addEventListener('mouseleave', function() { this.style.background = 'none'; });

    var statusColor = {
      pending: '#e9c46a',
      in_progress: '#2ec4b6',
      complete: '#22c55e',
    }[order.status] || '#556677';

    var statusLabel = {
      pending: 'Pending',
      in_progress: 'In Progress',
      complete: 'Complete',
    }[order.status] || order.status;

    var prioColor = '#556677';
    for (var pi = 0; pi < PRIORITY_LEVELS.length; pi++) {
      if (PRIORITY_LEVELS[pi].id === order.priority) { prioColor = PRIORITY_LEVELS[pi].color; break; }
    }

    var cells = [
      { text: order.id, style: 'color:' + prioColor + ';font-weight:600' },
      { text: order.date },
      { text: order.material },
      { text: order.process },
      { text: String(order.qty) },
      { text: order.weight + ' kg' },
      { text: order.treatment },
      { text: statusLabel, style: 'color:' + statusColor },
      { text: '$' + order.total.toFixed(0) },
    ];

    for (var ci = 0; ci < cells.length; ci++) {
      var cell = document.createElement('div');
      if (cells[ci].style) cell.setAttribute('style', cells[ci].style);
      cell.textContent = cells[ci].text;
      row.appendChild(cell);
    }

    tableEl.appendChild(row);
  }
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('po-styles')) return;
  var style = document.createElement('style');
  style.id = 'po-styles';
  style.textContent =
    '#forgeworks-purchase-orders ::-webkit-scrollbar { width: 6px; }' +
    '#forgeworks-purchase-orders ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }' +
    '#forgeworks-purchase-orders ::-webkit-scrollbar-thumb { background: rgba(0,180,216,0.2); border-radius: 3px; }' +
    '#forgeworks-purchase-orders ::-webkit-scrollbar-thumb:hover { background: rgba(0,180,216,0.4); }' +
    '.po-select-card:hover { border-color: rgba(0,180,216,0.3) !important; background: rgba(0,180,216,0.04) !important; }';
  document.head.appendChild(style);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function show() {
  buildOverlay();
  overlay.style.display = 'flex';
  visible = true;

  // Initialize priority selection
  selectCard('priority', 'standard');
  recalcCost();
  refreshOrderBook();
}

export function hide() {
  if (overlay) overlay.style.display = 'none';
  visible = false;
}

export function isVisible() {
  return visible;
}

export function onBack(callback) {
  backCallback = callback;
}
