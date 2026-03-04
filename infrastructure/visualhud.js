// ============================================================================
// visualhud.js — 3D Renderer, HUD, and Visibility Filter
// Forgeworks Infrastructure Tier 3
// ============================================================================
// Sets up Three.js renderer/scene/camera, manages all HUD panels, and
// implements the visibility filter system (thermal vision theme).
//
// HUD panels are draggable, resizable, collapsible, with font-size controls.
// Inspired by modular game HUD patterns — every panel can be repositioned,
// collapsed, and resized by the user.
//
// Imports: worldclock.js, measurementunits.js
// Exports: Renderer setup, scene access, HUD panels, visibility filter
// ============================================================================

import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { tick, getTime, getDelta, getSpeed, setSpeed, pause, resume, togglePause, getPaused, formatTime, formatSpeed, formatDate } from './worldclock.js';
import { getDisplaySystem, setDisplaySystem } from './measurementunits.js';
import { initControls, update as updateControls, resetView, flyTo } from './controls.js';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let renderer = null;
let scene = null;
let camera = null;
let container = null;
let animationFrameId = null;
let updateCallback = null;

// Current mode
let currentMode = 'build';

// Raycasting
let raycaster = new THREE.Raycaster();
let mouseVec = new THREE.Vector2();

// Event callbacks
let onObjectClickCallback = null;
let onGridClickCallback = null;

// HUD DOM references
let statsPanel = null;
let modeFlash = null;
let modeFlashTimeout = null;
let modeControlsPanel = null;
let modeInfoPanel = null;
let registryPanel = null;
let registryActiveTab = 'zones';
let worldClockPanel = null;
let clockTimeEl = null;
let clockDateEl = null;
let clockSpeedEl = null;
let registryData = {
  zones: [],
  stationary: [],
  mobile: [],
  products: [],
};
let registryFilter = '';
let menuPanel = null;

// Grid dimensions (set during init)
let gridW = 60;
let gridH = 80;

// ---------------------------------------------------------------------------
// Renderer Initialization
// ---------------------------------------------------------------------------

export function initRenderer(containerElement, gw, gd) {
  container = containerElement;
  gridW = gw || 60;
  gridH = gd || 80;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1628);
  // No fog — grid shader handles its own distance fade

  // Camera
  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // Lighting — bright factory overhead lighting
  var ambientLight = new THREE.AmbientLight(0x99aabb, 1.0);
  scene.add(ambientLight);

  var dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(gridW / 2, 50, gridH / 2);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 120;
  dirLight.shadow.camera.left = -gridW;
  dirLight.shadow.camera.right = gridW;
  dirLight.shadow.camera.top = gridH;
  dirLight.shadow.camera.bottom = -gridH;
  scene.add(dirLight);

  var fillLight = new THREE.DirectionalLight(0x8899aa, 0.8);
  fillLight.position.set(-20, 30, -20);
  scene.add(fillLight);

  var hemiLight = new THREE.HemisphereLight(0xaabbcc, 0x444422, 0.6);
  scene.add(hemiLight);

  // Camera controls
  initControls(camera, renderer.domElement, gridW, gridH);

  // FPS counter — will be embedded in the world clock panel
  statsPanel = new Stats();
  statsPanel.showPanel(0);

  // HUD styles
  createStyles();

  // Window resize
  window.addEventListener('resize', onWindowResize);

  // Mouse click — disabled for now
  // renderer.domElement.addEventListener('click', onCanvasClick);

  return { renderer: renderer, scene: scene, camera: camera };
}

function onWindowResize() {
  if (!container || !camera || !renderer) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

// ---------------------------------------------------------------------------
// Scene Access
// ---------------------------------------------------------------------------

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }

export function addToScene(object) {
  if (scene && object) scene.add(object);
}

export function removeFromScene(object) {
  if (scene && object) scene.remove(object);
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

export function startRenderLoop(callback) {
  updateCallback = callback;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  var lastTimestamp = performance.now();

  function loop(timestamp) {
    animationFrameId = requestAnimationFrame(loop);

    if (statsPanel) statsPanel.begin();

    var realDeltaMs = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Clamp to prevent spiral of death after tab-away
    if (realDeltaMs > 200) realDeltaMs = 200;

    // Advance world clock
    tick(realDeltaMs);

    // Run game logic
    if (updateCallback) updateCallback(getDelta());

    // Update camera controls (damping)
    updateControls();

    // Render
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }

    // Update world clock panel
    updateWorldClockDisplay();

    if (statsPanel) statsPanel.end();
  }

  animationFrameId = requestAnimationFrame(loop);
}

export function stopRenderLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ============================================================================
// HUD STYLES — Injected CSS (adopted from modular game HUD pattern)
// ============================================================================

function createStyles() {
  if (document.getElementById('forge-hud-styles')) return;

  var style = document.createElement('style');
  style.id = 'forge-hud-styles';
  style.textContent = `

    /* ================================================================
       BASE PANEL — every HUD panel inherits this
       ================================================================ */
    .hud-panel {
      position: absolute;
      background: rgba(0, 10, 20, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: #aabbcc;
      font-family: 'Consolas', 'SF Mono', 'Fira Code', 'Monaco', monospace;
      font-size: 12px;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      pointer-events: auto;
      min-width: 100px;
      min-height: 40px;
      z-index: 10;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
    }

    .hud-panel:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }

    /* ================================================================
       TITLE BAR — draggable handle
       ================================================================ */
    .hud-title {
      background: rgba(0, 8, 16, 0.5);
      padding: 5px 8px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      cursor: move;
      user-select: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #667788;
      font-weight: 600;
    }

    .hud-title-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .hud-title-controls .font-btn {
      opacity: 0.45;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
      transition: opacity 0.2s;
      line-height: 1;
      padding: 0 2px;
      user-select: none;
    }

    .hud-title-controls .font-btn:hover {
      opacity: 1;
    }

    .hud-title-controls .grip {
      opacity: 0.3;
      font-size: 10px;
      letter-spacing: 2px;
    }

    .hud-title-controls .collapse-btn {
      opacity: 0.45;
      font-size: 8px;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.25s;
      line-height: 1;
    }

    .hud-title-controls .collapse-btn:hover {
      opacity: 1;
    }

    .hud-panel.collapsed .collapse-btn {
      transform: rotate(180deg);
    }

    /* ================================================================
       COLLAPSIBLE CONTENT
       ================================================================ */
    .hud-collapsible {
      overflow: hidden;
      transition: max-height 0.3s ease, opacity 0.2s ease;
      max-height: 600px;
      opacity: 1;
    }

    .hud-panel.collapsed .hud-collapsible {
      max-height: 0;
      opacity: 0;
    }

    .hud-panel.collapsed {
      min-height: auto !important;
    }

    .hud-panel.collapsed .resize-handle {
      display: none;
    }

    /* ================================================================
       RESIZE HANDLE
       ================================================================ */
    .resize-handle {
      position: absolute;
      width: 12px;
      height: 12px;
      bottom: 0;
      right: 0;
      cursor: nwse-resize;
      opacity: 0.3;
      transition: opacity 0.2s;
    }

    .resize-handle::before {
      content: '';
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 8px;
      height: 8px;
      border-right: 2px solid #667788;
      border-bottom: 2px solid #667788;
    }

    .hud-panel:hover .resize-handle {
      opacity: 0.7;
    }

    /* ================================================================
       DRAG / RESIZE STATES
       ================================================================ */
    .hud-panel.dragging {
      opacity: 0.75;
      z-index: 1000;
    }

    .hud-panel.resizing {
      opacity: 0.9;
    }

  `;
  document.head.appendChild(style);
}

// ============================================================================
// DRAG & RESIZE FUNCTIONALITY (adopted from modular game HUD)
// ============================================================================

function makeDraggable(panel) {
  var titleBar = panel.querySelector('.hud-title');
  if (!titleBar) return;

  var isDragging = false;
  var startX, startY, startLeft, startTop;

  titleBar.addEventListener('mousedown', function(e) {
    // Don't drag if clicking on a button/input inside the title
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' ||
        e.target.classList.contains('font-btn') ||
        e.target.classList.contains('collapse-btn')) return;

    isDragging = true;
    panel.classList.add('dragging');

    var rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    // Switch to absolute left/top positioning, preserving any scale
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.marginLeft = '0';
    panel.style.marginRight = '0';

    var currentTransform = panel.style.transform || '';
    var scaleMatch = currentTransform.match(/scale\(([^)]+)\)/);
    var scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    // Use top-left origin so left/top aligns with visual position
    panel.style.transformOrigin = 'top left';
    panel.style.transform = scaleMatch ? scaleMatch[0] : 'none';
    panel.style.left = startLeft + 'px';
    panel.style.top = startTop + 'px';

    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;

    var dx = e.clientX - startX;
    var dy = e.clientY - startY;

    var newLeft = startLeft + dx;
    var newTop = startTop + dy;

    // Constrain to viewport
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panel.offsetWidth));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - panel.offsetHeight));

    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (isDragging) {
      isDragging = false;
      panel.classList.remove('dragging');
    }
  });
}

function makeResizable(panel, onResize, corner) {
  corner = corner || 'bottom-right';

  var handle = document.createElement('div');
  handle.className = 'resize-handle';
  panel.appendChild(handle);

  var isResizing = false;
  var startX, startY, startWidth, startHeight;

  handle.addEventListener('mousedown', function(e) {
    isResizing = true;
    panel.classList.add('resizing');

    var rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width;
    startHeight = rect.height;

    // Anchor the opposite corner
    if (corner === 'bottom-left') {
      panel.style.left = 'auto';
      panel.style.bottom = 'auto';
      panel.style.right = (window.innerWidth - rect.right) + 'px';
      panel.style.top = rect.top + 'px';
    } else if (corner === 'top-left') {
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      panel.style.right = (window.innerWidth - rect.right) + 'px';
      panel.style.bottom = (window.innerHeight - rect.bottom) + 'px';
    } else {
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
    }

    panel.style.width = startWidth + 'px';
    panel.style.height = startHeight + 'px';

    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isResizing) return;

    var dx = e.clientX - startX;
    var dy = e.clientY - startY;

    var newWidth, newHeight;

    if (corner === 'bottom-left') {
      newWidth = Math.max(100, startWidth - dx);
      newHeight = Math.max(40, startHeight + dy);
    } else if (corner === 'top-left') {
      newWidth = Math.max(100, startWidth - dx);
      newHeight = Math.max(40, startHeight - dy);
    } else {
      newWidth = Math.max(100, startWidth + dx);
      newHeight = Math.max(40, startHeight + dy);
    }

    panel.style.width = newWidth + 'px';
    panel.style.height = newHeight + 'px';

    if (onResize) onResize(newWidth, newHeight);
  });

  document.addEventListener('mouseup', function() {
    if (isResizing) {
      isResizing = false;
      panel.classList.remove('resizing');
    }
  });
}

function makeCollapsible(panel) {
  var collapseBtn = panel.querySelector('.collapse-btn');
  if (!collapseBtn) return;

  collapseBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    panel.classList.toggle('collapsed');
  });
}

/**
 * Helper to build the standard title bar HTML used by all panels.
 */
function titleBarHTML(label) {
  return '<span>' + label + '</span>' +
    '<span class="hud-title-controls">' +
      '<span class="font-btn font-decrease">−</span>' +
      '<span class="font-btn font-increase">+</span>' +
      '<span class="collapse-btn">▾</span>' +
      '<span class="grip">⋮⋮</span>' +
    '</span>';
}


// ============================================================================
// LEGACY STUBS — kept for backward compatibility with mainlogic.js
// ============================================================================

export function setMode(mode) { currentMode = mode; }
export function getMode() { return currentMode; }
export function setVisibilityFilter() {}
export function getVisibilityFilter() { return {}; }
export function setAllVisible() {}
export function isVisible() { return true; }
export function updateStatusBar() {}
export function showInfoPanel(data) { setInfoContent(data ? {
  type: data.type || '',
  id: data.id || '',
  name: data.name || data.id || '',
  properties: Object.keys(data).filter(function(k) { return k !== 'mesh' && k !== 'history' && k !== 'name' && k !== 'id' && k !== 'type'; }).map(function(k) {
    var v = data[k]; if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
    return { label: k, value: String(v) };
  }),
  status: data.status || null,
} : null); }
export function hideInfoPanel() { setInfoContent(null); }
export function showProductTracker() {}
export function hideProductTracker() {}
export function showAlert() {}
export function hideAlert() {}
export function getVisibilityCategories() { return {}; }


// ============================================================================
// MODE INDICATOR
// ============================================================================

var MODE_CONFIG = {
  build:    { label: 'BUILD',    color: '#ff8800', icon: '⚒' },
  select:   { label: 'SELECT',   color: '#00ffc8', icon: '◎' },
  spectate: { label: 'SPECTATE', color: '#6699ff', icon: '👁' },
};

var MODE_CONTROLS = {
  build: [
    { key: 'Left Click',       desc: 'Drag to select rectangle' },
    { key: 'Shift + Click',    desc: 'Add to selection' },
    { key: 'Right Click',      desc: 'Open build menu' },
    { key: 'Scroll',           desc: 'Zoom in / out' },
    { key: 'Middle Drag',      desc: 'Zoom' },
    { key: 'Space',            desc: 'Cycle mode' },
  ],
  select: [
    { key: 'Left Click',       desc: 'Select object' },
    { key: 'Scroll',           desc: 'Zoom in / out' },
    { key: 'Left Drag',        desc: 'Orbit camera' },
    { key: 'Right Drag',       desc: 'Pan camera' },
    { key: 'Space',            desc: 'Cycle mode' },
  ],
  spectate: [
    { key: 'Left Drag',        desc: 'Orbit camera' },
    { key: 'Right Drag',       desc: 'Pan camera' },
    { key: 'Scroll',           desc: 'Zoom in / out' },
    { key: 'Space',            desc: 'Cycle mode' },
  ],
};

// ---------------------------------------------------------------------------
// Menu Panel — top-left, general navigation
// ---------------------------------------------------------------------------

var MENU_ITEMS = [
  { key: 'main_menu',             label: 'Main Menu',             desc: 'Return to the main dashboard' },
  { key: 'purchase_orders',       label: 'Purchase Orders',       desc: 'Manage incoming and outgoing orders' },
  { key: 'general_inventory',     label: 'General Inventory',     desc: 'Track raw materials and finished goods' },
  { key: 'maintenance_schedule',  label: 'Maintenance Schedule',  desc: 'Equipment servicing and downtime planning' },
  { key: 'document_protocols',    label: 'Document Protocols',    desc: 'SOPs, safety docs, and compliance records' },
];

function ensureMenuPanel() {
  if (menuPanel) return;

  menuPanel = document.createElement('div');
  menuPanel.id = 'menu-panel';
  menuPanel.className = 'hud-panel';
  Object.assign(menuPanel.style, {
    top: '10px',
    left: '10px',
    width: 'fit-content',
    right: 'auto',
    bottom: 'auto',
    transition: 'border-color 0.3s ease',
    background: 'rgba(0, 10, 20, 0.7)',
    backdropFilter: 'blur(4px)',
    transformOrigin: 'top left',
  });

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.style.transition = 'color 0.3s ease, border-bottom-color 0.3s ease';
  title.innerHTML = titleBarHTML('Menu');
  menuPanel.appendChild(title);

  // Collapsible content
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';
  collapsible.id = 'menu-collapsible';
  collapsible.style.padding = '4px 6px';

  for (var i = 0; i < MENU_ITEMS.length; i++) {
    (function(item) {
      var tab = document.createElement('div');
      tab.className = 'menu-tab';
      tab.dataset.key = item.key;
      Object.assign(tab.style, {
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        cursor: 'pointer',
        borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0, 8, 16, 0.4)',
        marginBottom: '3px',
        transition: 'all 0.25s ease',
        borderLeft: '2px solid transparent',
      });

      var labelSpan = document.createElement('span');
      Object.assign(labelSpan.style, {
        padding: '6px 10px',
        fontSize: '10px',
        fontWeight: '600',
        letterSpacing: '0.5px',
        color: '#778899',
        transition: 'color 0.2s ease',
        whiteSpace: 'nowrap',
        flexShrink: '0',
      });
      labelSpan.textContent = item.label;
      tab.appendChild(labelSpan);

      var descSpan = document.createElement('span');
      Object.assign(descSpan.style, {
        maxWidth: '0',
        overflow: 'hidden',
        transition: 'max-width 0.3s ease, opacity 0.2s ease, padding 0.2s ease',
        opacity: '0',
        padding: '0',
        fontSize: '9px',
        color: '#556677',
        whiteSpace: 'nowrap',
        flexShrink: '0',
      });
      descSpan.textContent = '— ' + item.desc;
      tab.appendChild(descSpan);

      tab.addEventListener('mouseenter', function() {
        var accentColor = menuPanel.dataset.modeColor || '#6699ff';
        tab.style.borderLeftColor = accentColor;
        tab.style.background = 'rgba(255,255,255,0.03)';
        labelSpan.style.color = '#ddeeff';
        descSpan.style.maxWidth = '300px';
        descSpan.style.opacity = '1';
        descSpan.style.padding = '6px 10px 6px 0';
      });
      tab.addEventListener('mouseleave', function() {
        tab.style.borderLeftColor = 'transparent';
        tab.style.background = 'rgba(0, 8, 16, 0.4)';
        labelSpan.style.color = '#778899';
        descSpan.style.maxWidth = '0';
        descSpan.style.opacity = '0';
        descSpan.style.padding = '0';
      });
      tab.addEventListener('click', function() {
        onMenuItemClick(item.key);
      });

      collapsible.appendChild(tab);
    })(MENU_ITEMS[i]);
  }

  menuPanel.appendChild(collapsible);
  container.appendChild(menuPanel);

  // Wire up panel features
  makeDraggable(menuPanel);
  makeCollapsible(menuPanel);
  makeResizable(menuPanel);

  // Scale buttons
  var currentScale = 1.0;
  var decreaseBtn = menuPanel.querySelector('.font-decrease');
  var increaseBtn = menuPanel.querySelector('.font-increase');
  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale > 0.7) {
        currentScale = Math.round((currentScale - 0.1) * 10) / 10;
        menuPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
  if (increaseBtn) {
    increaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale < 1.5) {
        currentScale = Math.round((currentScale + 0.1) * 10) / 10;
        menuPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
}

function onMenuItemClick(key) {
  console.log('Menu:', key);
  // Will navigate to sub-pages later
}

function updateMenuPanelTheme(mode) {
  ensureMenuPanel();

  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.spectate;
  menuPanel.dataset.modeColor = cfg.color;

  // Dynamic style for pseudo-elements
  var styleId = 'menu-dynamic-style';
  var dynStyle = document.getElementById(styleId);
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = styleId;
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent =
    '#menu-panel .resize-handle::before {' +
    '  border-right-color: ' + cfg.color + ' !important;' +
    '  border-bottom-color: ' + cfg.color + ' !important;' +
    '}' +
    '#menu-panel:hover { border-color: ' + cfg.color + '66 !important; }';

  // Panel border
  menuPanel.style.borderColor = cfg.color + '33';
  menuPanel.style.borderLeft = '2px solid ' + cfg.color;

  // Title bar
  var titleBar = menuPanel.querySelector('.hud-title');
  if (titleBar) {
    titleBar.style.color = cfg.color;
    titleBar.style.borderBottomColor = cfg.color + '33';
    titleBar.style.background = 'rgba(0, 8, 16, 0.5)';

    var btns = titleBar.querySelectorAll('.font-btn, .collapse-btn, .grip');
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.color = cfg.color;
    }
  }
}

// ---------------------------------------------------------------------------
// Controls Panel — bottom-left, shows keybindings per mode
// ---------------------------------------------------------------------------

function ensureControlsPanel() {
  if (modeControlsPanel) return;

  modeControlsPanel = document.createElement('div');
  modeControlsPanel.id = 'mode-controls-panel';
  modeControlsPanel.className = 'hud-panel';
  Object.assign(modeControlsPanel.style, {
    bottom: '10px',
    left: '10px',
    width: '240px',
    right: 'auto',
    top: 'auto',
    transition: 'border-color 0.3s ease',
    background: 'rgba(0, 10, 20, 0.7)',
    backdropFilter: 'blur(4px)',
    transformOrigin: 'bottom left',
  });

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.innerHTML = titleBarHTML('Controls');
  modeControlsPanel.appendChild(title);

  // Collapsible content
  var content = document.createElement('div');
  content.className = 'hud-collapsible';
  content.id = 'mode-controls-content';
  content.style.padding = '8px 10px';
  modeControlsPanel.appendChild(content);

  container.appendChild(modeControlsPanel);

  // Wire up panel features
  makeDraggable(modeControlsPanel);
  makeCollapsible(modeControlsPanel);
  makeResizable(modeControlsPanel);

  // Font scaling — targets the entire panel, not just content
  var currentScale = 1.0;
  var minScale = 0.7;
  var maxScale = 1.5;
  var stepScale = 0.1;

  var decreaseBtn = modeControlsPanel.querySelector('.font-decrease');
  var increaseBtn = modeControlsPanel.querySelector('.font-increase');

  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale > minScale) {
        currentScale = Math.round((currentScale - stepScale) * 10) / 10;
        modeControlsPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
  if (increaseBtn) {
    increaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale < maxScale) {
        currentScale = Math.round((currentScale + stepScale) * 10) / 10;
        modeControlsPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
}

function updateControlsPanel(mode) {
  ensureControlsPanel();

  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.spectate;
  var controls = MODE_CONTROLS[mode] || [];

  // --- Dynamic style for pseudo-elements we can't reach via JS ---
  var styleId = 'mode-controls-dynamic-style';
  var dynStyle = document.getElementById(styleId);
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = styleId;
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent =
    '#mode-controls-panel .resize-handle::before {' +
    '  border-right-color: ' + cfg.color + ' !important;' +
    '  border-bottom-color: ' + cfg.color + ' !important;' +
    '}' +
    '#mode-controls-panel:hover { border-color: ' + cfg.color + '66 !important; }';

  // --- Theme the panel border ---
  modeControlsPanel.style.borderColor = cfg.color + '33';
  modeControlsPanel.style.borderLeft = '2px solid ' + cfg.color;

  // --- Theme the title bar ---
  var titleBar = modeControlsPanel.querySelector('.hud-title');
  if (titleBar) {
    titleBar.style.color = cfg.color;
    titleBar.style.borderBottomColor = cfg.color + '33';
    titleBar.style.background = 'rgba(0, 8, 16, 0.5)';
    titleBar.style.transition = 'color 0.3s ease, border-bottom-color 0.3s ease';

    var btns = titleBar.querySelectorAll('.font-btn, .collapse-btn, .grip');
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.color = cfg.color;
    }
  }

  // Update title text
  var titleEl = modeControlsPanel.querySelector('.hud-title > span:first-child');
  if (titleEl) titleEl.textContent = cfg.icon + '  ' + cfg.label + ' Controls';

  // Build content rows
  var content = document.getElementById('mode-controls-content');
  if (!content) return;

  var html = '';
  for (var i = 0; i < controls.length; i++) {
    var c = controls[i];
    html += '<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;">' +
      '<span style="color:' + cfg.color + ';opacity:0.9;white-space:nowrap;font-size:11px;">' + c.key + '</span>' +
      '<span style="color:#8899aa;text-align:right;font-size:11px;">' + c.desc + '</span>' +
      '</div>';
  }

  content.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Information Panel — bottom-right, shows selected object details
// ---------------------------------------------------------------------------

function ensureInfoPanel() {
  if (modeInfoPanel) return;

  modeInfoPanel = document.createElement('div');
  modeInfoPanel.id = 'mode-info-panel';
  modeInfoPanel.className = 'hud-panel';
  Object.assign(modeInfoPanel.style, {
    bottom: '10px',
    right: '10px',
    width: '260px',
    left: 'auto',
    top: 'auto',
    transition: 'border-color 0.3s ease',
    background: 'rgba(0, 10, 20, 0.7)',
    backdropFilter: 'blur(4px)',
    transformOrigin: 'bottom right',
  });

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.style.transition = 'color 0.3s ease, border-bottom-color 0.3s ease';
  title.innerHTML = titleBarHTML('Information');
  modeInfoPanel.appendChild(title);

  // Collapsible content
  var content = document.createElement('div');
  content.className = 'hud-collapsible';
  content.id = 'mode-info-content';
  content.style.padding = '8px 10px';
  modeInfoPanel.appendChild(content);

  container.appendChild(modeInfoPanel);

  // Wire up panel features
  makeDraggable(modeInfoPanel);
  makeCollapsible(modeInfoPanel);
  makeResizable(modeInfoPanel);

  // Font scaling — whole panel
  var currentScale = 1.0;
  var minScale = 0.7;
  var maxScale = 1.5;
  var stepScale = 0.1;

  var decreaseBtn = modeInfoPanel.querySelector('.font-decrease');
  var increaseBtn = modeInfoPanel.querySelector('.font-increase');

  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale > minScale) {
        currentScale = Math.round((currentScale - stepScale) * 10) / 10;
        modeInfoPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
  if (increaseBtn) {
    increaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale < maxScale) {
        currentScale = Math.round((currentScale + stepScale) * 10) / 10;
        modeInfoPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }

  // Show default empty state
  setInfoContent(null);
}

function updateInfoPanelTheme(mode) {
  ensureInfoPanel();

  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.spectate;

  // Dynamic style for pseudo-elements
  var styleId = 'mode-info-dynamic-style';
  var dynStyle = document.getElementById(styleId);
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = styleId;
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent =
    '#mode-info-panel .resize-handle::before {' +
    '  border-right-color: ' + cfg.color + ' !important;' +
    '  border-bottom-color: ' + cfg.color + ' !important;' +
    '  border-left-color: ' + cfg.color + ' !important;' +
    '}' +
    '#mode-info-panel .resize-handle {' +
    '  right: auto; left: 0; cursor: nesw-resize;' +
    '}' +
    '#mode-info-panel .resize-handle::before {' +
    '  right: auto; left: 2px;' +
    '  border-right: none;' +
    '  border-left: 2px solid ' + cfg.color + ';' +
    '  border-bottom: 2px solid ' + cfg.color + ';' +
    '}' +
    '#mode-info-panel:hover { border-color: ' + cfg.color + '66 !important; }';

  // Panel border
  modeInfoPanel.style.borderColor = cfg.color + '33';
  modeInfoPanel.style.borderRight = '2px solid ' + cfg.color;

  // Title bar
  var titleBar = modeInfoPanel.querySelector('.hud-title');
  if (titleBar) {
    titleBar.style.color = cfg.color;
    titleBar.style.borderBottomColor = cfg.color + '33';
    titleBar.style.background = 'rgba(0, 8, 16, 0.5)';

    var btns = titleBar.querySelectorAll('.font-btn, .collapse-btn, .grip');
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.color = cfg.color;
    }
  }
}

/**
 * Update the info panel content.
 * Pass null to show the empty/default state.
 * Pass an object to show details:
 *   { type, id, name, properties: [{label, value}], status }
 *
 * @param {object|null} data
 */
export function setInfoContent(data) {
  ensureInfoPanel();

  var content = document.getElementById('mode-info-content');
  if (!content) return;

  if (!data) {
    content.innerHTML =
      '<div style="color:#556677;font-style:italic;padding:8px 0;text-align:center;font-size:11px;">' +
      'No selection' +
      '</div>';
    return;
  }

  var html = '';

  // Header: type + ID
  if (data.type || data.id) {
    html += '<div style="display:flex;justify-content:space-between;padding:2px 0 6px 0;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:6px;">';
    if (data.type) html += '<span style="color:#aabbcc;font-size:10px;text-transform:uppercase;letter-spacing:1px;">' + data.type + '</span>';
    if (data.id) html += '<span style="color:#667788;font-size:10px;font-family:monospace;">' + data.id + '</span>';
    html += '</div>';
  }

  // Name
  if (data.name) {
    html += '<div style="color:#ddeeff;font-size:13px;font-weight:600;margin-bottom:6px;">' + data.name + '</div>';
  }

  // Properties
  if (data.properties && data.properties.length) {
    for (var i = 0; i < data.properties.length; i++) {
      var p = data.properties[i];
      html += '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;">' +
        '<span style="color:#667788;font-size:11px;">' + p.label + '</span>' +
        '<span style="color:#aabbcc;font-size:11px;text-align:right;">' + p.value + '</span>' +
        '</div>';
    }
  }

  // Status
  if (data.status) {
    var statusColor = data.status === 'active' ? '#44cc66' :
                      data.status === 'idle' ? '#ccaa33' :
                      data.status === 'error' ? '#cc4444' : '#667788';
    html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);">' +
      '<span style="color:#667788;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Status</span>' +
      '<span style="float:right;color:' + statusColor + ';font-size:11px;font-weight:600;">' + data.status + '</span>' +
      '</div>';
  }

  content.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Registry Panel — top-right, master directory of all world objects
// ---------------------------------------------------------------------------

var REGISTRY_TABS = [
  { key: 'zones',      label: 'Zones',      icon: '◫' },
  { key: 'stationary', label: 'Stationary',  icon: '⚙' },
  { key: 'mobile',     label: 'Mobile',      icon: '⇄' },
  { key: 'products',   label: 'Products',    icon: '◉' },
];

function ensureRegistryPanel() {
  if (registryPanel) return;

  registryPanel = document.createElement('div');
  registryPanel.id = 'registry-panel';
  registryPanel.className = 'hud-panel';
  Object.assign(registryPanel.style, {
    top: '10px',
    right: '10px',
    width: '280px',
    left: 'auto',
    bottom: 'auto',
    transition: 'border-color 0.3s ease',
    background: 'rgba(0, 10, 20, 0.7)',
    backdropFilter: 'blur(4px)',
    transformOrigin: 'top right',
  });

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.style.transition = 'color 0.3s ease, border-bottom-color 0.3s ease';
  title.innerHTML = titleBarHTML('Registry');
  registryPanel.appendChild(title);

  // Collapsible wrapper
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';
  collapsible.id = 'registry-collapsible';

  // Tab bar
  var tabBar = document.createElement('div');
  tabBar.id = 'registry-tab-bar';
  Object.assign(tabBar.style, {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  });
  collapsible.appendChild(tabBar);

  // Filter input
  var filterWrap = document.createElement('div');
  filterWrap.style.cssText = 'padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);';
  var filterInput = document.createElement('input');
  filterInput.id = 'registry-filter';
  filterInput.type = 'text';
  filterInput.placeholder = 'Filter...';
  filterInput.style.cssText = 'width:100%;box-sizing:border-box;background:rgba(0,8,16,0.6);border:1px solid rgba(255,255,255,0.1);' +
    'border-radius:3px;padding:4px 8px;color:#aabbcc;font-family:inherit;font-size:11px;outline:none;';
  filterInput.addEventListener('input', function() {
    registryFilter = filterInput.value.toLowerCase();
    renderRegistryList();
  });
  filterInput.addEventListener('focus', function() {
    filterInput.style.borderColor = 'rgba(255,255,255,0.25)';
  });
  filterInput.addEventListener('blur', function() {
    filterInput.style.borderColor = 'rgba(255,255,255,0.1)';
  });
  filterWrap.appendChild(filterInput);
  collapsible.appendChild(filterWrap);

  // List container
  var list = document.createElement('div');
  list.id = 'registry-list';
  list.style.cssText = 'max-height:300px;overflow-y:auto;padding:4px 0;';
  collapsible.appendChild(list);

  // Summary bar
  var summary = document.createElement('div');
  summary.id = 'registry-summary';
  summary.style.cssText = 'padding:4px 8px;border-top:1px solid rgba(255,255,255,0.06);font-size:10px;color:#556677;text-align:center;';
  collapsible.appendChild(summary);

  registryPanel.appendChild(collapsible);
  container.appendChild(registryPanel);

  // Wire up panel features
  makeDraggable(registryPanel);
  makeCollapsible(registryPanel);
  makeResizable(registryPanel);

  // Scale buttons
  var currentScale = 1.0;
  var decreaseBtn = registryPanel.querySelector('.font-decrease');
  var increaseBtn = registryPanel.querySelector('.font-increase');
  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale > 0.7) {
        currentScale = Math.round((currentScale - 0.1) * 10) / 10;
        registryPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
  if (increaseBtn) {
    increaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale < 1.5) {
        currentScale = Math.round((currentScale + 0.1) * 10) / 10;
        registryPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }

  // Build tabs
  buildRegistryTabs();

  // Scrollbar styling
  injectRegistryScrollStyle();
}

function injectRegistryScrollStyle() {
  var styleId = 'registry-scroll-style';
  if (document.getElementById(styleId)) return;
  var style = document.createElement('style');
  style.id = styleId;
  style.textContent =
    '#registry-list::-webkit-scrollbar { width: 5px; }' +
    '#registry-list::-webkit-scrollbar-track { background: rgba(0,8,16,0.3); }' +
    '#registry-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }' +
    '#registry-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }' +
    '#registry-list { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) rgba(0,8,16,0.3); }' +
    '#registry-filter::placeholder { color: #445566; }';
  document.head.appendChild(style);
}

function buildRegistryTabs() {
  var tabBar = document.getElementById('registry-tab-bar');
  if (!tabBar) return;
  tabBar.innerHTML = '';

  for (var i = 0; i < REGISTRY_TABS.length; i++) {
    (function(tab) {
      var btn = document.createElement('div');
      btn.className = 'registry-tab';
      btn.dataset.tab = tab.key;
      btn.title = tab.label;
      btn.textContent = tab.icon + ' ' + tab.label;
      Object.assign(btn.style, {
        flex: '1',
        textAlign: 'center',
        padding: '5px 2px',
        fontSize: '10px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        color: '#556677',
        borderBottom: '2px solid transparent',
        userSelect: 'none',
      });
      btn.addEventListener('click', function() {
        registryActiveTab = tab.key;
        registryFilter = '';
        var filterInput = document.getElementById('registry-filter');
        if (filterInput) filterInput.value = '';
        highlightActiveTab();
        renderRegistryList();
      });
      btn.addEventListener('mouseenter', function() {
        if (registryActiveTab !== tab.key) btn.style.color = '#8899aa';
      });
      btn.addEventListener('mouseleave', function() {
        if (registryActiveTab !== tab.key) btn.style.color = '#556677';
      });
      tabBar.appendChild(btn);
    })(REGISTRY_TABS[i]);
  }

  highlightActiveTab();
}

function highlightActiveTab() {
  var tabBar = document.getElementById('registry-tab-bar');
  if (!tabBar) return;
  var tabs = tabBar.children;
  var accentColor = registryPanel ? (registryPanel.dataset.modeColor || '#6699ff') : '#6699ff';

  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    if (tab.dataset.tab === registryActiveTab) {
      tab.style.color = accentColor;
      tab.style.borderBottomColor = accentColor;
    } else {
      tab.style.color = '#556677';
      tab.style.borderBottomColor = 'transparent';
    }
  }
}

function renderRegistryList() {
  var list = document.getElementById('registry-list');
  var summary = document.getElementById('registry-summary');
  if (!list) return;

  var items = registryData[registryActiveTab] || [];
  var accentColor = registryPanel ? (registryPanel.dataset.modeColor || '#6699ff') : '#6699ff';

  // Apply filter
  var filtered = items;
  if (registryFilter) {
    filtered = [];
    for (var i = 0; i < items.length; i++) {
      var searchText = (items[i].id + ' ' + items[i].label + ' ' + (items[i].type || '') + ' ' + (items[i].status || '')).toLowerCase();
      if (searchText.indexOf(registryFilter) !== -1) {
        filtered.push(items[i]);
      }
    }
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div style="color:#445566;font-style:italic;padding:16px 8px;text-align:center;font-size:11px;">' +
      (registryFilter ? 'No matches' : 'Empty') + '</div>';
    if (summary) summary.textContent = '0 items';
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var item = filtered[i];
    var itemColor = item.color || accentColor;
    var statusDot = '';
    if (item.status) {
      var dotColor = item.status === 'active' ? '#44cc66' :
                     item.status === 'idle' ? '#ccaa33' :
                     item.status === 'error' ? '#cc4444' : '#556677';
      statusDot = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin-right:4px;"></span>';
    }

    html += '<div class="registry-item" data-id="' + item.id + '" style="' +
      'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;cursor:pointer;' +
      'transition:background 0.15s ease;border-left:2px solid transparent;' +
      '" onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\';this.style.borderLeftColor=\'' + itemColor + '\';" ' +
      'onmouseleave="this.style.background=\'transparent\';this.style.borderLeftColor=\'transparent\';">' +

      '<div style="display:flex;flex-direction:column;gap:1px;overflow:hidden;">' +
        '<span style="color:#aabbcc;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          statusDot + item.label +
        '</span>' +
        '<span style="color:#445566;font-size:9px;font-family:monospace;">' + item.id + (item.type ? ' · ' + item.type : '') + '</span>' +
      '</div>' +

      (item.color ? '<div style="width:10px;height:10px;border-radius:2px;background:' + item.color + ';opacity:0.6;flex-shrink:0;margin-left:8px;"></div>' : '') +

    '</div>';
  }

  list.innerHTML = html;

  // Wire up click handlers
  var rows = list.querySelectorAll('.registry-item');
  for (var r = 0; r < rows.length; r++) {
    rows[r].addEventListener('click', function() {
      var itemId = this.dataset.id;
      onRegistryItemClick(itemId, registryActiveTab);
    });
  }

  if (summary) {
    summary.textContent = filtered.length + (filtered.length !== items.length ? ' / ' + items.length : '') + ' items';
  }
}

function onRegistryItemClick(itemId, category) {
  console.log('Registry click:', category, itemId);
  // Will wire up to selection / info panel later
}

function updateRegistryPanelTheme(mode) {
  ensureRegistryPanel();

  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.spectate;
  registryPanel.dataset.modeColor = cfg.color;

  // Dynamic style for pseudo-elements
  var styleId = 'registry-dynamic-style';
  var dynStyle = document.getElementById(styleId);
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = styleId;
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent =
    '#registry-panel .resize-handle::before {' +
    '  border-right-color: ' + cfg.color + ' !important;' +
    '  border-bottom-color: ' + cfg.color + ' !important;' +
    '}' +
    '#registry-panel:hover { border-color: ' + cfg.color + '66 !important; }';

  // Panel border
  registryPanel.style.borderColor = cfg.color + '33';
  registryPanel.style.borderRight = '2px solid ' + cfg.color;

  // Title bar
  var titleBar = registryPanel.querySelector('.hud-title');
  if (titleBar) {
    titleBar.style.color = cfg.color;
    titleBar.style.borderBottomColor = cfg.color + '33';
    titleBar.style.background = 'rgba(0, 8, 16, 0.5)';

    var btns = titleBar.querySelectorAll('.font-btn, .collapse-btn, .grip');
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.color = cfg.color;
    }
  }

  // Filter input accent
  var filterInput = document.getElementById('registry-filter');
  if (filterInput) {
    filterInput.addEventListener('focus', function() {
      this.style.borderColor = cfg.color + '66';
    });
  }

  // Re-highlight tabs with new color
  highlightActiveTab();
  renderRegistryList();
}

/**
 * Push data into a registry tab.
 * Items should be: [{ id, label, type?, color?, status? }]
 *
 * @param {string} category - 'zones', 'stationary', 'mobile', or 'products'
 * @param {object[]} items
 */
export function setRegistryData(category, items) {
  registryData[category] = items || [];
  if (registryActiveTab === category) {
    renderRegistryList();
  }
}

/**
 * Convenience: rebuild the zone tab from the floorplan registry.
 * Call this after any zone changes.
 */
export function refreshZoneRegistry(allZones) {
  var items = [];
  for (var i = 0; i < allZones.length; i++) {
    var z = allZones[i];
    var entry = z;
    items.push({
      id: entry.id,
      label: entry.meta && entry.meta.label ? entry.meta.label : (entry.type || 'Zone'),
      type: entry.type ? entry.type.replace('zone:', '') : '',
      color: entry.meta && entry.meta.color ? entry.meta.color : null,
    });
  }
  setRegistryData('zones', items);
}

/**
 * Get the currently active registry tab.
 * @returns {string}
 */
export function getRegistryActiveTab() {
  return registryActiveTab;
}

// ---------------------------------------------------------------------------
// World Clock Panel — top-center, simulation time + speed + FPS
// ---------------------------------------------------------------------------

var SPEED_BUTTONS = [
  { label: '⏸', speed: 0, title: 'Pause' },
  { label: '▶', speed: 1, title: 'Play (1×)' },
];

var SPEED_FF_OPTIONS = [
  { label: '2×', speed: 2 },
  { label: '5×', speed: 5 },
  { label: '10×', speed: 10 },
  { label: '50×', speed: 50 },
  { label: '100×', speed: 100 },
  { label: '1000×', speed: 1000 },
];

function ensureWorldClockPanel() {
  if (worldClockPanel) return;

  worldClockPanel = document.createElement('div');
  worldClockPanel.id = 'world-clock-panel';
  worldClockPanel.className = 'hud-panel';
  Object.assign(worldClockPanel.style, {
    top: '10px',
    left: '0',
    right: '0',
    marginLeft: 'auto',
    marginRight: 'auto',
    width: 'fit-content',
    bottom: 'auto',
    transition: 'border-color 0.3s ease',
    background: 'rgba(0, 10, 20, 0.7)',
    backdropFilter: 'blur(4px)',
    transformOrigin: 'top center',
  });

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.style.transition = 'color 0.3s ease, border-bottom-color 0.3s ease';
  title.innerHTML = titleBarHTML('World Clock');
  worldClockPanel.appendChild(title);

  // Collapsible content — single horizontal row
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';
  collapsible.style.padding = '0';

  var mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex;align-items:center;gap:0;padding:8px 10px;';

  // --- LEFT: Clock time + speed text ---
  var clockSection = document.createElement('div');
  clockSection.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:0 10px 0 4px;';

  clockTimeEl = document.createElement('span');
  clockTimeEl.id = 'clock-time';
  clockTimeEl.style.cssText = 'font-size:18px;font-weight:600;letter-spacing:2px;color:#ddeeff;font-family:monospace;white-space:nowrap;';
  clockTimeEl.textContent = '00:00:00';
  clockSection.appendChild(clockTimeEl);

  clockDateEl = document.createElement('span');
  clockDateEl.id = 'clock-date';
  clockDateEl.style.cssText = 'font-size:10px;color:#667788;letter-spacing:0.5px;white-space:nowrap;';
  clockDateEl.textContent = '01 Jan 0000';
  clockSection.appendChild(clockDateEl);

  clockSpeedEl = document.createElement('span');
  clockSpeedEl.id = 'clock-speed';
  clockSpeedEl.style.cssText = 'font-size:10px;letter-spacing:1px;white-space:nowrap;font-weight:600;';
  clockSpeedEl.textContent = 'LIVE';
  clockSection.appendChild(clockSpeedEl);

  mainRow.appendChild(clockSection);

  // --- Vertical separator ---
  var sep1 = document.createElement('div');
  sep1.style.cssText = 'width:1px;height:30px;background:rgba(255,255,255,0.08);flex-shrink:0;';
  mainRow.appendChild(sep1);

  // --- MIDDLE: Speed control buttons ---
  var speedSection = document.createElement('div');
  speedSection.id = 'clock-speed-row';
  speedSection.style.cssText = 'display:flex;align-items:center;gap:3px;padding:0 10px;';

  // Pause and Play buttons
  for (var i = 0; i < SPEED_BUTTONS.length; i++) {
    (function(preset) {
      var btn = document.createElement('div');
      btn.className = 'clock-speed-btn';
      btn.dataset.speed = String(preset.speed);
      btn.title = preset.title;
      btn.textContent = preset.label;
      Object.assign(btn.style, {
        padding: '4px 7px',
        fontSize: '10px',
        cursor: 'pointer',
        borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0, 8, 16, 0.4)',
        color: '#667788',
        transition: 'all 0.15s ease',
        userSelect: 'none',
        lineHeight: '1',
      });
      btn.addEventListener('click', function() {
        if (preset.speed === 0) {
          togglePause();
        } else {
          if (getPaused()) resume();
          setSpeed(preset.speed);
        }
        updateClockSpeedButtons();
      });
      btn.addEventListener('mouseenter', function() {
        btn.style.background = 'rgba(255,255,255,0.06)';
      });
      btn.addEventListener('mouseleave', function() {
        updateClockSpeedButtons();
      });
      speedSection.appendChild(btn);
    })(SPEED_BUTTONS[i]);
  }

  // Fast-forward dropdown
  var ffWrap = document.createElement('div');
  ffWrap.style.cssText = 'position:relative;';

  var ffBtn = document.createElement('div');
  ffBtn.className = 'clock-speed-btn clock-ff-btn';
  ffBtn.title = 'Fast forward';
  ffBtn.textContent = 'Fast Forward ▾';
  Object.assign(ffBtn.style, {
    padding: '4px 7px',
    fontSize: '10px',
    cursor: 'pointer',
    borderRadius: '3px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0, 8, 16, 0.4)',
    color: '#667788',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    lineHeight: '1',
    letterSpacing: '0.5px',
  });

  var ffMenu = document.createElement('div');
  ffMenu.id = 'clock-ff-menu';
  Object.assign(ffMenu.style, {
    position: 'fixed',
    display: 'none',
    flexDirection: 'column',
    gap: '2px',
    background: 'rgba(0, 10, 20, 0.92)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    padding: '3px',
    zIndex: '9999',
    minWidth: '52px',
    backdropFilter: 'blur(6px)',
    pointerEvents: 'auto',
  });

  for (var f = 0; f < SPEED_FF_OPTIONS.length; f++) {
    (function(opt) {
      var item = document.createElement('div');
      item.className = 'clock-ff-item';
      item.dataset.speed = String(opt.speed);
      item.textContent = opt.label;
      Object.assign(item.style, {
        padding: '3px 8px',
        fontSize: '10px',
        cursor: 'pointer',
        borderRadius: '2px',
        color: '#8899aa',
        textAlign: 'center',
        transition: 'all 0.12s ease',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      });
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        if (getPaused()) resume();
        setSpeed(opt.speed);
        ffMenu.style.display = 'none';
        updateClockSpeedButtons();
      });
      item.addEventListener('mouseenter', function() {
        item.style.background = 'rgba(255,255,255,0.06)';
        item.style.color = '#ddeeff';
      });
      item.addEventListener('mouseleave', function() {
        item.style.background = 'transparent';
        item.style.color = '#8899aa';
      });
      ffMenu.appendChild(item);
    })(SPEED_FF_OPTIONS[f]);
  }

  ffWrap.appendChild(ffBtn);
  document.body.appendChild(ffMenu);

  // Toggle dropdown on click — position below button using fixed coords
  ffBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var showing = ffMenu.style.display === 'flex';
    if (showing) {
      ffMenu.style.display = 'none';
    } else {
      var rect = ffBtn.getBoundingClientRect();
      ffMenu.style.left = rect.left + 'px';
      ffMenu.style.top = (rect.bottom + 4) + 'px';
      ffMenu.style.display = 'flex';
    }
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener('click', function() {
    ffMenu.style.display = 'none';
  });

  speedSection.appendChild(ffWrap);

  mainRow.appendChild(speedSection);

  // --- Vertical separator ---
  var sep2 = document.createElement('div');
  sep2.style.cssText = 'width:1px;height:30px;background:rgba(255,255,255,0.08);flex-shrink:0;';
  mainRow.appendChild(sep2);

  // --- Mode indicator badge ---
  var modeBadge = document.createElement('span');
  modeBadge.id = 'clock-mode-badge';
  modeBadge.style.cssText = 'font-size:10px;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap;padding:0 10px;color:#667788;';
  modeBadge.textContent = '◆ BUILD';
  mainRow.appendChild(modeBadge);

  // --- Vertical separator ---
  var sep3 = document.createElement('div');
  sep3.style.cssText = 'width:1px;height:30px;background:rgba(255,255,255,0.08);flex-shrink:0;';
  mainRow.appendChild(sep3);

  // --- RIGHT: FPS counter ---
  var fpsSection = document.createElement('div');
  fpsSection.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 4px 0 10px;';

  if (statsPanel && statsPanel.dom) {
    statsPanel.dom.style.cssText = 'position:relative !important;cursor:pointer !important;';
    statsPanel.dom.classList.add('fps-stats');
    fpsSection.appendChild(statsPanel.dom);

    // CSS rule to enforce canvas size without interfering with Stats.js show/hide
    var fpsStyleId = 'clock-fps-style';
    if (!document.getElementById(fpsStyleId)) {
      var fpsStyle = document.createElement('style');
      fpsStyle.id = fpsStyleId;
      fpsStyle.textContent =
        '.fps-stats canvas { width: 54px !important; height: 26px !important; }' +
        '.fps-stats > div { width: 54px !important; height: 26px !important; overflow: hidden !important; }';
      document.head.appendChild(fpsStyle);
    }
  }

  mainRow.appendChild(fpsSection);

  collapsible.appendChild(mainRow);

  worldClockPanel.appendChild(collapsible);
  container.appendChild(worldClockPanel);

  // Wire up panel features
  makeDraggable(worldClockPanel);
  makeCollapsible(worldClockPanel);
  makeResizable(worldClockPanel);

  // Scale buttons
  var currentScale = 1.0;
  var decreaseBtn = worldClockPanel.querySelector('.font-decrease');
  var increaseBtn = worldClockPanel.querySelector('.font-increase');
  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale > 0.7) {
        currentScale = Math.round((currentScale - 0.1) * 10) / 10;
        worldClockPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }
  if (increaseBtn) {
    increaseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentScale < 1.5) {
        currentScale = Math.round((currentScale + 0.1) * 10) / 10;
        worldClockPanel.style.transform = 'scale(' + currentScale + ')';
      }
    });
  }

  updateClockSpeedButtons();
}

function updateClockSpeedButtons() {
  var btns = document.querySelectorAll('.clock-speed-btn:not(.clock-ff-btn)');
  var paused = getPaused();
  var spd = getSpeed();
  var accentColor = worldClockPanel ? (worldClockPanel.dataset.modeColor || '#6699ff') : '#6699ff';

  // Check if current speed is a fast-forward speed
  var isFF = false;
  for (var f = 0; f < SPEED_FF_OPTIONS.length; f++) {
    if (!paused && spd === SPEED_FF_OPTIONS[f].speed) { isFF = true; break; }
  }

  // Regular buttons (pause, play)
  for (var i = 0; i < btns.length; i++) {
    var btnSpeed = parseFloat(btns[i].dataset.speed);
    var isActive = false;

    if (btnSpeed === 0 && paused) {
      isActive = true;
    } else if (btnSpeed > 0 && !paused && spd === btnSpeed) {
      isActive = true;
    }

    if (isActive) {
      btns[i].style.background = accentColor + '22';
      btns[i].style.borderColor = accentColor + '66';
      btns[i].style.color = accentColor;
    } else {
      btns[i].style.background = 'rgba(0, 8, 16, 0.4)';
      btns[i].style.borderColor = 'rgba(255,255,255,0.08)';
      btns[i].style.color = '#667788';
    }
  }

  // Fast-forward button
  var ffBtn = document.querySelector('.clock-ff-btn');
  if (ffBtn) {
    if (isFF) {
      ffBtn.style.background = accentColor + '22';
      ffBtn.style.borderColor = accentColor + '66';
      ffBtn.style.color = accentColor;
      ffBtn.textContent = formatSpeed(spd);
    } else {
      ffBtn.style.background = 'rgba(0, 8, 16, 0.4)';
      ffBtn.style.borderColor = 'rgba(255,255,255,0.08)';
      ffBtn.style.color = '#667788';
      ffBtn.textContent = 'Fast Forward ▾';
    }
  }
}

function updateWorldClockDisplay() {
  if (!worldClockPanel) return;

  var accentColor = worldClockPanel.dataset.modeColor || '#6699ff';

  // Time
  if (clockTimeEl) {
    clockTimeEl.textContent = formatTime(getTime());
  }

  // Date
  if (clockDateEl) {
    clockDateEl.textContent = formatDate(getTime());
  }

  // Speed / Pause indicator
  if (clockSpeedEl) {
    if (getPaused()) {
      clockSpeedEl.textContent = 'PAUSED';
      clockSpeedEl.style.color = '#cc4444';
    } else if (getSpeed() === 1) {
      clockSpeedEl.textContent = 'LIVE';
      clockSpeedEl.style.color = '#44cc66';
    } else {
      clockSpeedEl.textContent = formatSpeed(getSpeed());
      clockSpeedEl.style.color = accentColor;
    }
  }
}

function updateWorldClockTheme(mode) {
  ensureWorldClockPanel();

  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.spectate;
  worldClockPanel.dataset.modeColor = cfg.color;

  // Dynamic style
  var styleId = 'clock-dynamic-style';
  var dynStyle = document.getElementById(styleId);
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = styleId;
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent =
    '#world-clock-panel .resize-handle::before {' +
    '  border-right-color: ' + cfg.color + ' !important;' +
    '  border-bottom-color: ' + cfg.color + ' !important;' +
    '}' +
    '#world-clock-panel:hover { border-color: ' + cfg.color + '66 !important; }' +
    '#clock-ff-menu { border-color: ' + cfg.color + '33 !important; }';

  // Panel border
  worldClockPanel.style.borderColor = cfg.color + '33';
  worldClockPanel.style.borderTop = '2px solid ' + cfg.color;

  // Title bar
  var titleBar = worldClockPanel.querySelector('.hud-title');
  if (titleBar) {
    titleBar.style.color = cfg.color;
    titleBar.style.borderBottomColor = cfg.color + '33';
    titleBar.style.background = 'rgba(0, 8, 16, 0.5)';

    var btns = titleBar.querySelectorAll('.font-btn, .collapse-btn, .grip');
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.color = cfg.color;
    }
  }

  // Re-theme speed buttons
  updateClockSpeedButtons();

  // Update mode badge
  var modeBadge = document.getElementById('clock-mode-badge');
  if (modeBadge) {
    modeBadge.textContent = cfg.icon + '  ' + cfg.label.toUpperCase();
    modeBadge.style.color = cfg.color;
  }
}

/**
 * Show or update the mode indicator.
 * Center flash on change + updates controls, info, and registry panels.
 */
export function showModeIndicator(mode) {
  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.build;

  // Update controls panel
  updateControlsPanel(mode);

  // Update info panel theme
  updateInfoPanelTheme(mode);

  // Update registry panel theme
  updateRegistryPanelTheme(mode);

  // Update world clock theme
  updateWorldClockTheme(mode);

  // Update menu panel theme
  updateMenuPanelTheme(mode);

  // --- Center flash ---
  // Remove previous flash immediately
  if (modeFlash && modeFlash.parentNode) {
    modeFlash.parentNode.removeChild(modeFlash);
  }

  modeFlash = document.createElement('div');
  Object.assign(modeFlash.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) scale(0.9)',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', monospace",
    fontSize: '22px',
    fontWeight: '600',
    letterSpacing: '4px',
    color: cfg.color,
    textShadow: '0 0 20px ' + cfg.color + '66',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '30',
    transition: 'opacity 0.15s ease, transform 0.15s ease',
  });
  modeFlash.textContent = cfg.icon + '  ' + cfg.label;
  container.appendChild(modeFlash);

  // Animate in
  requestAnimationFrame(function() {
    if (modeFlash) {
      modeFlash.style.opacity = '1';
      modeFlash.style.transform = 'translate(-50%, -50%) scale(1)';
    }
  });

  // Clear previous timeout
  if (modeFlashTimeout) clearTimeout(modeFlashTimeout);

  // Fade out and remove
  modeFlashTimeout = setTimeout(function() {
    if (modeFlash) {
      modeFlash.style.opacity = '0';
      modeFlash.style.transform = 'translate(-50%, -50%) scale(1.05)';
      var ref = modeFlash;
      setTimeout(function() {
        if (ref.parentNode) ref.parentNode.removeChild(ref);
        if (modeFlash === ref) modeFlash = null;
      }, 200);
    }
  }, 800);
}

// ============================================================================
// RAYCASTING AND EVENT HANDLING
// ============================================================================

function onCanvasClick(event) {
  if (!camera || !scene) return;
  if (event.target !== renderer.domElement) return;

  var rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseVec, camera);
  var intersects = raycaster.intersectObjects(scene.children, true);

  if (intersects.length === 0) return;

  for (var i = 0; i < intersects.length; i++) {
    var hit = intersects[i];
    var obj = hit.object;

    if (obj.userData && obj.userData.registryId) {
      if (onObjectClickCallback) {
        onObjectClickCallback({
          type: obj.userData.registryType || 'unknown',
          id: obj.userData.registryId,
          point: hit.point,
          object: obj,
        });
      }
      return;
    }

    if (obj.userData && obj.userData.utilityId) {
      if (onObjectClickCallback) {
        onObjectClickCallback({
          type: 'utility',
          id: obj.userData.utilityId,
          utilityType: obj.userData.utilityType,
          point: hit.point,
        });
      }
      return;
    }

    if (obj.userData && obj.userData.visibilityCategory === 'zones') {
      var gridX = Math.floor(hit.point.x);
      var gridZ = Math.floor(hit.point.z);
      if (onGridClickCallback) {
        onGridClickCallback({ gridX: gridX, gridZ: gridZ, point: hit.point });
      }
      return;
    }

    if (obj.userData && obj.userData.visibilityCategory === 'walls') {
      if (onGridClickCallback) {
        var wx = obj.userData.gridX !== undefined ? obj.userData.gridX : Math.floor(hit.point.x);
        var wz = obj.userData.gridZ !== undefined ? obj.userData.gridZ : Math.floor(hit.point.z);
        onGridClickCallback({ gridX: wx, gridZ: wz, point: hit.point, isWall: true });
      }
      return;
    }
  }

  var fallbackHit = intersects[0];
  if (onGridClickCallback) {
    onGridClickCallback({
      gridX: Math.floor(fallbackHit.point.x),
      gridZ: Math.floor(fallbackHit.point.z),
      point: fallbackHit.point,
    });
  }
}

export function onObjectClick(callback) {
  onObjectClickCallback = callback;
}

export function onGridClick(callback) {
  onGridClickCallback = callback;
}

// ============================================================================
// CAMERA HELPERS
// ============================================================================

export function flyToPosition(x, y, z, distance) {
  flyTo(x, y, z, distance);
}

export function resetCamera() {
  resetView();
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export function getHUDContainer() {
  return container;
}

export function getContainer() {
  return container;
}