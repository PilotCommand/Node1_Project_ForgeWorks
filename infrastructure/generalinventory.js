// ============================================================================
// generalinventory.js — General Inventory Management
// Forgeworks Infrastructure
// ============================================================================
// Full-screen inventory page showing all forge assets organized by category:
// raw materials, work-in-progress, finished goods, equipment, tooling, and
// consumables. Registry-style layout with search, filtering, and stats.
//
// Exports: show(), hide(), isVisible(), onBack(callback)
// ============================================================================

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

var overlay = null;
var backCallback = null;
var visible = false;
var activeCategory = 'all';
var searchTerm = '';

// ---------------------------------------------------------------------------
// Accent Color
// ---------------------------------------------------------------------------

var ACCENT = '#2ec4b6';
var ACCENT_DIM = 'rgba(46, 196, 182, ';

// ---------------------------------------------------------------------------
// Inventory Categories
// ---------------------------------------------------------------------------

var CATEGORIES = [
  { key: 'all',         label: 'All Items',       icon: '\u25A6' },
  { key: 'raw',         label: 'Raw Materials',   icon: '\u25C8' },
  { key: 'wip',         label: 'Work in Progress', icon: '\u25D4' },
  { key: 'finished',    label: 'Finished Goods',  icon: '\u25C9' },
  { key: 'equipment',   label: 'Equipment',       icon: '\u2699' },
  { key: 'tooling',     label: 'Tooling',         icon: '\u2692' },
  { key: 'consumables', label: 'Consumables',     icon: '\u229E' },
];

// ---------------------------------------------------------------------------
// Demo Inventory Data
// ---------------------------------------------------------------------------

var INVENTORY = [
  // Raw Materials
  { id: 'RAW-001', name: '4140 Chrome-Moly Billet',     category: 'raw', sku: '4140-BLT-6R', location: 'Yard A, Rack 3',     qty: 48,  unit: 'pcs',  weight: 85.0,  status: 'in_stock',  reorder: 20, value: 12648.00 },
  { id: 'RAW-002', name: '1045 Carbon Round Bar',       category: 'raw', sku: '1045-RND-4R', location: 'Yard A, Rack 1',     qty: 120, unit: 'pcs',  weight: 22.5,  status: 'in_stock',  reorder: 50, value: 3915.00 },
  { id: 'RAW-003', name: '4340 Ni-Cr-Mo Ingot',         category: 'raw', sku: '4340-ING-8R', location: 'Yard B, Rack 2',     qty: 8,   unit: 'pcs',  weight: 210.0, status: 'low_stock', reorder: 10, value: 7560.00 },
  { id: 'RAW-004', name: '304SS Plate Stock',            category: 'raw', sku: '304-PLT-12',  location: 'Yard A, Rack 5',     qty: 32,  unit: 'pcs',  weight: 45.0,  status: 'in_stock',  reorder: 15, value: 7488.00 },
  { id: 'RAW-005', name: '8620 Case Hardening Bar',     category: 'raw', sku: '8620-BAR-3R', location: 'Yard B, Rack 1',     qty: 5,   unit: 'pcs',  weight: 18.0,  status: 'critical',  reorder: 30, value: 306.00 },
  { id: 'RAW-006', name: 'H13 Tool Steel Block',        category: 'raw', sku: 'H13-BLK-6',   location: 'Vault 1',            qty: 14,  unit: 'pcs',  weight: 95.0,  status: 'in_stock',  reorder: 5,  value: 11305.00 },

  // Work in Progress
  { id: 'WIP-001', name: 'Crankshaft Forging (4140)',   category: 'wip', sku: 'WIP-CS-4140',  location: 'Furnace Bay 2',     qty: 6,   unit: 'pcs',  weight: 32.0,  status: 'heating',    reorder: null, value: 2976.00 },
  { id: 'WIP-002', name: 'Flange Ring (4340)',           category: 'wip', sku: 'WIP-FR-4340',  location: 'Press Station 1',   qty: 4,   unit: 'pcs',  weight: 68.0,  status: 'forging',    reorder: null, value: 4896.00 },
  { id: 'WIP-003', name: 'Gear Blank (8620)',            category: 'wip', sku: 'WIP-GB-8620',  location: 'Quench Tank 1',     qty: 12,  unit: 'pcs',  weight: 8.5,   status: 'quenching',  reorder: null, value: 1387.20 },
  { id: 'WIP-004', name: 'Connecting Rod (1045)',        category: 'wip', sku: 'WIP-CR-1045',  location: 'Hammer Station 2',  qty: 18,  unit: 'pcs',  weight: 4.2,   status: 'forging',    reorder: null, value: 657.72 },
  { id: 'WIP-005', name: 'Die Block (H13)',              category: 'wip', sku: 'WIP-DB-H13',   location: 'Furnace Bay 1',     qty: 2,   unit: 'pcs',  weight: 140.0, status: 'heating',    reorder: null, value: 4760.00 },

  // Finished Goods
  { id: 'FIN-001', name: 'Crankshaft Assembly Q&T',     category: 'finished', sku: 'FIN-CS-001', location: 'Finished Bay A',  qty: 22,  unit: 'pcs',  weight: 30.5,  status: 'ready',      reorder: null, value: 14630.00 },
  { id: 'FIN-002', name: 'Flange Ring Normalized',       category: 'finished', sku: 'FIN-FR-002', location: 'Finished Bay A',  qty: 16,  unit: 'pcs',  weight: 65.0,  status: 'ready',      reorder: null, value: 11520.00 },
  { id: 'FIN-003', name: 'Gear Blank Case Hardened',     category: 'finished', sku: 'FIN-GB-003', location: 'Finished Bay B',  qty: 40,  unit: 'pcs',  weight: 8.0,   status: 'ready',      reorder: null, value: 5440.00 },
  { id: 'FIN-004', name: 'Connecting Rod Batch 12',      category: 'finished', sku: 'FIN-CR-004', location: 'Shipping Dock',   qty: 60,  unit: 'pcs',  weight: 4.0,   status: 'shipping',   reorder: null, value: 5220.00 },
  { id: 'FIN-005', name: 'Custom Shaft (4340)',           category: 'finished', sku: 'FIN-SH-005', location: 'QC Hold',        qty: 3,   unit: 'pcs',  weight: 52.0,  status: 'qc_hold',    reorder: null, value: 3744.00 },

  // Equipment
  { id: 'EQP-001', name: '2000T Hydraulic Press',        category: 'equipment', sku: 'EQP-HP-2K',  location: 'Press Bay 1',     qty: 1, unit: 'unit', weight: null, status: 'operational',  reorder: null, value: 450000.00 },
  { id: 'EQP-002', name: 'Gas Forge Furnace #1',         category: 'equipment', sku: 'EQP-FF-01',  location: 'Furnace Bay 1',   qty: 1, unit: 'unit', weight: null, status: 'operational',  reorder: null, value: 85000.00 },
  { id: 'EQP-003', name: 'Gas Forge Furnace #2',         category: 'equipment', sku: 'EQP-FF-02',  location: 'Furnace Bay 2',   qty: 1, unit: 'unit', weight: null, status: 'maintenance',  reorder: null, value: 85000.00 },
  { id: 'EQP-004', name: 'Power Hammer 500kg',           category: 'equipment', sku: 'EQP-PH-500', location: 'Hammer Bay',      qty: 1, unit: 'unit', weight: null, status: 'operational',  reorder: null, value: 120000.00 },
  { id: 'EQP-005', name: 'Oil Quench Tank 5000L',        category: 'equipment', sku: 'EQP-QT-5K',  location: 'Quench Bay',      qty: 1, unit: 'unit', weight: null, status: 'operational',  reorder: null, value: 35000.00 },
  { id: 'EQP-006', name: '5T Bridge Crane',              category: 'equipment', sku: 'EQP-BC-5T',  location: 'Main Hall',       qty: 1, unit: 'unit', weight: null, status: 'operational',  reorder: null, value: 68000.00 },
  { id: 'EQP-007', name: 'Forklift CAT DP25',            category: 'equipment', sku: 'EQP-FL-25',  location: 'Yard',            qty: 2, unit: 'unit', weight: null, status: 'operational',  reorder: null, value: 52000.00 },

  // Tooling
  { id: 'TL-001', name: 'Flat Die Set (Open Die)',      category: 'tooling', sku: 'TL-FD-OD',  location: 'Tool Room',       qty: 4,  unit: 'sets', weight: 180.0, status: 'in_stock',    reorder: 2, value: 12000.00 },
  { id: 'TL-002', name: 'Crankshaft Die (Closed)',      category: 'tooling', sku: 'TL-CD-CS',  location: 'Press Bay 1',     qty: 2,  unit: 'sets', weight: 320.0, status: 'in_use',      reorder: 1, value: 45000.00 },
  { id: 'TL-003', name: 'Ring Rolling Mandrel Set',     category: 'tooling', sku: 'TL-RR-MS',  location: 'Tool Room',       qty: 3,  unit: 'sets', weight: 85.0,  status: 'in_stock',    reorder: 1, value: 18000.00 },
  { id: 'TL-004', name: 'Swage Blocks (Assorted)',      category: 'tooling', sku: 'TL-SB-AST', location: 'Hammer Bay',      qty: 8,  unit: 'pcs',  weight: 45.0,  status: 'in_use',      reorder: 4, value: 6400.00 },
  { id: 'TL-005', name: 'Tongs Set — Heavy',            category: 'tooling', sku: 'TL-TG-HV',  location: 'Tool Room',       qty: 12, unit: 'pcs',  weight: 6.0,   status: 'in_stock',    reorder: 6, value: 2160.00 },
  { id: 'TL-006', name: 'Fuller & Flatter Set',         category: 'tooling', sku: 'TL-FF-SET', location: 'Hammer Bay',      qty: 1,  unit: 'set',  weight: 15.0,  status: 'low_stock',   reorder: 2, value: 850.00 },

  // Consumables
  { id: 'CON-001', name: 'Quench Oil ISO 32',            category: 'consumables', sku: 'CON-QO-32',  location: 'Oil Store',     qty: 2200, unit: 'L',   weight: null, status: 'in_stock',  reorder: 1000, value: 4400.00 },
  { id: 'CON-002', name: 'Forge Scale Remover',          category: 'consumables', sku: 'CON-SR-01',  location: 'Chemical Store', qty: 45,   unit: 'kg',  weight: null, status: 'in_stock',  reorder: 20,   value: 675.00 },
  { id: 'CON-003', name: 'Die Lubricant (Graphite)',     category: 'consumables', sku: 'CON-DL-GR',  location: 'Press Bay 1',   qty: 80,   unit: 'kg',  weight: null, status: 'in_stock',  reorder: 30,   value: 1280.00 },
  { id: 'CON-004', name: 'Propane (Furnace Fuel)',       category: 'consumables', sku: 'CON-LP-FU',  location: 'Tank Farm',     qty: 4500, unit: 'L',   weight: null, status: 'in_stock',  reorder: 2000, value: 3150.00 },
  { id: 'CON-005', name: 'Thermocouple Probes (K-Type)', category: 'consumables', sku: 'CON-TC-KT', location: 'Instrument Store', qty: 6,  unit: 'pcs', weight: null, status: 'low_stock', reorder: 10,   value: 540.00 },
  { id: 'CON-006', name: 'Welding Rod E7018 3.2mm',     category: 'consumables', sku: 'CON-WR-18',  location: 'Weld Store',    qty: 150,  unit: 'kg',  weight: null, status: 'in_stock',  reorder: 50,   value: 975.00 },
];

// ---------------------------------------------------------------------------
// Status Config
// ---------------------------------------------------------------------------

var STATUS_CONFIG = {
  in_stock:     { label: 'In Stock',     color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  low_stock:    { label: 'Low Stock',    color: '#e9c46a', bg: 'rgba(233,196,106,0.08)' },
  critical:     { label: 'Critical',     color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
  in_use:       { label: 'In Use',       color: '#00b4d8', bg: 'rgba(0,180,216,0.08)' },
  heating:      { label: 'Heating',      color: '#ff6a00', bg: 'rgba(255,106,0,0.08)' },
  forging:      { label: 'Forging',      color: '#cc3333', bg: 'rgba(204,51,51,0.08)' },
  quenching:    { label: 'Quenching',    color: '#3366cc', bg: 'rgba(51,102,204,0.08)' },
  ready:        { label: 'Ready',        color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  shipping:     { label: 'Shipping',     color: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
  qc_hold:      { label: 'QC Hold',      color: '#e9c46a', bg: 'rgba(233,196,106,0.08)' },
  operational:  { label: 'Operational',  color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  maintenance:  { label: 'Maintenance',  color: '#e9c46a', bg: 'rgba(233,196,106,0.08)' },
};


// ---------------------------------------------------------------------------
// Build DOM
// ---------------------------------------------------------------------------

function buildOverlay() {
  if (overlay) return;
  injectStyles();

  overlay = document.createElement('div');
  overlay.id = 'forgeworks-inventory';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '9999',
    display: 'flex', flexDirection: 'column',
    background: '#060b11',
    overflow: 'hidden',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', 'Monaco', monospace",
    color: '#aabbcc',
  });

  // Background
  var bg = document.createElement('div');
  Object.assign(bg.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
    background:
      'radial-gradient(ellipse 60% 50% at 70% 100%, ' + ACCENT_DIM + '0.04) 0%, transparent 70%),' +
      'radial-gradient(ellipse 50% 40% at 15% 15%, rgba(0,80,100,0.03) 0%, transparent 60%)',
  });
  overlay.appendChild(bg);

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

  // Top bar
  overlay.appendChild(buildTopBar());

  // Main body = sidebar + content
  var body = document.createElement('div');
  Object.assign(body.style, {
    position: 'relative', zIndex: '2',
    flex: '1', display: 'flex',
    overflow: 'hidden',
  });

  body.appendChild(buildSidebar());
  body.appendChild(buildContentArea());

  overlay.appendChild(body);
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
    borderBottom: '1px solid ' + ACCENT_DIM + '0.15)',
    background: 'rgba(4, 8, 14, 0.9)',
    backdropFilter: 'blur(8px)',
  });

  // Back
  var backBtn = document.createElement('button');
  Object.assign(backBtn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px', color: '#667788', cursor: 'pointer',
    padding: '5px 12px', fontSize: '10px', fontFamily: 'inherit',
    letterSpacing: '1px', transition: 'all 0.2s ease',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  backBtn.innerHTML = '<span style="font-size:14px;line-height:1">\u2039</span> MENU';
  backBtn.addEventListener('mouseenter', function() { backBtn.style.borderColor = ACCENT; backBtn.style.color = ACCENT; });
  backBtn.addEventListener('mouseleave', function() { backBtn.style.borderColor = 'rgba(255,255,255,0.1)'; backBtn.style.color = '#667788'; });
  backBtn.addEventListener('click', function() { if (backCallback) backCallback(); });
  bar.appendChild(backBtn);

  // Title
  var title = document.createElement('div');
  Object.assign(title.style, {
    marginLeft: '20px', fontSize: '12px', fontWeight: '600',
    letterSpacing: '3px', textTransform: 'uppercase', color: ACCENT,
  });
  title.textContent = 'General Inventory';
  bar.appendChild(title);

  // Accent line
  var accent = document.createElement('div');
  Object.assign(accent.style, {
    marginLeft: '16px', flex: '1', height: '1px',
    background: 'linear-gradient(90deg, ' + ACCENT_DIM + '0.3), transparent 60%)',
  });
  bar.appendChild(accent);

  // Search
  var searchWrap = document.createElement('div');
  Object.assign(searchWrap.style, {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'rgba(0,8,16,0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', padding: '0 10px',
    transition: 'border-color 0.2s ease',
  });

  var searchIcon = document.createElement('span');
  Object.assign(searchIcon.style, { fontSize: '12px', color: '#445566' });
  searchIcon.textContent = '\u26B2';
  searchWrap.appendChild(searchIcon);

  var searchInput = document.createElement('input');
  searchInput.id = 'inv-search';
  searchInput.placeholder = 'Search inventory...';
  Object.assign(searchInput.style, {
    background: 'none', border: 'none', outline: 'none',
    color: '#8899aa', fontSize: '10px', fontFamily: 'inherit',
    padding: '6px 0', width: '160px',
  });
  searchInput.addEventListener('input', function() {
    searchTerm = searchInput.value.toLowerCase();
    renderTable();
  });
  searchInput.addEventListener('focus', function() { searchWrap.style.borderColor = ACCENT_DIM + '0.4)'; });
  searchInput.addEventListener('blur', function() { searchWrap.style.borderColor = 'rgba(255,255,255,0.08)'; });
  searchWrap.appendChild(searchInput);
  bar.appendChild(searchWrap);

  return bar;
}


// ---------------------------------------------------------------------------
// Sidebar — Category navigation + summary stats
// ---------------------------------------------------------------------------

function buildSidebar() {
  var sidebar = document.createElement('div');
  sidebar.id = 'inv-sidebar';
  Object.assign(sidebar.style, {
    width: '220px', minWidth: '220px',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(4, 8, 14, 0.5)',
    borderRight: '1px solid rgba(255,255,255,0.04)',
    overflowY: 'auto',
  });

  // Category buttons
  var catSection = document.createElement('div');
  catSection.style.padding = '16px 12px 8px';

  var catLabel = document.createElement('div');
  Object.assign(catLabel.style, {
    fontSize: '8px', letterSpacing: '2px', textTransform: 'uppercase',
    color: '#3a4a5a', marginBottom: '8px', paddingLeft: '8px',
  });
  catLabel.textContent = 'Categories';
  catSection.appendChild(catLabel);

  for (var i = 0; i < CATEGORIES.length; i++) {
    (function(cat) {
      var btn = document.createElement('div');
      btn.className = 'inv-cat-btn';
      btn.dataset.key = cat.key;
      Object.assign(btn.style, {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', marginBottom: '2px',
        borderRadius: '3px', cursor: 'pointer',
        border: '1px solid transparent',
        transition: 'all 0.2s ease',
        fontSize: '10px', color: '#667788',
      });

      var icon = document.createElement('span');
      Object.assign(icon.style, { fontSize: '13px', opacity: '0.6', width: '18px', textAlign: 'center' });
      icon.textContent = cat.icon;
      btn.appendChild(icon);

      var label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = cat.label;
      btn.appendChild(label);

      // Count badge
      var count = document.createElement('span');
      count.className = 'inv-cat-count';
      Object.assign(count.style, {
        fontSize: '9px', color: '#445566',
        background: 'rgba(255,255,255,0.03)',
        padding: '1px 6px', borderRadius: '8px',
        minWidth: '20px', textAlign: 'center',
      });
      count.textContent = cat.key === 'all' ? INVENTORY.length : countByCategory(cat.key);
      btn.appendChild(count);

      btn.addEventListener('mouseenter', function() {
        if (activeCategory !== cat.key) {
          btn.style.background = 'rgba(255,255,255,0.02)';
        }
      });
      btn.addEventListener('mouseleave', function() {
        if (activeCategory !== cat.key) {
          btn.style.background = 'none';
        }
      });
      btn.addEventListener('click', function() {
        activeCategory = cat.key;
        updateCategoryButtons();
        renderTable();
        renderStats();
      });

      catSection.appendChild(btn);
    })(CATEGORIES[i]);
  }

  sidebar.appendChild(catSection);

  // Divider
  var div = document.createElement('div');
  Object.assign(div.style, {
    height: '1px', margin: '8px 16px',
    background: 'rgba(255,255,255,0.04)',
  });
  sidebar.appendChild(div);

  // Summary stats
  var statsSection = document.createElement('div');
  statsSection.id = 'inv-sidebar-stats';
  statsSection.style.padding = '8px 12px';
  sidebar.appendChild(statsSection);

  return sidebar;
}


function countByCategory(cat) {
  var c = 0;
  for (var i = 0; i < INVENTORY.length; i++) {
    if (INVENTORY[i].category === cat) c++;
  }
  return c;
}


function updateCategoryButtons() {
  var btns = overlay ? overlay.querySelectorAll('.inv-cat-btn') : [];
  for (var i = 0; i < btns.length; i++) {
    var isActive = btns[i].dataset.key === activeCategory;
    btns[i].style.background = isActive ? ACCENT_DIM + '0.08)' : 'none';
    btns[i].style.borderColor = isActive ? ACCENT_DIM + '0.2)' : 'transparent';
    btns[i].style.color = isActive ? ACCENT : '#667788';
  }
}


function renderStats() {
  var el = document.getElementById('inv-sidebar-stats');
  if (!el) return;
  el.innerHTML = '';

  var filtered = getFilteredItems();
  var totalQty = 0, totalValue = 0, lowCount = 0, critCount = 0;

  for (var i = 0; i < filtered.length; i++) {
    totalQty += filtered[i].qty;
    totalValue += filtered[i].value;
    if (filtered[i].status === 'low_stock') lowCount++;
    if (filtered[i].status === 'critical') critCount++;
  }

  var stats = [
    { label: 'Total Items', value: filtered.length, color: ACCENT },
    { label: 'Total Value', value: '$' + formatNum(totalValue), color: '#8899aa' },
    { label: 'Low Stock', value: lowCount, color: lowCount > 0 ? '#e9c46a' : '#334455' },
    { label: 'Critical', value: critCount, color: critCount > 0 ? '#ef4444' : '#334455' },
  ];

  for (var s = 0; s < stats.length; s++) {
    var row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 8px', marginBottom: '2px',
      borderRadius: '2px',
    });

    var lbl = document.createElement('span');
    Object.assign(lbl.style, {
      fontSize: '9px', color: '#556677', letterSpacing: '0.5px',
    });
    lbl.textContent = stats[s].label;
    row.appendChild(lbl);

    var val = document.createElement('span');
    Object.assign(val.style, {
      fontSize: '11px', fontWeight: '600', color: stats[s].color,
    });
    val.textContent = stats[s].value;
    row.appendChild(val);

    el.appendChild(row);
  }
}


// ---------------------------------------------------------------------------
// Content Area — Stats cards + item table
// ---------------------------------------------------------------------------

function buildContentArea() {
  var content = document.createElement('div');
  content.id = 'inv-content';
  Object.assign(content.style, {
    flex: '1', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  });

  // Top stats row
  var statsRow = document.createElement('div');
  statsRow.id = 'inv-stats-row';
  Object.assign(statsRow.style, {
    display: 'flex', gap: '12px',
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    flexShrink: '0',
  });
  content.appendChild(statsRow);

  // Table area
  var tableWrap = document.createElement('div');
  tableWrap.id = 'inv-table-wrap';
  Object.assign(tableWrap.style, {
    flex: '1', overflowY: 'auto',
    padding: '0 24px 24px',
  });
  content.appendChild(tableWrap);

  return content;
}


function renderTopStats() {
  var el = document.getElementById('inv-stats-row');
  if (!el) return;
  el.innerHTML = '';

  // Compute across ALL inventory (not filtered)
  var catTotals = {};
  var totalValue = 0;
  for (var i = 0; i < INVENTORY.length; i++) {
    var cat = INVENTORY[i].category;
    if (!catTotals[cat]) catTotals[cat] = { count: 0, value: 0 };
    catTotals[cat].count++;
    catTotals[cat].value += INVENTORY[i].value;
    totalValue += INVENTORY[i].value;
  }

  var cards = [
    { label: 'Raw Materials',  value: (catTotals.raw || {}).count || 0,        sub: '$' + formatNum((catTotals.raw || {}).value || 0),        color: '#3399ff' },
    { label: 'Work in Progress', value: (catTotals.wip || {}).count || 0,      sub: '$' + formatNum((catTotals.wip || {}).value || 0),        color: '#ff6a00' },
    { label: 'Finished Goods', value: (catTotals.finished || {}).count || 0,   sub: '$' + formatNum((catTotals.finished || {}).value || 0),   color: '#22c55e' },
    { label: 'Equipment',      value: (catTotals.equipment || {}).count || 0,  sub: '$' + formatNum((catTotals.equipment || {}).value || 0),  color: '#a78bfa' },
    { label: 'Tooling',        value: (catTotals.tooling || {}).count || 0,    sub: '$' + formatNum((catTotals.tooling || {}).value || 0),    color: '#e9c46a' },
    { label: 'Total Value',    value: '$' + formatNum(totalValue),             sub: INVENTORY.length + ' items',                              color: ACCENT },
  ];

  for (var c = 0; c < cards.length; c++) {
    var card = document.createElement('div');
    Object.assign(card.style, {
      flex: '1', padding: '12px 14px',
      background: 'rgba(0,8,16,0.5)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '3px', borderTop: '2px solid ' + cards[c].color + '33',
    });

    var cv = document.createElement('div');
    Object.assign(cv.style, { fontSize: '18px', fontWeight: '300', color: cards[c].color, marginBottom: '2px' });
    cv.textContent = cards[c].value;
    card.appendChild(cv);

    var clbl = document.createElement('div');
    Object.assign(clbl.style, { fontSize: '8px', color: '#556677', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1px' });
    clbl.textContent = cards[c].label;
    card.appendChild(clbl);

    var csub = document.createElement('div');
    Object.assign(csub.style, { fontSize: '9px', color: '#3a4a5a' });
    csub.textContent = cards[c].sub;
    card.appendChild(csub);

    el.appendChild(card);
  }
}


// ---------------------------------------------------------------------------
// Table Rendering
// ---------------------------------------------------------------------------

function getFilteredItems() {
  var items = [];
  for (var i = 0; i < INVENTORY.length; i++) {
    var it = INVENTORY[i];
    if (activeCategory !== 'all' && it.category !== activeCategory) continue;
    if (searchTerm) {
      var hay = (it.id + ' ' + it.name + ' ' + it.sku + ' ' + it.location + ' ' + it.status).toLowerCase();
      if (hay.indexOf(searchTerm) === -1) continue;
    }
    items.push(it);
  }
  return items;
}


function renderTable() {
  var el = document.getElementById('inv-table-wrap');
  if (!el) return;
  el.innerHTML = '';

  var items = getFilteredItems();

  // Header
  var header = document.createElement('div');
  Object.assign(header.style, {
    display: 'grid',
    gridTemplateColumns: '72px 1fr 90px 110px 60px 55px 80px 90px',
    gap: '0', padding: '10px 12px',
    fontSize: '8px', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: '#445566', borderBottom: '1px solid rgba(255,255,255,0.06)',
    position: 'sticky', top: '0', background: '#060b11', zIndex: '1',
  });

  var cols = ['ID', 'Name', 'SKU', 'Location', 'Qty', 'Unit', 'Status', 'Value'];
  for (var c = 0; c < cols.length; c++) {
    var th = document.createElement('div');
    th.textContent = cols[c];
    header.appendChild(th);
  }
  el.appendChild(header);

  if (items.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      padding: '40px', textAlign: 'center',
      fontSize: '11px', color: '#334455',
    });
    empty.textContent = 'No items match the current filter.';
    el.appendChild(empty);
    return;
  }

  // Rows
  for (var r = 0; r < items.length; r++) {
    (function(item) {
      var row = document.createElement('div');
      Object.assign(row.style, {
        display: 'grid',
        gridTemplateColumns: '72px 1fr 90px 110px 60px 55px 80px 90px',
        gap: '0', padding: '9px 12px',
        fontSize: '10px', color: '#778899',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        transition: 'background 0.15s ease',
        cursor: 'default',
      });
      row.addEventListener('mouseenter', function() { row.style.background = 'rgba(255,255,255,0.02)'; });
      row.addEventListener('mouseleave', function() { row.style.background = 'none'; });

      var sts = STATUS_CONFIG[item.status] || { label: item.status, color: '#556677', bg: 'transparent' };

      // Low stock / critical row indicator
      if (item.status === 'critical') {
        row.style.borderLeft = '2px solid #ef444466';
      } else if (item.status === 'low_stock') {
        row.style.borderLeft = '2px solid #e9c46a44';
      }

      // Qty color (warn if below reorder)
      var qtyColor = '#778899';
      if (item.reorder && item.qty <= item.reorder) {
        qtyColor = item.qty <= item.reorder / 2 ? '#ef4444' : '#e9c46a';
      }

      var cells = [
        { html: item.id, style: 'font-weight:600;color:#5a7a8a' },
        { html: item.name },
        { html: item.sku, style: 'color:#556677;font-size:9px' },
        { html: item.location, style: 'color:#5a6a7a' },
        { html: String(item.qty), style: 'font-weight:600;color:' + qtyColor },
        { html: item.unit, style: 'color:#556677' },
        { html: null },  // status badge rendered separately
        { html: '$' + formatNum(item.value) },
      ];

      for (var ci = 0; ci < cells.length; ci++) {
        var cell = document.createElement('div');
        Object.assign(cell.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        if (cells[ci].style) cell.setAttribute('style', cells[ci].style + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap');

        if (ci === 6) {
          // Status badge
          var badge = document.createElement('span');
          Object.assign(badge.style, {
            display: 'inline-block',
            fontSize: '8px', letterSpacing: '0.5px', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: '2px',
            color: sts.color, background: sts.bg,
            border: '1px solid ' + sts.color + '22',
          });
          badge.textContent = sts.label;
          cell.appendChild(badge);
        } else {
          cell.textContent = cells[ci].html;
        }

        row.appendChild(cell);
      }

      // Reorder warning indicator
      if (item.reorder && item.qty <= item.reorder) {
        var reorderNote = document.createElement('div');
        Object.assign(reorderNote.style, {
          gridColumn: '1 / -1',
          fontSize: '8px', color: item.qty <= item.reorder / 2 ? '#ef4444' : '#e9c46a',
          padding: '2px 12px 4px',
          opacity: '0.7',
        });
        reorderNote.textContent = '\u26A0 Below reorder point (' + item.reorder + ' ' + item.unit + ')';
        row.appendChild(reorderNote);
      }

      el.appendChild(row);
    })(items[r]);
  }
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('inv-styles')) return;
  var style = document.createElement('style');
  style.id = 'inv-styles';
  style.textContent =
    '#forgeworks-inventory ::-webkit-scrollbar { width: 6px; }' +
    '#forgeworks-inventory ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }' +
    '#forgeworks-inventory ::-webkit-scrollbar-thumb { background: ' + ACCENT_DIM + '0.2); border-radius: 3px; }' +
    '#forgeworks-inventory ::-webkit-scrollbar-thumb:hover { background: ' + ACCENT_DIM + '0.4); }';
  document.head.appendChild(style);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function show() {
  buildOverlay();
  overlay.style.display = 'flex';
  visible = true;

  activeCategory = 'all';
  searchTerm = '';
  var searchEl = document.getElementById('inv-search');
  if (searchEl) searchEl.value = '';

  updateCategoryButtons();
  renderTopStats();
  renderStats();
  renderTable();
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
