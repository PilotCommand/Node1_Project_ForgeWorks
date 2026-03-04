// ============================================================================
// mainmenu.js — Forgeworks Main Menu / Landing Page
// Forgeworks Infrastructure
// ============================================================================
// Full-screen landing page that serves as the entry point for the entire
// Forgeworks application. Presents navigation tiles for each major subsystem:
//
//   • Monitor Forge       → 3D forge world (loading screen → live view)
//   • Purchase Orders     → Order management and heat treatment selection
//   • General Inventory   → Raw materials, finished goods, equipment stock
//   • Maintenance Schedule → Calendar view of machinery servicing
//   • Document Protocols  → Archive of scanned forge documents and SOPs
//
// Exports: show(), hide(), onNavigate(callback), isVisible()
// ============================================================================

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

var overlay = null;          // Full-screen DOM overlay
var navCallback = null;      // External navigation handler
var visible = false;
var loadingOverlay = null;   // Loading screen for Monitor Forge transition
var loadingProgress = 0;
var loadingInterval = null;
var hasAnimated = false;     // Track if entry animation already played

// ---------------------------------------------------------------------------
// Navigation Items
// ---------------------------------------------------------------------------

var NAV_ITEMS = [
  {
    key: 'monitor_forge',
    label: 'Monitor Forge',
    desc: 'Enter the live 3D forge environment — observe, build, and manage the production floor in real time.',
    icon: 'forge',
    accent: '#ff6a00',
    accentGlow: 'rgba(255, 106, 0, 0.25)',
  },
  {
    key: 'purchase_orders',
    label: 'Purchase Orders',
    desc: 'Place and track orders — select heat treatments, forging processes, materials, and review cost estimates.',
    icon: 'orders',
    accent: '#00b4d8',
    accentGlow: 'rgba(0, 180, 216, 0.2)',
  },
  {
    key: 'general_inventory',
    label: 'General Inventory',
    desc: 'Complete inventory of raw materials, work-in-progress, finished goods, tooling, and consumables.',
    icon: 'inventory',
    accent: '#2ec4b6',
    accentGlow: 'rgba(46, 196, 182, 0.2)',
  },
  {
    key: 'maintenance_schedule',
    label: 'Maintenance Schedule',
    desc: 'Calendar of scheduled maintenance, equipment downtime windows, and servicing history.',
    icon: 'maintenance',
    accent: '#e9c46a',
    accentGlow: 'rgba(233, 196, 106, 0.2)',
  },
  {
    key: 'document_protocols',
    label: 'Document Protocols',
    desc: 'Searchable archive of scanned forge documents — machinery manuals, SOPs, techniques, and compliance records.',
    icon: 'documents',
    accent: '#a8a4ce',
    accentGlow: 'rgba(168, 164, 206, 0.2)',
  },
];

// ---------------------------------------------------------------------------
// SVG Icons (inline, no external deps)
// ---------------------------------------------------------------------------

function getIcon(key) {
  var icons = {
    forge:
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M8 38h32"/>' +
        '<path d="M12 38V22a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v16"/>' +
        '<path d="M18 20v-6a6 6 0 0 1 12 0v6"/>' +
        '<path d="M20 28h8"/><path d="M24 24v8"/>' +
        '<path d="M10 38l4-4"/><path d="M38 38l-4-4"/>' +
        '<circle cx="24" cy="28" r="6" stroke-dasharray="2 3" opacity="0.4"/>' +
      '</svg>',
    orders:
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="8" y="8" width="24" height="32" rx="2"/>' +
        '<path d="M14 16h12"/><path d="M14 22h12"/><path d="M14 28h8"/>' +
        '<path d="M36 20l-6 6 6 6" opacity="0.5"/>' +
        '<path d="M40 26h-10"/>' +
        '<path d="M14 34h4"/>' +
      '</svg>',
    inventory:
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="6" y="10" width="36" height="28" rx="2"/>' +
        '<path d="M6 20h36"/><path d="M6 30h36"/>' +
        '<path d="M18 10v28"/><path d="M30 10v28"/>' +
        '<circle cx="12" cy="15" r="1.5" fill="currentColor" opacity="0.4"/>' +
        '<circle cx="24" cy="25" r="1.5" fill="currentColor" opacity="0.4"/>' +
        '<circle cx="36" cy="35" r="1.5" fill="currentColor" opacity="0.4"/>' +
      '</svg>',
    maintenance:
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="8" y="10" width="32" height="30" rx="2"/>' +
        '<path d="M8 18h32"/>' +
        '<path d="M16 6v8"/><path d="M32 6v8"/>' +
        '<path d="M16 24h4v4h-4z"/>' +
        '<path d="M28 24h4v4h-4z"/>' +
        '<path d="M16 32h4v4h-4z"/>' +
        '<circle cx="30" cy="34" r="2" opacity="0.4"/>' +
      '</svg>',
    documents:
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 6h16l10 10v26a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>' +
        '<path d="M28 6v10h10"/>' +
        '<path d="M16 22h16"/><path d="M16 28h16"/><path d="M16 34h10"/>' +
        '<path d="M6 12h4" opacity="0.3"/><path d="M6 18h4" opacity="0.3"/>' +
        '<path d="M6 24h4" opacity="0.3"/>' +
      '</svg>',
  };
  return icons[key] || '';
}

// ---------------------------------------------------------------------------
// Build DOM
// ---------------------------------------------------------------------------

function buildOverlay() {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.id = 'forgeworks-main-menu';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#060b11',
    overflow: 'hidden',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', 'Monaco', monospace",
  });

  // --- Animated background layer ---
  var bgLayer = document.createElement('div');
  Object.assign(bgLayer.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
    background:
      'radial-gradient(ellipse 80% 60% at 50% 110%, rgba(255,90,0,0.06) 0%, transparent 70%),' +
      'radial-gradient(ellipse 60% 40% at 20% 20%, rgba(0,60,120,0.04) 0%, transparent 60%),' +
      'radial-gradient(ellipse 50% 50% at 80% 30%, rgba(80,40,10,0.03) 0%, transparent 60%)',
  });
  overlay.appendChild(bgLayer);

  // --- Subtle grid pattern ---
  var gridPattern = document.createElement('div');
  Object.assign(gridPattern.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
    opacity: '0.03',
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  });
  overlay.appendChild(gridPattern);

  // --- Top edge line ---
  var topLine = document.createElement('div');
  Object.assign(topLine.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(255,106,0,0.3) 30%, rgba(255,106,0,0.5) 50%, rgba(255,106,0,0.3) 70%, transparent)',
  });
  overlay.appendChild(topLine);

  // --- Content wrapper ---
  var content = document.createElement('div');
  Object.assign(content.style, {
    position: 'relative',
    zIndex: '2',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '1100px',
    width: '90%',
    padding: '0 20px',
  });
  overlay.appendChild(content);

  // --- Header section ---
  var header = document.createElement('div');
  Object.assign(header.style, {
    textAlign: 'center',
    marginBottom: '50px',
    opacity: '0',
    transform: 'translateY(-20px)',
    transition: 'opacity 0.8s ease, transform 0.8s ease',
  });
  header.className = 'mm-animate-in';
  header.dataset.delay = '0';

  // Logo mark
  var logoMark = document.createElement('div');
  Object.assign(logoMark.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px', height: '56px',
    border: '1px solid rgba(255,106,0,0.3)',
    borderRadius: '6px',
    marginBottom: '20px',
    background: 'rgba(255,106,0,0.04)',
  });
  logoMark.innerHTML =
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="#ff6a00" stroke-width="1.5" stroke-linecap="round">' +
      '<path d="M8 26V14l8-8 8 8v12"/>' +
      '<path d="M4 26h24"/>' +
      '<path d="M14 26v-8h4v8"/>' +
      '<path d="M12 16h8" opacity="0.5"/>' +
      '<circle cx="16" cy="12" r="1" fill="#ff6a00"/>' +
    '</svg>';
  header.appendChild(logoMark);

  // Title
  var title = document.createElement('h1');
  Object.assign(title.style, {
    margin: '0 0 8px 0',
    fontSize: '32px',
    fontWeight: '300',
    letterSpacing: '8px',
    textTransform: 'uppercase',
    color: '#c8cdd3',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', monospace",
  });
  title.textContent = 'FORGEWORKS';
  header.appendChild(title);

  // Subtitle
  var subtitle = document.createElement('div');
  Object.assign(subtitle.style, {
    fontSize: '10px',
    letterSpacing: '4px',
    textTransform: 'uppercase',
    color: '#556677',
    fontWeight: '400',
  });
  subtitle.textContent = 'Forge Management System';
  header.appendChild(subtitle);

  // Divider
  var divider = document.createElement('div');
  Object.assign(divider.style, {
    width: '60px', height: '1px',
    margin: '18px auto 0',
    background: 'linear-gradient(90deg, transparent, rgba(255,106,0,0.4), transparent)',
  });
  header.appendChild(divider);

  content.appendChild(header);

  // --- Navigation grid ---
  var navGrid = document.createElement('div');
  Object.assign(navGrid.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '14px',
    width: '100%',
  });

  for (var i = 0; i < NAV_ITEMS.length; i++) {
    var card = buildNavCard(NAV_ITEMS[i], i);
    navGrid.appendChild(card);
  }

  content.appendChild(navGrid);

  // --- Footer ---
  var footer = document.createElement('div');
  Object.assign(footer.style, {
    marginTop: '50px',
    textAlign: 'center',
    opacity: '0',
    transform: 'translateY(10px)',
    transition: 'opacity 0.8s ease, transform 0.8s ease',
  });
  footer.className = 'mm-animate-in';
  footer.dataset.delay = '600';

  var footerText = document.createElement('div');
  Object.assign(footerText.style, {
    fontSize: '9px',
    letterSpacing: '3px',
    textTransform: 'uppercase',
    color: '#334455',
  });
  footerText.textContent = 'Infrastructure Tier 7  \u2022  v0.1';
  footer.appendChild(footerText);

  content.appendChild(footer);

  // --- Build loading overlay (hidden initially) ---
  buildLoadingOverlay();

  document.body.appendChild(overlay);
}


function buildNavCard(item, index) {
  var card = document.createElement('div');
  card.className = 'mm-animate-in';
  card.dataset.delay = String(150 + index * 80);

  // Make the first card (Monitor Forge) span full width
  if (index === 0) {
    card.dataset.featured = 'true';
  }

  Object.assign(card.style, {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    padding: '22px 24px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(8, 14, 22, 0.8)',
    cursor: 'pointer',
    overflow: 'hidden',
    opacity: '0',
    transform: 'translateY(20px)',
    transition: 'opacity 0.6s ease, transform 0.6s ease, border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease',
    gridColumn: index === 0 ? '1 / -1' : 'auto',
  });

  // Top accent line
  var accentLine = document.createElement('div');
  Object.assign(accentLine.style, {
    position: 'absolute',
    top: '0', left: '0',
    width: '100%', height: '2px',
    background: 'linear-gradient(90deg, ' + item.accent + '00, ' + item.accent + '88, ' + item.accent + '00)',
    opacity: '0',
    transition: 'opacity 0.3s ease',
  });
  card.appendChild(accentLine);

  // Corner glow
  var cornerGlow = document.createElement('div');
  Object.assign(cornerGlow.style, {
    position: 'absolute',
    top: '-30px', right: '-30px',
    width: '80px', height: '80px',
    borderRadius: '50%',
    background: item.accentGlow,
    filter: 'blur(20px)',
    opacity: '0',
    transition: 'opacity 0.4s ease',
    pointerEvents: 'none',
  });
  card.appendChild(cornerGlow);

  // Content row
  var row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    position: 'relative',
    zIndex: '1',
    flexDirection: index === 0 ? 'row' : 'row',
  });

  // Icon
  var iconWrap = document.createElement('div');
  Object.assign(iconWrap.style, {
    width: index === 0 ? '44px' : '36px',
    height: index === 0 ? '44px' : '36px',
    flexShrink: '0',
    color: item.accent,
    opacity: '0.7',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
  });
  iconWrap.innerHTML = getIcon(item.icon);
  row.appendChild(iconWrap);

  // Text block
  var textBlock = document.createElement('div');
  textBlock.style.flex = '1';

  var label = document.createElement('div');
  Object.assign(label.style, {
    fontSize: index === 0 ? '14px' : '12px',
    fontWeight: '600',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: '#b0b8c4',
    marginBottom: '6px',
    transition: 'color 0.3s ease',
  });
  label.textContent = item.label;
  textBlock.appendChild(label);

  var desc = document.createElement('div');
  Object.assign(desc.style, {
    fontSize: '10px',
    lineHeight: '1.6',
    color: '#4a5568',
    transition: 'color 0.3s ease',
    maxWidth: index === 0 ? '600px' : 'none',
  });
  desc.textContent = item.desc;
  textBlock.appendChild(desc);

  row.appendChild(textBlock);

  // Arrow indicator
  var arrow = document.createElement('div');
  Object.assign(arrow.style, {
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'center',
    color: '#334455',
    fontSize: '16px',
    transition: 'color 0.3s ease, transform 0.3s ease',
    flexShrink: '0',
  });
  arrow.innerHTML = '\u203A';
  row.appendChild(arrow);

  card.appendChild(row);

  // Status indicator for Monitor Forge
  if (index === 0) {
    var statusRow = document.createElement('div');
    Object.assign(statusRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(255,255,255,0.04)',
      position: 'relative',
      zIndex: '1',
    });

    var statusDot = document.createElement('div');
    Object.assign(statusDot.style, {
      width: '6px', height: '6px',
      borderRadius: '50%',
      background: '#22c55e',
      boxShadow: '0 0 6px rgba(34,197,94,0.5)',
      animation: 'mm-pulse-dot 2s ease-in-out infinite',
    });
    statusRow.appendChild(statusDot);

    var statusText = document.createElement('span');
    Object.assign(statusText.style, {
      fontSize: '9px',
      letterSpacing: '2px',
      textTransform: 'uppercase',
      color: '#3a5a3a',
    });
    statusText.textContent = 'Systems Online';
    statusRow.appendChild(statusText);

    card.appendChild(statusRow);
  }

  // --- Hover interactions ---
  card.addEventListener('mouseenter', function() {
    card.style.borderColor = item.accent + '44';
    card.style.background = 'rgba(12, 20, 32, 0.9)';
    card.style.boxShadow = '0 4px 24px ' + item.accentGlow + ', inset 0 1px 0 ' + item.accent + '15';
    accentLine.style.opacity = '1';
    cornerGlow.style.opacity = '1';
    iconWrap.style.opacity = '1';
    iconWrap.style.transform = 'scale(1.05)';
    label.style.color = '#dde3ea';
    desc.style.color = '#6b7a8d';
    arrow.style.color = item.accent;
    arrow.style.transform = 'translateX(3px)';
  });

  card.addEventListener('mouseleave', function() {
    card.style.borderColor = 'rgba(255,255,255,0.06)';
    card.style.background = 'rgba(8, 14, 22, 0.8)';
    card.style.boxShadow = 'none';
    accentLine.style.opacity = '0';
    cornerGlow.style.opacity = '0';
    iconWrap.style.opacity = '0.7';
    iconWrap.style.transform = 'scale(1)';
    label.style.color = '#b0b8c4';
    desc.style.color = '#4a5568';
    arrow.style.color = '#334455';
    arrow.style.transform = 'translateX(0)';
  });

  // --- Click ---
  card.addEventListener('click', function() {
    handleNavClick(item.key);
  });

  return card;
}


// ---------------------------------------------------------------------------
// Loading Overlay (for Monitor Forge transition)
// ---------------------------------------------------------------------------

function buildLoadingOverlay() {
  loadingOverlay = document.createElement('div');
  loadingOverlay.id = 'forgeworks-loading';
  Object.assign(loadingOverlay.style, {
    position: 'fixed',
    top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '10000',
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#060b11',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', 'Monaco', monospace",
  });

  // Loading content
  var loadWrap = document.createElement('div');
  Object.assign(loadWrap.style, {
    textAlign: 'center',
    position: 'relative',
    zIndex: '2',
  });

  // Forge logo spinner
  var spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width: '48px', height: '48px',
    margin: '0 auto 28px',
    border: '2px solid rgba(255,106,0,0.15)',
    borderTop: '2px solid #ff6a00',
    borderRadius: '50%',
    animation: 'mm-spin 1s linear infinite',
  });
  loadWrap.appendChild(spinner);

  var loadTitle = document.createElement('div');
  Object.assign(loadTitle.style, {
    fontSize: '14px',
    letterSpacing: '6px',
    textTransform: 'uppercase',
    color: '#778899',
    marginBottom: '24px',
    fontWeight: '300',
  });
  loadTitle.textContent = 'FORGEWORKS';
  loadWrap.appendChild(loadTitle);

  // Progress bar container
  var barOuter = document.createElement('div');
  Object.assign(barOuter.style, {
    width: '240px',
    height: '2px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: '1px',
    margin: '0 auto 16px',
    overflow: 'hidden',
  });

  var barInner = document.createElement('div');
  barInner.id = 'mm-loading-bar';
  Object.assign(barInner.style, {
    width: '0%',
    height: '100%',
    background: 'linear-gradient(90deg, #ff6a00, #ff9a44)',
    borderRadius: '1px',
    transition: 'width 0.3s ease',
  });
  barOuter.appendChild(barInner);
  loadWrap.appendChild(barOuter);

  // Status text
  var statusLine = document.createElement('div');
  statusLine.id = 'mm-loading-status';
  Object.assign(statusLine.style, {
    fontSize: '9px',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    color: '#445566',
  });
  statusLine.textContent = 'Initializing systems...';
  loadWrap.appendChild(statusLine);

  loadingOverlay.appendChild(loadWrap);
  document.body.appendChild(loadingOverlay);
}


function showLoading(onComplete) {
  if (!loadingOverlay) return;
  loadingOverlay.style.display = 'flex';
  loadingProgress = 0;

  var bar = document.getElementById('mm-loading-bar');
  var status = document.getElementById('mm-loading-status');

  var steps = [
    { at: 10,  text: 'Loading grid layout...' },
    { at: 25,  text: 'Initializing renderer...' },
    { at: 40,  text: 'Building scene geometry...' },
    { at: 55,  text: 'Spawning equipment...' },
    { at: 70,  text: 'Configuring HUD systems...' },
    { at: 85,  text: 'Activating forge controls...' },
    { at: 95,  text: 'Final checks...' },
    { at: 100, text: 'Ready.' },
  ];
  var stepIdx = 0;

  loadingInterval = setInterval(function() {
    loadingProgress += 2 + Math.random() * 3;
    if (loadingProgress > 100) loadingProgress = 100;

    if (bar) bar.style.width = Math.round(loadingProgress) + '%';

    while (stepIdx < steps.length && loadingProgress >= steps[stepIdx].at) {
      if (status) status.textContent = steps[stepIdx].text;
      stepIdx++;
    }

    if (loadingProgress >= 100) {
      clearInterval(loadingInterval);
      loadingInterval = null;

      // Brief pause at 100% then fade out
      setTimeout(function() {
        loadingOverlay.style.transition = 'opacity 0.6s ease';
        loadingOverlay.style.opacity = '0';
        setTimeout(function() {
          loadingOverlay.style.display = 'none';
          loadingOverlay.style.opacity = '1';
          loadingOverlay.style.transition = '';
          if (onComplete) onComplete();
        }, 600);
      }, 400);
    }
  }, 60);
}

function hideLoading() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
  }
}


// ---------------------------------------------------------------------------
// Navigation Handler
// ---------------------------------------------------------------------------

function handleNavClick(key) {
  if (key === 'monitor_forge') {
    // Fade out menu, show loading, then fire callback
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity = '0';

    setTimeout(function() {
      overlay.style.display = 'none';
      overlay.style.opacity = '1';
      overlay.style.transition = '';
      visible = false;

      showLoading(function() {
        if (navCallback) navCallback(key);
      });
    }, 400);
    return;
  }

  // All other pages: fire callback immediately
  if (navCallback) navCallback(key);
}


// ---------------------------------------------------------------------------
// Entry Animation
// ---------------------------------------------------------------------------

function runEntryAnimation() {
  if (!overlay) return;
  var items = overlay.querySelectorAll('.mm-animate-in');
  for (var i = 0; i < items.length; i++) {
    (function(el) {
      var delay = parseInt(el.dataset.delay) || 0;
      setTimeout(function() {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 80 + delay);
    })(items[i]);
  }
  hasAnimated = true;
}

function resetAnimations() {
  if (!overlay) return;
  var items = overlay.querySelectorAll('.mm-animate-in');
  for (var i = 0; i < items.length; i++) {
    items[i].style.opacity = '0';
    items[i].style.transform = 'translateY(20px)';
    items[i].style.transition = 'none';
  }
  // Force reflow then restore transitions
  overlay.offsetHeight;
  for (var j = 0; j < items.length; j++) {
    items[j].style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  }
}


// ---------------------------------------------------------------------------
// Injected Keyframe Animations
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('mm-keyframes')) return;
  var style = document.createElement('style');
  style.id = 'mm-keyframes';
  style.textContent =
    '@keyframes mm-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }' +
    '@keyframes mm-pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }';
  document.head.appendChild(style);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the main menu overlay.
 * If it hasn't been built yet, builds the DOM first.
 */
export function show() {
  injectStyles();
  buildOverlay();

  overlay.style.display = 'flex';
  visible = true;

  // Re-run entry animations each time we show
  resetAnimations();
  requestAnimationFrame(function() {
    runEntryAnimation();
  });
}

/**
 * Hide the main menu overlay (no transition).
 */
export function hide() {
  if (overlay) {
    overlay.style.display = 'none';
  }
  visible = false;
  hideLoading();
}

/**
 * Register a navigation callback.
 * Called with the nav item key when user clicks a card.
 *
 * @param {function} callback - function(key) where key is one of:
 *   'monitor_forge', 'purchase_orders', 'general_inventory',
 *   'maintenance_schedule', 'document_protocols'
 */
export function onNavigate(callback) {
  navCallback = callback;
}

/**
 * Whether the main menu is currently visible.
 * @returns {boolean}
 */
export function isVisible() {
  return visible;
}