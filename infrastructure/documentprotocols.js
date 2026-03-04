// ============================================================================
// documentprotocols.js — Document Protocols & Archive
// Forgeworks Infrastructure
// ============================================================================
// Full-screen document management portal. Houses all forge documentation:
// machinery manuals, SOPs, forging techniques, safety/compliance records,
// design documents, and scanned legacy archives.
//
// Features:
//   • Categorized document library with search and filtering
//   • Document detail viewer with metadata
//   • Upload area for new documents / scans
//   • AI Assistant panel (Anthropic Claude API) for querying documents
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
var selectedDoc = null;
var chatMessages = [];
var chatBusy = false;

// ---------------------------------------------------------------------------
// Accent
// ---------------------------------------------------------------------------

var ACCENT = '#a8a4ce';
var ACCENT_DIM = 'rgba(168, 164, 206, ';

// ---------------------------------------------------------------------------
// Document Categories
// ---------------------------------------------------------------------------

var CATEGORIES = [
  { key: 'all',          label: 'All Documents',      icon: '\u25A6', count: 0 },
  { key: 'manual',       label: 'Machinery Manuals',  icon: '\u2699', count: 0 },
  { key: 'sop',          label: 'SOPs & Procedures',  icon: '\u2611', count: 0 },
  { key: 'technique',    label: 'Forging Techniques', icon: '\u2692', count: 0 },
  { key: 'safety',       label: 'Safety & Compliance', icon: '\u26A0', count: 0 },
  { key: 'design',       label: 'Design Documents',   icon: '\u25CE', count: 0 },
  { key: 'archive',      label: 'Scanned Archives',   icon: '\u2759', count: 0 },
];

// ---------------------------------------------------------------------------
// Status Config
// ---------------------------------------------------------------------------

var DOC_STATUS = {
  current:    { label: 'Current',     color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  draft:      { label: 'Draft',       color: '#00b4d8', bg: 'rgba(0,180,216,0.08)' },
  review:     { label: 'Under Review', color: '#e9c46a', bg: 'rgba(233,196,106,0.08)' },
  archived:   { label: 'Archived',    color: '#667788', bg: 'rgba(102,119,136,0.08)' },
  superseded: { label: 'Superseded',  color: '#8b5e3c', bg: 'rgba(139,94,60,0.08)' },
  scanned:    { label: 'Scanned',     color: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
};

// ---------------------------------------------------------------------------
// Demo Documents
// ---------------------------------------------------------------------------

var DOCUMENTS = [
  // Machinery Manuals
  { id: 'DOC-001', title: '2000T Hydraulic Press — Operator Manual',            category: 'manual',    status: 'current',    author: 'OEM / Schuler AG',     date: '2022-06-15', rev: 'Rev 4.2', pages: 284, size: '18.6 MB', tags: ['press', 'hydraulic', 'operation'], summary: 'Complete operator manual covering setup, daily operation, safety interlocks, troubleshooting, and emergency procedures for the Schuler 2000T hydraulic forging press.' },
  { id: 'DOC-002', title: 'Gas Forge Furnace #1 & #2 — Service Manual',        category: 'manual',    status: 'current',    author: 'OEM / Ajax-CECO',      date: '2021-03-20', rev: 'Rev 3.0', pages: 196, size: '12.4 MB', tags: ['furnace', 'gas', 'service', 'burner'], summary: 'Service and maintenance manual for Ajax-CECO gas-fired forge furnaces. Covers burner tuning, refractory inspection, thermocouple replacement, and control system configuration.' },
  { id: 'DOC-003', title: 'Power Hammer 500kg — Technical Reference',           category: 'manual',    status: 'current',    author: 'OEM / Massey',         date: '2019-11-01', rev: 'Rev 2.1', pages: 148, size: '8.2 MB',  tags: ['hammer', 'power', 'technical'], summary: 'Technical reference for the Massey 500kg power hammer including foundation requirements, die specifications, stroke calibration, and parts catalog.' },
  { id: 'DOC-004', title: 'Oil Quench Tank 5000L — Installation & Operation',   category: 'manual',    status: 'current',    author: 'OEM / Ipsen',          date: '2023-01-10', rev: 'Rev 1.3', pages: 92,  size: '5.8 MB',  tags: ['quench', 'oil', 'tank', 'cooling'], summary: 'Installation guide and operating procedures for the Ipsen 5000L oil quench system. Includes agitator setup, oil selection guide, temperature control, and fire suppression integration.' },
  { id: 'DOC-005', title: '5T Bridge Crane — Inspection & Certification Log',   category: 'manual',    status: 'current',    author: 'OEM / Konecranes',     date: '2024-04-22', rev: 'Rev 5.0', pages: 64,  size: '3.1 MB',  tags: ['crane', 'bridge', 'inspection', 'certification'], summary: 'Annual inspection logbook and certification records for the Konecranes 5T overhead bridge crane. Includes wire rope inspection schedule, load test records, and compliance documentation.' },

  // SOPs & Procedures
  { id: 'DOC-010', title: 'SOP-001: Open Die Forging — Standard Procedure',     category: 'sop',       status: 'current',    author: 'R. Chen',              date: '2025-08-12', rev: 'Rev 6.1', pages: 24,  size: '1.2 MB',  tags: ['forging', 'open die', 'procedure'], summary: 'Standard operating procedure for open die forging operations. Covers billet heating protocol, press setup, operator positioning, deformation sequence, and post-forge inspection requirements.' },
  { id: 'DOC-011', title: 'SOP-002: Closed Die Forging — Setup & Operation',    category: 'sop',       status: 'current',    author: 'R. Chen',              date: '2025-09-03', rev: 'Rev 4.0', pages: 32,  size: '2.1 MB',  tags: ['forging', 'closed die', 'setup'], summary: 'Die installation, alignment verification, pre-heat protocol, forging cycle parameters, and flash trimming procedure for closed die operations.' },
  { id: 'DOC-012', title: 'SOP-003: Heat Treatment — Quench & Temper',          category: 'sop',       status: 'current',    author: 'A. Petrov',            date: '2025-07-18', rev: 'Rev 5.2', pages: 18,  size: '0.9 MB',  tags: ['heat treatment', 'quench', 'temper'], summary: 'Quench and temper procedure for alloy steels. Austenitizing temperatures by grade, quench media selection, temper curves, hardness verification, and documentation requirements.' },
  { id: 'DOC-013', title: 'SOP-004: Furnace Startup & Shutdown Sequence',       category: 'sop',       status: 'review',     author: 'J. Martinez',          date: '2026-01-20', rev: 'Rev 3.1 DRAFT', pages: 12, size: '0.6 MB', tags: ['furnace', 'startup', 'shutdown', 'safety'], summary: 'Step-by-step furnace ignition and controlled shutdown procedures. Gas valve sequence, pilot verification, ramp rates, and emergency shutdown protocol.' },
  { id: 'DOC-014', title: 'SOP-005: Material Receiving & Inspection',            category: 'sop',       status: 'current',    author: 'S. Okafor',            date: '2025-05-30', rev: 'Rev 2.0', pages: 16,  size: '0.8 MB',  tags: ['receiving', 'inspection', 'material', 'quality'], summary: 'Incoming material inspection protocol. Cert verification, dimensional checks, surface inspection criteria, storage assignment, and traceability tagging procedure.' },

  // Forging Techniques
  { id: 'DOC-020', title: 'Upset Forging of Large Flanges — Process Guide',     category: 'technique', status: 'current',    author: 'R. Chen',              date: '2024-11-08', rev: 'Rev 2.3', pages: 38,  size: '4.5 MB',  tags: ['upset', 'flange', 'technique'], summary: 'Detailed process guide for upset forging large diameter flanges. Includes die design rationale, heating schedules by alloy, upset ratios, grain flow optimization, and defect prevention strategies.' },
  { id: 'DOC-021', title: 'Ring Rolling — Mandrel Selection & Setup',           category: 'technique', status: 'current',    author: 'A. Petrov',            date: '2025-02-14', rev: 'Rev 1.1', pages: 28,  size: '3.2 MB',  tags: ['ring', 'rolling', 'mandrel'], summary: 'Guide to mandrel selection based on ring geometry, material flow analysis, roll gap calculations, and common defects in ring rolling operations.' },
  { id: 'DOC-022', title: 'Grain Flow Control in Crankshaft Forgings',          category: 'technique', status: 'current',    author: 'R. Chen',              date: '2023-09-22', rev: 'Rev 3.0', pages: 44,  size: '6.8 MB',  tags: ['grain flow', 'crankshaft', 'microstructure'], summary: 'Technical paper on controlling grain flow direction in multi-throw crankshaft forgings. FEA simulation results, die geometry influence, and metallographic validation data.' },
  { id: 'DOC-023', title: 'Die Life Extension — Surface Treatments & Coatings', category: 'technique', status: 'draft',      author: 'J. Martinez',          date: '2026-02-01', rev: 'DRAFT',   pages: 22,  size: '1.8 MB',  tags: ['die', 'surface treatment', 'coating', 'wear'], summary: 'Investigation of nitriding, PVD coatings, and weld overlay techniques for extending closed-die service life. Includes comparative wear data from recent production runs.' },

  // Safety & Compliance
  { id: 'DOC-030', title: 'Forge Floor Safety Manual',                           category: 'safety',    status: 'current',    author: 'Safety Dept.',         date: '2025-12-01', rev: 'Rev 8.0', pages: 86,  size: '5.4 MB',  tags: ['safety', 'PPE', 'hazard', 'floor'], summary: 'Comprehensive safety manual for all forge floor personnel. PPE requirements, hot work zones, crane signal protocols, lockout/tagout procedures, and emergency evacuation routes.' },
  { id: 'DOC-031', title: 'OSHA Compliance Checklist — Annual Review 2025',     category: 'safety',    status: 'current',    author: 'Safety Dept.',         date: '2025-12-15', rev: '2025',    pages: 28,  size: '1.6 MB',  tags: ['OSHA', 'compliance', 'audit', 'checklist'], summary: 'Annual OSHA compliance self-audit checklist covering noise exposure, heat stress, machine guarding, electrical safety, confined spaces, and record-keeping requirements.' },
  { id: 'DOC-032', title: 'Hazardous Materials Handling — Quench Oils & Gases', category: 'safety',    status: 'current',    author: 'Safety Dept.',         date: '2024-08-10', rev: 'Rev 3.2', pages: 34,  size: '2.0 MB',  tags: ['hazmat', 'quench oil', 'propane', 'SDS'], summary: 'Handling, storage, and spill response procedures for quench oils, propane, lubricants, and chemical cleaning agents. Includes all Safety Data Sheets.' },
  { id: 'DOC-033', title: 'Fire Prevention & Suppression Plan',                  category: 'safety',    status: 'review',     author: 'Safety Dept.',         date: '2026-02-18', rev: 'Rev 4.0 DRAFT', pages: 42, size: '3.3 MB', tags: ['fire', 'prevention', 'suppression', 'emergency'], summary: 'Updated fire prevention plan including new quench bay deluge system, furnace area sprinkler zones, fire extinguisher map, and annual drill schedule.' },

  // Design Documents
  { id: 'DOC-040', title: 'Crankshaft Forging Die — Design Package',            category: 'design',    status: 'current',    author: 'Engineering',          date: '2025-04-10', rev: 'Rev B',   pages: 18,  size: '14.2 MB', tags: ['die', 'crankshaft', 'CAD', 'drawing'], summary: 'Complete die design package for 4140 crankshaft closed-die forging. Includes 3D CAD files, 2D drawings, BOM, shrink-fit calculations, and FEA thermal analysis.' },
  { id: 'DOC-041', title: 'New Press Foundation — Structural Drawings',          category: 'design',    status: 'draft',      author: 'Engineering',          date: '2026-01-05', rev: 'DRAFT A', pages: 8,   size: '6.8 MB',  tags: ['foundation', 'structural', 'press', 'civil'], summary: 'Preliminary structural drawings for the proposed 3000T press foundation. Reinforcement schedule, vibration isolation details, and anchor bolt layout.' },
  { id: 'DOC-042', title: 'Forge Layout — Current Floor Plan (2026)',            category: 'design',    status: 'current',    author: 'Engineering',          date: '2026-02-20', rev: 'Rev 12',  pages: 4,   size: '2.4 MB',  tags: ['layout', 'floor plan', 'facility'], summary: 'Current master floor plan showing all equipment positions, zone designations, material flow paths, utility runs, and crane coverage areas.' },

  // Scanned Archives
  { id: 'DOC-050', title: '[SCAN] Original Forge Building Plans (1968)',         category: 'archive',   status: 'scanned',    author: 'Unknown / Archived',   date: '1968-03-01', rev: 'Original', pages: 14, size: '42.0 MB', tags: ['building', 'original', 'historical', 'scan'], summary: 'High-resolution scans of the original forge building architectural plans from 1968. Includes structural drawings, electrical layout, and drainage plans. Some sheets partially damaged.' },
  { id: 'DOC-051', title: '[SCAN] Massey Hammer Installation Notes (1972)',      category: 'archive',   status: 'scanned',    author: 'J. Coulter Sr.',       date: '1972-07-15', rev: 'Original', pages: 6,  size: '8.4 MB',  tags: ['hammer', 'installation', 'historical', 'scan'], summary: 'Handwritten installation notes and sketches from the original Massey power hammer installation. Includes foundation depth measurements and leveling data.' },
  { id: 'DOC-052', title: '[SCAN] Heat Treatment Records (1985–1990)',           category: 'archive',   status: 'scanned',    author: 'Various',              date: '1990-12-31', rev: 'Compiled', pages: 220, size: '86.0 MB', tags: ['heat treatment', 'records', 'historical', 'scan'], summary: 'Compiled scans of handwritten heat treatment log sheets from 1985 through 1990. Covers furnace temperatures, soak times, quench media, and hardness results for production runs.' },
  { id: 'DOC-053', title: '[SCAN] Forge Process Manual — Coulter & Sons (1975)', category: 'archive',  status: 'scanned',    author: 'Coulter & Sons',       date: '1975-01-01', rev: 'Original', pages: 88, size: '34.0 MB', tags: ['process', 'manual', 'historical', 'scan', 'coulter'], summary: 'The original Coulter & Sons forge process manual. Handwritten and typed sections covering material selection, heating guidelines, die design rules of thumb, and quality inspection methods from the early era of the forge.' },
  { id: 'DOC-054', title: '[SCAN] Equipment Purchase Invoices (1968–1980)',      category: 'archive',   status: 'scanned',    author: 'Accounting / Archived', date: '1980-12-31', rev: 'Compiled', pages: 42, size: '12.6 MB', tags: ['invoices', 'purchase', 'historical', 'scan'], summary: 'Scanned purchase invoices and delivery receipts for major forge equipment acquired between 1968 and 1980. Useful for tracking original equipment specifications and vendors.' },
];


// ---------------------------------------------------------------------------
// Build DOM
// ---------------------------------------------------------------------------

function buildOverlay() {
  if (overlay) return;
  injectStyles();

  overlay = document.createElement('div');
  overlay.id = 'forgeworks-documents';
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
      'radial-gradient(ellipse 60% 50% at 20% 100%, ' + ACCENT_DIM + '0.04) 0%, transparent 70%),' +
      'radial-gradient(ellipse 50% 40% at 85% 15%, rgba(80,60,120,0.03) 0%, transparent 60%)',
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

  overlay.appendChild(buildTopBar());

  // Body = sidebar + library + AI panel
  var body = document.createElement('div');
  Object.assign(body.style, {
    position: 'relative', zIndex: '2',
    flex: '1', display: 'flex',
    overflow: 'hidden',
  });

  body.appendChild(buildSidebar());
  body.appendChild(buildLibrary());
  body.appendChild(buildAIPanel());

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
  title.textContent = 'Document Protocols';
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
  searchInput.id = 'doc-search';
  searchInput.placeholder = 'Search documents, tags...';
  Object.assign(searchInput.style, {
    background: 'none', border: 'none', outline: 'none',
    color: '#8899aa', fontSize: '10px', fontFamily: 'inherit',
    padding: '6px 0', width: '180px',
  });
  searchInput.addEventListener('input', function() {
    searchTerm = searchInput.value.toLowerCase();
    renderDocumentList();
  });
  searchInput.addEventListener('focus', function() { searchWrap.style.borderColor = ACCENT_DIM + '0.4)'; });
  searchInput.addEventListener('blur', function() { searchWrap.style.borderColor = 'rgba(255,255,255,0.08)'; });
  searchWrap.appendChild(searchInput);
  bar.appendChild(searchWrap);

  // Upload button
  var uploadBtn = document.createElement('button');
  Object.assign(uploadBtn.style, {
    marginLeft: '10px',
    background: 'none', border: '1px solid ' + ACCENT_DIM + '0.25)',
    borderRadius: '3px', color: ACCENT, cursor: 'pointer',
    padding: '5px 14px', fontSize: '9px', fontFamily: 'inherit',
    letterSpacing: '1px', textTransform: 'uppercase',
    transition: 'all 0.2s ease',
  });
  uploadBtn.textContent = '+ Upload';
  uploadBtn.addEventListener('mouseenter', function() {
    uploadBtn.style.borderColor = ACCENT;
    uploadBtn.style.background = ACCENT_DIM + '0.08)';
  });
  uploadBtn.addEventListener('mouseleave', function() {
    uploadBtn.style.borderColor = ACCENT_DIM + '0.25)';
    uploadBtn.style.background = 'none';
  });
  uploadBtn.addEventListener('click', function() { showUploadModal(); });
  bar.appendChild(uploadBtn);

  return bar;
}


// ---------------------------------------------------------------------------
// Sidebar — Categories + Stats
// ---------------------------------------------------------------------------

function buildSidebar() {
  var sidebar = document.createElement('div');
  sidebar.id = 'doc-sidebar';
  Object.assign(sidebar.style, {
    width: '200px', minWidth: '200px',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(4, 8, 14, 0.5)',
    borderRight: '1px solid rgba(255,255,255,0.04)',
    overflowY: 'auto',
  });

  // Category buttons
  var catSection = document.createElement('div');
  catSection.style.padding = '16px 10px 8px';

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
      btn.className = 'doc-cat-btn';
      btn.dataset.key = cat.key;
      Object.assign(btn.style, {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '7px 10px', marginBottom: '2px',
        borderRadius: '3px', cursor: 'pointer',
        border: '1px solid transparent',
        transition: 'all 0.2s ease',
        fontSize: '10px', color: '#667788',
      });

      var icon = document.createElement('span');
      Object.assign(icon.style, { fontSize: '12px', opacity: '0.6', width: '16px', textAlign: 'center' });
      icon.textContent = cat.icon;
      btn.appendChild(icon);

      var label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = cat.label;
      btn.appendChild(label);

      var count = document.createElement('span');
      count.className = 'doc-cat-count';
      Object.assign(count.style, {
        fontSize: '9px', color: '#445566',
        background: 'rgba(255,255,255,0.03)',
        padding: '1px 5px', borderRadius: '8px',
        minWidth: '18px', textAlign: 'center',
      });
      var c = cat.key === 'all' ? DOCUMENTS.length : countByCat(cat.key);
      count.textContent = c;
      btn.appendChild(count);

      btn.addEventListener('mouseenter', function() {
        if (activeCategory !== cat.key) btn.style.background = 'rgba(255,255,255,0.02)';
      });
      btn.addEventListener('mouseleave', function() {
        if (activeCategory !== cat.key) btn.style.background = 'none';
      });
      btn.addEventListener('click', function() {
        activeCategory = cat.key;
        updateCategoryButtons();
        renderDocumentList();
      });

      catSection.appendChild(btn);
    })(CATEGORIES[i]);
  }

  sidebar.appendChild(catSection);

  // Divider
  var div = document.createElement('div');
  Object.assign(div.style, { height: '1px', margin: '8px 14px', background: 'rgba(255,255,255,0.04)' });
  sidebar.appendChild(div);

  // Stats
  var stats = document.createElement('div');
  stats.id = 'doc-sidebar-stats';
  stats.style.padding = '8px 10px';
  sidebar.appendChild(stats);

  return sidebar;
}

function countByCat(cat) {
  var c = 0;
  for (var i = 0; i < DOCUMENTS.length; i++) {
    if (DOCUMENTS[i].category === cat) c++;
  }
  return c;
}

function updateCategoryButtons() {
  var btns = overlay ? overlay.querySelectorAll('.doc-cat-btn') : [];
  for (var i = 0; i < btns.length; i++) {
    var isActive = btns[i].dataset.key === activeCategory;
    btns[i].style.background = isActive ? ACCENT_DIM + '0.08)' : 'none';
    btns[i].style.borderColor = isActive ? ACCENT_DIM + '0.2)' : 'transparent';
    btns[i].style.color = isActive ? ACCENT : '#667788';
  }
}

function renderSidebarStats() {
  var el = document.getElementById('doc-sidebar-stats');
  if (!el) return;
  el.innerHTML = '';

  var totalPages = 0, totalSize = 0, currentCount = 0, draftCount = 0;
  for (var i = 0; i < DOCUMENTS.length; i++) {
    totalPages += DOCUMENTS[i].pages;
    totalSize += parseSize(DOCUMENTS[i].size);
    if (DOCUMENTS[i].status === 'current') currentCount++;
    if (DOCUMENTS[i].status === 'draft' || DOCUMENTS[i].status === 'review') draftCount++;
  }

  var items = [
    { label: 'Total Docs', value: DOCUMENTS.length, color: ACCENT },
    { label: 'Total Pages', value: formatNum(totalPages), color: '#8899aa' },
    { label: 'Total Size', value: formatSize(totalSize), color: '#8899aa' },
    { label: 'Current', value: currentCount, color: '#22c55e' },
    { label: 'Drafts / Review', value: draftCount, color: '#e9c46a' },
  ];

  for (var s = 0; s < items.length; s++) {
    var row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 8px', marginBottom: '1px',
    });
    var lbl = document.createElement('span');
    Object.assign(lbl.style, { fontSize: '9px', color: '#556677' });
    lbl.textContent = items[s].label;
    row.appendChild(lbl);
    var val = document.createElement('span');
    Object.assign(val.style, { fontSize: '10px', fontWeight: '600', color: items[s].color });
    val.textContent = items[s].value;
    row.appendChild(val);
    el.appendChild(row);
  }
}


// ---------------------------------------------------------------------------
// Library — Document List + Detail
// ---------------------------------------------------------------------------

function buildLibrary() {
  var lib = document.createElement('div');
  lib.id = 'doc-library';
  Object.assign(lib.style, {
    flex: '1', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    borderRight: '1px solid rgba(255,255,255,0.04)',
  });

  // Document list (upper)
  var listWrap = document.createElement('div');
  listWrap.id = 'doc-list-wrap';
  Object.assign(listWrap.style, {
    flex: '1', overflowY: 'auto',
    padding: '12px 16px',
  });
  lib.appendChild(listWrap);

  // Detail panel (lower, collapsible)
  var detail = document.createElement('div');
  detail.id = 'doc-detail-panel';
  Object.assign(detail.style, {
    height: '0', overflow: 'hidden',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    transition: 'height 0.3s ease',
    background: 'rgba(4, 8, 14, 0.5)',
  });
  lib.appendChild(detail);

  return lib;
}


function getFilteredDocs() {
  var docs = [];
  for (var i = 0; i < DOCUMENTS.length; i++) {
    var doc = DOCUMENTS[i];
    if (activeCategory !== 'all' && doc.category !== activeCategory) continue;
    if (searchTerm) {
      var hay = (doc.id + ' ' + doc.title + ' ' + doc.author + ' ' + doc.tags.join(' ') + ' ' + doc.status).toLowerCase();
      if (hay.indexOf(searchTerm) === -1) continue;
    }
    docs.push(doc);
  }
  return docs;
}


function renderDocumentList() {
  var el = document.getElementById('doc-list-wrap');
  if (!el) return;
  el.innerHTML = '';

  var docs = getFilteredDocs();

  if (docs.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, { padding: '40px', textAlign: 'center', fontSize: '11px', color: '#334455' });
    empty.textContent = 'No documents match the current filter.';
    el.appendChild(empty);
    return;
  }

  for (var i = 0; i < docs.length; i++) {
    (function(doc) {
      var card = document.createElement('div');
      var isSelected = selectedDoc && selectedDoc.id === doc.id;
      Object.assign(card.style, {
        padding: '12px 14px',
        marginBottom: '6px',
        borderRadius: '3px',
        border: '1px solid ' + (isSelected ? ACCENT_DIM + '0.3)' : 'rgba(255,255,255,0.04)'),
        background: isSelected ? ACCENT_DIM + '0.05)' : 'rgba(0,8,16,0.4)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      });

      card.addEventListener('mouseenter', function() {
        if (!isSelected) {
          card.style.borderColor = ACCENT_DIM + '0.15)';
          card.style.background = 'rgba(0,8,16,0.6)';
        }
      });
      card.addEventListener('mouseleave', function() {
        if (!isSelected) {
          card.style.borderColor = 'rgba(255,255,255,0.04)';
          card.style.background = 'rgba(0,8,16,0.4)';
        }
      });
      card.addEventListener('click', function() {
        selectedDoc = doc;
        renderDocumentList();
        renderDetail();
      });

      // Top row: title + status
      var topRow = document.createElement('div');
      Object.assign(topRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '4px' });

      var titleEl = document.createElement('div');
      Object.assign(titleEl.style, { fontSize: '11px', fontWeight: '600', color: '#b0bec5', flex: '1', lineHeight: '1.3' });
      titleEl.textContent = doc.title;
      topRow.appendChild(titleEl);

      var sts = DOC_STATUS[doc.status] || DOC_STATUS.current;
      var stsBadge = document.createElement('span');
      Object.assign(stsBadge.style, {
        fontSize: '7px', letterSpacing: '0.5px', textTransform: 'uppercase',
        padding: '2px 6px', borderRadius: '2px', flexShrink: '0',
        color: sts.color, background: sts.bg,
        border: '1px solid ' + sts.color + '22',
      });
      stsBadge.textContent = sts.label;
      topRow.appendChild(stsBadge);
      card.appendChild(topRow);

      // Meta row
      var meta = document.createElement('div');
      Object.assign(meta.style, {
        display: 'flex', gap: '12px', flexWrap: 'wrap',
        fontSize: '9px', color: '#556677',
      });

      var metaItems = [doc.id, doc.rev, doc.author, doc.pages + ' pg', doc.size, doc.date];
      for (var m = 0; m < metaItems.length; m++) {
        var span = document.createElement('span');
        span.textContent = metaItems[m];
        if (m === 0) span.style.color = '#5a7a8a';
        meta.appendChild(span);
        if (m < metaItems.length - 1) {
          var sep = document.createElement('span');
          sep.style.color = '#2a3a4a';
          sep.textContent = '\u00B7';
          meta.appendChild(sep);
        }
      }
      card.appendChild(meta);

      // Tags
      if (doc.tags.length > 0) {
        var tagRow = document.createElement('div');
        Object.assign(tagRow.style, { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' });
        for (var t = 0; t < doc.tags.length; t++) {
          var tag = document.createElement('span');
          Object.assign(tag.style, {
            fontSize: '8px', padding: '1px 6px', borderRadius: '2px',
            background: 'rgba(255,255,255,0.03)',
            color: '#556677', border: '1px solid rgba(255,255,255,0.04)',
          });
          tag.textContent = doc.tags[t];
          tagRow.appendChild(tag);
        }
        card.appendChild(tagRow);
      }

      el.appendChild(card);
    })(docs[i]);
  }
}


function renderDetail() {
  var panel = document.getElementById('doc-detail-panel');
  if (!panel) return;

  if (!selectedDoc) {
    panel.style.height = '0';
    return;
  }

  panel.innerHTML = '';
  panel.style.height = '200px';

  var wrap = document.createElement('div');
  Object.assign(wrap.style, { padding: '14px 16px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' });

  // Header
  var header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '10px', paddingBottom: '8px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  });

  var headerTitle = document.createElement('div');
  Object.assign(headerTitle.style, { fontSize: '11px', fontWeight: '600', color: ACCENT });
  headerTitle.textContent = selectedDoc.title;
  header.appendChild(headerTitle);

  // Ask AI button
  var askBtn = document.createElement('button');
  Object.assign(askBtn.style, {
    background: 'none', border: '1px solid ' + ACCENT_DIM + '0.3)',
    borderRadius: '3px', color: ACCENT, cursor: 'pointer',
    padding: '3px 10px', fontSize: '8px', fontFamily: 'inherit',
    letterSpacing: '1px', textTransform: 'uppercase',
    transition: 'all 0.2s ease',
  });
  askBtn.textContent = '\u2728 Ask AI';
  askBtn.addEventListener('mouseenter', function() { askBtn.style.background = ACCENT_DIM + '0.1)'; });
  askBtn.addEventListener('mouseleave', function() { askBtn.style.background = 'none'; });
  askBtn.addEventListener('click', function() {
    var chatInput = document.getElementById('doc-chat-input');
    if (chatInput) {
      chatInput.value = 'Tell me about ' + selectedDoc.title;
      chatInput.focus();
    }
  });
  header.appendChild(askBtn);
  wrap.appendChild(header);

  // Summary
  var summary = document.createElement('div');
  Object.assign(summary.style, { fontSize: '10px', color: '#778899', lineHeight: '1.6', marginBottom: '10px' });
  summary.textContent = selectedDoc.summary;
  wrap.appendChild(summary);

  // Details grid
  var grid = document.createElement('div');
  Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px 16px' });

  var details = [
    { label: 'Document ID', value: selectedDoc.id },
    { label: 'Revision', value: selectedDoc.rev },
    { label: 'Author', value: selectedDoc.author },
    { label: 'Date', value: selectedDoc.date },
    { label: 'Pages', value: selectedDoc.pages },
    { label: 'File Size', value: selectedDoc.size },
  ];

  for (var d = 0; d < details.length; d++) {
    var item = document.createElement('div');
    var lbl = document.createElement('span');
    Object.assign(lbl.style, { fontSize: '8px', color: '#445566', letterSpacing: '0.5px', textTransform: 'uppercase' });
    lbl.textContent = details[d].label + ': ';
    item.appendChild(lbl);
    var val = document.createElement('span');
    Object.assign(val.style, { fontSize: '10px', color: '#8899aa' });
    val.textContent = details[d].value;
    item.appendChild(val);
    grid.appendChild(item);
  }

  wrap.appendChild(grid);
  panel.appendChild(wrap);
}


// ---------------------------------------------------------------------------
// Upload Modal (simple)
// ---------------------------------------------------------------------------

function showUploadModal() {
  var existing = document.getElementById('doc-upload-modal');
  if (existing) { existing.remove(); return; }

  var modal = document.createElement('div');
  modal.id = 'doc-upload-modal';
  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '10001',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
  });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

  var box = document.createElement('div');
  Object.assign(box.style, {
    width: '420px', padding: '28px',
    background: '#0a1018', border: '1px solid ' + ACCENT_DIM + '0.2)',
    borderRadius: '6px', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
  });

  var title = document.createElement('div');
  Object.assign(title.style, {
    fontSize: '12px', fontWeight: '600', letterSpacing: '2px',
    textTransform: 'uppercase', color: ACCENT, marginBottom: '20px',
  });
  title.textContent = 'Upload Document';
  box.appendChild(title);

  // Drop zone
  var dropZone = document.createElement('div');
  Object.assign(dropZone.style, {
    border: '2px dashed ' + ACCENT_DIM + '0.2)',
    borderRadius: '4px', padding: '32px',
    textAlign: 'center', cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginBottom: '16px',
  });
  dropZone.addEventListener('mouseenter', function() {
    dropZone.style.borderColor = ACCENT_DIM + '0.5)';
    dropZone.style.background = ACCENT_DIM + '0.03)';
  });
  dropZone.addEventListener('mouseleave', function() {
    dropZone.style.borderColor = ACCENT_DIM + '0.2)';
    dropZone.style.background = 'none';
  });

  var dropIcon = document.createElement('div');
  Object.assign(dropIcon.style, { fontSize: '28px', color: '#445566', marginBottom: '8px' });
  dropIcon.textContent = '\u21E7';
  dropZone.appendChild(dropIcon);

  var dropText = document.createElement('div');
  Object.assign(dropText.style, { fontSize: '10px', color: '#667788', marginBottom: '4px' });
  dropText.textContent = 'Drop files here or click to browse';
  dropZone.appendChild(dropText);

  var dropSub = document.createElement('div');
  Object.assign(dropSub.style, { fontSize: '9px', color: '#445566' });
  dropSub.textContent = 'PDF, DOCX, DWG, STEP, images up to 100MB';
  dropZone.appendChild(dropSub);

  dropZone.addEventListener('click', function() {
    dropText.textContent = 'Upload functionality coming soon';
    dropText.style.color = ACCENT;
    setTimeout(function() {
      dropText.textContent = 'Drop files here or click to browse';
      dropText.style.color = '#667788';
    }, 2000);
  });

  box.appendChild(dropZone);

  // Close button
  var closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, {
    width: '100%', padding: '8px',
    background: 'none', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', color: '#667788', cursor: 'pointer',
    fontSize: '10px', fontFamily: 'inherit', letterSpacing: '1px',
    transition: 'all 0.2s ease',
  });
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('mouseenter', function() { closeBtn.style.borderColor = ACCENT; closeBtn.style.color = ACCENT; });
  closeBtn.addEventListener('mouseleave', function() { closeBtn.style.borderColor = 'rgba(255,255,255,0.08)'; closeBtn.style.color = '#667788'; });
  closeBtn.addEventListener('click', function() { modal.remove(); });
  box.appendChild(closeBtn);

  modal.appendChild(box);
  document.body.appendChild(modal);
}


// ---------------------------------------------------------------------------
// AI Assistant Panel
// ---------------------------------------------------------------------------

function buildAIPanel() {
  var panel = document.createElement('div');
  panel.id = 'doc-ai-panel';
  Object.assign(panel.style, {
    width: '340px', minWidth: '340px',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(4, 8, 14, 0.5)',
    borderLeft: '1px solid rgba(255,255,255,0.04)',
  });

  // Header
  var header = document.createElement('div');
  Object.assign(header.style, {
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    display: 'flex', alignItems: 'center', gap: '10px',
  });

  var aiDot = document.createElement('div');
  Object.assign(aiDot.style, {
    width: '8px', height: '8px', borderRadius: '50%',
    background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
    boxShadow: '0 0 8px rgba(167,139,250,0.4)',
    animation: 'doc-ai-pulse 2s ease-in-out infinite',
  });
  header.appendChild(aiDot);

  var aiTitle = document.createElement('div');
  Object.assign(aiTitle.style, {
    fontSize: '10px', fontWeight: '600', letterSpacing: '2px',
    textTransform: 'uppercase', color: '#a78bfa',
  });
  aiTitle.textContent = 'Forge AI Assistant';
  header.appendChild(aiTitle);

  var aiBeta = document.createElement('span');
  Object.assign(aiBeta.style, {
    fontSize: '7px', letterSpacing: '1px', textTransform: 'uppercase',
    padding: '1px 5px', borderRadius: '2px', marginLeft: 'auto',
    color: '#818cf8', background: 'rgba(129,140,248,0.1)',
    border: '1px solid rgba(129,140,248,0.15)',
  });
  aiBeta.textContent = 'Beta';
  header.appendChild(aiBeta);

  panel.appendChild(header);

  // Chat messages area
  var chatArea = document.createElement('div');
  chatArea.id = 'doc-chat-area';
  Object.assign(chatArea.style, {
    flex: '1', overflowY: 'auto', padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  });
  panel.appendChild(chatArea);

  // Input area
  var inputArea = document.createElement('div');
  Object.assign(inputArea.style, {
    padding: '12px 14px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
  });

  var inputRow = document.createElement('div');
  Object.assign(inputRow.style, {
    display: 'flex', gap: '8px', alignItems: 'flex-end',
  });

  var chatInput = document.createElement('textarea');
  chatInput.id = 'doc-chat-input';
  chatInput.placeholder = 'Ask about any forge document...';
  chatInput.rows = 2;
  Object.assign(chatInput.style, {
    flex: '1', resize: 'none',
    background: 'rgba(0,8,16,0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', color: '#aabbcc',
    fontSize: '10px', fontFamily: 'inherit',
    padding: '8px 10px', outline: 'none',
    transition: 'border-color 0.2s ease',
    lineHeight: '1.5',
  });
  chatInput.addEventListener('focus', function() { chatInput.style.borderColor = 'rgba(167,139,250,0.3)'; });
  chatInput.addEventListener('blur', function() { chatInput.style.borderColor = 'rgba(255,255,255,0.08)'; });
  chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputRow.appendChild(chatInput);

  var sendBtn = document.createElement('button');
  Object.assign(sendBtn.style, {
    background: 'linear-gradient(135deg, rgba(167,139,250,0.15), rgba(129,140,248,0.08))',
    border: '1px solid rgba(167,139,250,0.3)',
    borderRadius: '3px', color: '#a78bfa', cursor: 'pointer',
    padding: '8px 14px', fontSize: '10px', fontFamily: 'inherit',
    letterSpacing: '1px', transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
  });
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('mouseenter', function() {
    sendBtn.style.background = 'linear-gradient(135deg, rgba(167,139,250,0.25), rgba(129,140,248,0.15))';
  });
  sendBtn.addEventListener('mouseleave', function() {
    sendBtn.style.background = 'linear-gradient(135deg, rgba(167,139,250,0.15), rgba(129,140,248,0.08))';
  });
  sendBtn.addEventListener('click', sendMessage);
  inputRow.appendChild(sendBtn);

  inputArea.appendChild(inputRow);

  // Context note
  var contextNote = document.createElement('div');
  Object.assign(contextNote.style, {
    fontSize: '8px', color: '#445566', marginTop: '6px',
    letterSpacing: '0.3px',
  });
  contextNote.textContent = 'AI has access to all document metadata and summaries. Press Enter to send.';
  inputArea.appendChild(contextNote);

  panel.appendChild(inputArea);

  return panel;
}


function renderWelcomeMessage() {
  var chatArea = document.getElementById('doc-chat-area');
  if (!chatArea) return;
  chatArea.innerHTML = '';

  var welcome = document.createElement('div');
  Object.assign(welcome.style, {
    padding: '16px',
    background: 'rgba(167,139,250,0.04)',
    border: '1px solid rgba(167,139,250,0.1)',
    borderRadius: '4px',
  });

  var wTitle = document.createElement('div');
  Object.assign(wTitle.style, {
    fontSize: '11px', fontWeight: '600', color: '#a78bfa',
    marginBottom: '8px',
  });
  wTitle.textContent = 'Forge Document AI';
  welcome.appendChild(wTitle);

  var wText = document.createElement('div');
  Object.assign(wText.style, {
    fontSize: '10px', color: '#778899', lineHeight: '1.6', marginBottom: '12px',
  });
  wText.textContent = 'I can help you find documents, answer questions about forge procedures, equipment manuals, and historical records. I have context on all ' + DOCUMENTS.length + ' documents in the archive.';
  welcome.appendChild(wText);

  var suggestions = [
    'What heat treatment SOPs do we have?',
    'Summarize the furnace service manual',
    'When is the refractory relining due?',
    'What are the original building plans from 1968?',
  ];

  var sugLabel = document.createElement('div');
  Object.assign(sugLabel.style, { fontSize: '8px', color: '#556677', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' });
  sugLabel.textContent = 'Try asking';
  welcome.appendChild(sugLabel);

  for (var i = 0; i < suggestions.length; i++) {
    (function(text) {
      var sug = document.createElement('div');
      Object.assign(sug.style, {
        fontSize: '9px', color: '#8899aa', padding: '5px 8px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: '3px', marginBottom: '3px',
        cursor: 'pointer', transition: 'all 0.15s ease',
      });
      sug.textContent = '\u203A ' + text;
      sug.addEventListener('mouseenter', function() {
        sug.style.borderColor = 'rgba(167,139,250,0.2)';
        sug.style.color = '#a78bfa';
      });
      sug.addEventListener('mouseleave', function() {
        sug.style.borderColor = 'rgba(255,255,255,0.04)';
        sug.style.color = '#8899aa';
      });
      sug.addEventListener('click', function() {
        var chatInput = document.getElementById('doc-chat-input');
        if (chatInput) {
          chatInput.value = text;
          sendMessage();
        }
      });
      welcome.appendChild(sug);
    })(suggestions[i]);
  }

  chatArea.appendChild(welcome);
}


function sendMessage() {
  var input = document.getElementById('doc-chat-input');
  if (!input || chatBusy) return;
  var text = input.value.trim();
  if (!text) return;

  input.value = '';

  // Add user message
  chatMessages.push({ role: 'user', content: text });
  appendChatBubble('user', text);

  // Call AI
  chatBusy = true;
  appendTypingIndicator();

  callAI(text).then(function(response) {
    removeTypingIndicator();
    chatMessages.push({ role: 'assistant', content: response });
    appendChatBubble('assistant', response);
    chatBusy = false;
  }).catch(function(err) {
    removeTypingIndicator();
    var errMsg = 'I encountered an issue connecting to the AI service. Error: ' + (err.message || err) + '. You can still browse documents manually using the library on the left.';
    chatMessages.push({ role: 'assistant', content: errMsg });
    appendChatBubble('assistant', errMsg);
    chatBusy = false;
  });
}


function appendChatBubble(role, text) {
  var chatArea = document.getElementById('doc-chat-area');
  if (!chatArea) return;

  // Remove welcome message on first interaction
  var welcome = chatArea.querySelector('[style*="rgba(167,139,250,0.04)"]');
  if (welcome && chatMessages.length <= 2) welcome.remove();

  var bubble = document.createElement('div');
  var isUser = role === 'user';
  Object.assign(bubble.style, {
    maxWidth: '90%',
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    padding: '10px 12px',
    borderRadius: '6px',
    fontSize: '10px', lineHeight: '1.6',
    color: isUser ? '#c8cdd3' : '#aabbcc',
    background: isUser ? 'rgba(167,139,250,0.1)' : 'rgba(0,8,16,0.5)',
    border: '1px solid ' + (isUser ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.04)'),
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
  bubble.textContent = text;
  chatArea.appendChild(bubble);
  chatArea.scrollTop = chatArea.scrollHeight;
}


function appendTypingIndicator() {
  var chatArea = document.getElementById('doc-chat-area');
  if (!chatArea) return;

  var indicator = document.createElement('div');
  indicator.id = 'doc-typing-indicator';
  Object.assign(indicator.style, {
    alignSelf: 'flex-start',
    padding: '10px 16px',
    borderRadius: '6px',
    background: 'rgba(0,8,16,0.5)',
    border: '1px solid rgba(255,255,255,0.04)',
    display: 'flex', gap: '4px', alignItems: 'center',
  });

  for (var i = 0; i < 3; i++) {
    var dot = document.createElement('div');
    Object.assign(dot.style, {
      width: '5px', height: '5px', borderRadius: '50%',
      background: '#a78bfa', opacity: '0.4',
      animation: 'doc-typing-dot 1.2s ease-in-out ' + (i * 0.2) + 's infinite',
    });
    indicator.appendChild(dot);
  }

  chatArea.appendChild(indicator);
  chatArea.scrollTop = chatArea.scrollHeight;
}


function removeTypingIndicator() {
  var el = document.getElementById('doc-typing-indicator');
  if (el) el.remove();
}


// ---------------------------------------------------------------------------
// AI API Call
// ---------------------------------------------------------------------------

function buildDocumentContext() {
  var lines = ['The Forgeworks document archive contains ' + DOCUMENTS.length + ' documents:\n'];

  for (var i = 0; i < DOCUMENTS.length; i++) {
    var doc = DOCUMENTS[i];
    lines.push(
      doc.id + ': "' + doc.title + '" (' + doc.category + ', ' + doc.status +
      ', ' + doc.rev + ', ' + doc.date + ', ' + doc.pages + ' pages, by ' + doc.author + ')' +
      '\n  Summary: ' + doc.summary + '\n'
    );
  }

  return lines.join('\n');
}


function callAI(userMessage) {
  var systemPrompt =
    'You are the Forgeworks Document AI Assistant. You help forge workers find and understand documentation. ' +
    'You have access to the full document archive metadata and summaries listed below. ' +
    'Be concise, practical, and reference specific document IDs when relevant. ' +
    'If asked about content not covered in the archive, say so honestly. ' +
    'Use a direct, technical tone appropriate for an industrial forge environment.\n\n' +
    buildDocumentContext();

  // Build conversation history (last 10 messages for context window)
  var messages = [];
  var historyStart = Math.max(0, chatMessages.length - 10);
  for (var i = historyStart; i < chatMessages.length; i++) {
    messages.push({
      role: chatMessages[i].role,
      content: chatMessages[i].content,
    });
  }

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages,
    }),
  })
  .then(function(response) {
    if (!response.ok) {
      return response.text().then(function(text) {
        throw new Error('API ' + response.status + ': ' + text.substring(0, 200));
      });
    }
    return response.json();
  })
  .then(function(data) {
    if (data.content && data.content.length > 0) {
      var textBlocks = [];
      for (var b = 0; b < data.content.length; b++) {
        if (data.content[b].type === 'text') {
          textBlocks.push(data.content[b].text);
        }
      }
      return textBlocks.join('\n') || 'No response generated.';
    }
    return 'No response generated.';
  });
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function parseSize(str) {
  var match = str.match(/([\d.]+)\s*(MB|KB|GB)/i);
  if (!match) return 0;
  var val = parseFloat(match[1]);
  var unit = match[2].toUpperCase();
  if (unit === 'GB') return val * 1024;
  if (unit === 'KB') return val / 1024;
  return val;
}

function formatSize(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb.toFixed(1) + ' MB';
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('doc-styles')) return;
  var style = document.createElement('style');
  style.id = 'doc-styles';
  style.textContent =
    '#forgeworks-documents ::-webkit-scrollbar { width: 6px; }' +
    '#forgeworks-documents ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }' +
    '#forgeworks-documents ::-webkit-scrollbar-thumb { background: ' + ACCENT_DIM + '0.2); border-radius: 3px; }' +
    '#forgeworks-documents ::-webkit-scrollbar-thumb:hover { background: ' + ACCENT_DIM + '0.4); }' +
    '@keyframes doc-ai-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }' +
    '@keyframes doc-typing-dot { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }';
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
  selectedDoc = null;
  chatMessages = [];
  chatBusy = false;

  var searchEl = document.getElementById('doc-search');
  if (searchEl) searchEl.value = '';

  updateCategoryButtons();
  renderSidebarStats();
  renderDocumentList();
  renderDetail();
  renderWelcomeMessage();
}

export function hide() {
  if (overlay) overlay.style.display = 'none';
  visible = false;
  // Close upload modal if open
  var modal = document.getElementById('doc-upload-modal');
  if (modal) modal.remove();
}

export function isVisible() {
  return visible;
}

export function onBack(callback) {
  backCallback = callback;
}
