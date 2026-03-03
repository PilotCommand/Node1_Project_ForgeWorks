// ============================================================================
// visualhud.js — 3D Renderer, HUD, and Visibility Filter
// Forgeworks Infrastructure Tier 3
// ============================================================================
// Sets up Three.js renderer/scene/camera, manages all HUD panels, and
// implements the visibility filter system (thermal vision theme).
//
// Imports: worldclock.js, measurementunits.js
// Exports: Renderer setup, scene access, HUD panels, visibility filter
// ============================================================================

import * as THREE from 'three';
import { tick, getTime, getDelta, getSpeed, setSpeed, pause, resume, isPaused, formatTime } from './worldclock.js';
import { getDisplaySystem, setDisplaySystem } from './measurementunits.js';
import { initControls, update as updateControls, resetView, flyTo } from './controls.js';

// ---------------------------------------------------------------------------
// Visibility Filter Categories
// ---------------------------------------------------------------------------

const VISIBILITY_CATEGORIES = {
  furnaces:      { label: 'Furnaces',      registryType: 'furnace',      registry: 'static' },
  presses:       { label: 'Presses',       registryType: 'press',        registry: 'static' },
  hammers:       { label: 'Hammers',       registryType: 'hammer',       registry: 'static' },
  quenchTanks:   { label: 'Quench Tanks',  registryType: 'quench',       registry: 'static' },
  racks:         { label: 'Racks',         registryType: 'rack',         registry: 'static' },
  forklifts:     { label: 'Forklifts',     registryType: 'forklift',     registry: 'mobile' },
  manipulators:  { label: 'Manipulators',  registryType: 'manipulator',  registry: 'mobile' },
  trucks:        { label: 'Trucks',        registryType: 'truck',        registry: 'mobile' },
  tools:         { label: 'Tools/Dies',    registryType: 'tool',         registry: 'mobile' },
  products:      { label: 'Products',      registryType: 'metalpart',    registry: 'product' },
  zones:         { label: 'Floor Zones',   special: 'zones' },
  walls:         { label: 'Walls',         special: 'walls' },
  pathways:      { label: 'Pathways',      special: 'pathways' },
  utilities:     { label: 'Utilities',     special: 'utilities' },
};

// De-emphasized material for unchecked categories (thermal vision cold)
const deemphasizedMaterial = new THREE.MeshStandardMaterial({
  color: 0x0a1628,
  transparent: true,
  opacity: 0.20,
  roughness: 0.9,
  metalness: 0.1,
  depthWrite: false,
});

const deemphasizedLineMaterial = new THREE.LineBasicMaterial({
  color: 0x0a1628,
  transparent: true,
  opacity: 0.15,
});

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let renderer = null;
let scene = null;
let camera = null;
let container = null;
let animationFrameId = null;
let updateCallback = null;

// Filter state: all categories start checked (visible)
let filterState = {};
for (var cat in VISIBILITY_CATEGORIES) {
  filterState[cat] = true;
}

// Current mode
let currentMode = 'sandbox'; // sandbox, prediction, operating

// Raycasting
let raycaster = new THREE.Raycaster();
let mouseVec = new THREE.Vector2();

// Event callbacks
let onObjectClickCallback = null;
let onGridClickCallback = null;

// HUD DOM references
let hudContainer = null;
let modeSelector = null;
let timeDisplay = null;
let speedDisplay = null;
let filterPanel = null;
let infoPanel = null;
let productTrackerPanel = null;
let alertBar = null;
let statusBar = null;

// Grid dimensions (set during init)
let gridW = 60;
let gridH = 80;

// ---------------------------------------------------------------------------
// Renderer Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the Three.js renderer, scene, camera, and lighting.
 * Also builds the HUD DOM structure.
 *
 * @param {HTMLElement} containerElement - DOM element to mount the canvas
 * @param {number} [gw=60] - Grid width for camera setup
 * @param {number} [gd=80] - Grid depth for camera setup
 */
export function initRenderer(containerElement, gw, gd) {
  container = containerElement;
  gridW = gw || 60;
  gridH = gd || 80;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d0d);
  scene.fog = new THREE.Fog(0x0d0d0d, 80, 200);

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

  // Lighting — overhead factory lighting
  var ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
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

  var fillLight = new THREE.DirectionalLight(0x8899aa, 0.3);
  fillLight.position.set(-20, 30, -20);
  scene.add(fillLight);

  // Camera controls
  initControls(camera, renderer.domElement, gridW, gridH);

  // HUD
  buildHUD();

  // Window resize
  window.addEventListener('resize', onWindowResize);

  // Mouse click (raycasting)
  renderer.domElement.addEventListener('click', onCanvasClick);

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

/**
 * Start the animation/render loop.
 * @param {function} callback - Called each frame with delta time: callback(delta)
 */
export function startRenderLoop(callback) {
  updateCallback = callback;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  var lastTimestamp = performance.now();

  function loop(timestamp) {
    animationFrameId = requestAnimationFrame(loop);

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

    // Update HUD time display
    updateTimeDisplay();
  }

  animationFrameId = requestAnimationFrame(loop);
}

export function stopRenderLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ---------------------------------------------------------------------------
// HUD Construction
// ---------------------------------------------------------------------------

function buildHUD() {
  hudContainer = document.createElement('div');
  hudContainer.id = 'forgeworks-hud';
  hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;font-family:monospace;color:#ccc;font-size:13px;';
  container.appendChild(hudContainer);

  // --- Top Bar: Mode Selector + Time Controls ---
  var topBar = document.createElement('div');
  topBar.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;display:flex;justify-content:space-between;align-items:center;pointer-events:auto;';
  hudContainer.appendChild(topBar);

  // Mode selector
  var modeDiv = document.createElement('div');
  modeDiv.style.cssText = 'display:flex;gap:4px;background:rgba(20,20,30,0.85);padding:4px 8px;border-radius:4px;border:1px solid #333;';
  var modes = ['sandbox', 'prediction', 'operating'];
  for (var m = 0; m < modes.length; m++) {
    var btn = document.createElement('button');
    btn.textContent = modes[m].charAt(0).toUpperCase() + modes[m].slice(1);
    btn.dataset.mode = modes[m];
    btn.style.cssText = 'background:none;border:1px solid #555;color:#aaa;padding:4px 10px;border-radius:3px;cursor:pointer;font-family:monospace;font-size:12px;';
    btn.addEventListener('click', function(e) { setMode(e.target.dataset.mode); });
    modeDiv.appendChild(btn);
  }
  modeSelector = modeDiv;
  topBar.appendChild(modeDiv);

  // Time controls
  var timeDiv = document.createElement('div');
  timeDiv.style.cssText = 'display:flex;align-items:center;gap:6px;background:rgba(20,20,30,0.85);padding:4px 8px;border-radius:4px;border:1px solid #333;';

  var pauseBtn = document.createElement('button');
  pauseBtn.textContent = '||';
  pauseBtn.title = 'Pause/Resume';
  pauseBtn.style.cssText = 'background:none;border:1px solid #555;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-family:monospace;';
  pauseBtn.addEventListener('click', function() { if (isPaused()) resume(); else pause(); });
  timeDiv.appendChild(pauseBtn);

  var speedBtns = [0.5, 1, 2, 5, 10];
  for (var s = 0; s < speedBtns.length; s++) {
    var sBtn = document.createElement('button');
    sBtn.textContent = speedBtns[s] + 'x';
    sBtn.dataset.speed = speedBtns[s];
    sBtn.style.cssText = 'background:none;border:1px solid #444;color:#888;padding:2px 6px;border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;';
    sBtn.addEventListener('click', function(e) { setSpeed(parseFloat(e.target.dataset.speed)); });
    timeDiv.appendChild(sBtn);
  }

  timeDisplay = document.createElement('span');
  timeDisplay.style.cssText = 'color:#66ccff;min-width:80px;text-align:right;';
  timeDisplay.textContent = '00:00:00';
  timeDiv.appendChild(timeDisplay);

  speedDisplay = document.createElement('span');
  speedDisplay.style.cssText = 'color:#888;font-size:11px;';
  speedDisplay.textContent = '1.0x';
  timeDiv.appendChild(speedDisplay);

  var resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset View';
  resetBtn.style.cssText = 'background:none;border:1px solid #555;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;margin-left:8px;';
  resetBtn.addEventListener('click', function() { resetView(); });
  timeDiv.appendChild(resetBtn);

  topBar.appendChild(timeDiv);

  // --- Right Panel: Visibility Filter ---
  buildFilterPanel();

  // --- Bottom-Left: Info Panel ---
  infoPanel = document.createElement('div');
  infoPanel.style.cssText = 'position:absolute;bottom:40px;left:8px;width:280px;max-height:300px;overflow-y:auto;background:rgba(20,20,30,0.9);border:1px solid #333;border-radius:4px;padding:8px;display:none;pointer-events:auto;';
  hudContainer.appendChild(infoPanel);

  // --- Bottom-Center: Product Tracker ---
  productTrackerPanel = document.createElement('div');
  productTrackerPanel.style.cssText = 'position:absolute;bottom:40px;left:300px;right:240px;max-height:200px;overflow-y:auto;background:rgba(20,20,30,0.9);border:1px solid #333;border-radius:4px;padding:8px;display:none;pointer-events:auto;';
  hudContainer.appendChild(productTrackerPanel);

  // --- Alert Bar ---
  alertBar = document.createElement('div');
  alertBar.style.cssText = 'position:absolute;top:50px;left:50%;transform:translateX(-50%);background:rgba(180,50,30,0.9);color:#fff;padding:6px 16px;border-radius:4px;display:none;pointer-events:auto;font-size:12px;';
  hudContainer.appendChild(alertBar);

  // --- Status Bar ---
  statusBar = document.createElement('div');
  statusBar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:30px;background:rgba(15,15,20,0.95);border-top:1px solid #333;display:flex;align-items:center;padding:0 12px;gap:20px;font-size:11px;color:#777;pointer-events:auto;';
  hudContainer.appendChild(statusBar);
}

// ---------------------------------------------------------------------------
// Visibility Filter Panel
// ---------------------------------------------------------------------------

function buildFilterPanel() {
  filterPanel = document.createElement('div');
  filterPanel.style.cssText = 'position:absolute;top:50px;right:8px;width:180px;background:rgba(20,20,30,0.9);border:1px solid #333;border-radius:4px;padding:8px;pointer-events:auto;';
  hudContainer.appendChild(filterPanel);

  var title = document.createElement('div');
  title.textContent = 'Visibility';
  title.style.cssText = 'color:#88aacc;font-size:12px;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #333;padding-bottom:4px;';
  filterPanel.appendChild(title);

  // Quick controls
  var quickDiv = document.createElement('div');
  quickDiv.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;';

  var quickBtns = [
    { label: 'All', action: function() { setAllVisible(true); } },
    { label: 'None', action: function() { setAllVisible(false); } },
    { label: 'Products', action: function() { setAllVisible(false); setVisibilityFilter('products', true); setVisibilityFilter('zones', true); } },
    { label: 'Equip', action: function() { setAllVisible(false); var eqCats = ['furnaces','presses','hammers','quenchTanks','racks']; for (var i=0;i<eqCats.length;i++) setVisibilityFilter(eqCats[i], true); setVisibilityFilter('zones', true); } },
  ];

  for (var q = 0; q < quickBtns.length; q++) {
    var qBtn = document.createElement('button');
    qBtn.textContent = quickBtns[q].label;
    qBtn.style.cssText = 'background:none;border:1px solid #444;color:#888;padding:1px 6px;border-radius:2px;cursor:pointer;font-family:monospace;font-size:10px;';
    qBtn.addEventListener('click', quickBtns[q].action);
    quickDiv.appendChild(qBtn);
  }
  filterPanel.appendChild(quickDiv);

  // Category checkboxes
  var categoryColors = {
    furnaces: '#ff6600', presses: '#999999', hammers: '#cc9933',
    quenchTanks: '#3366cc', racks: '#669933', forklifts: '#cccc33',
    manipulators: '#cc6633', trucks: '#666666', tools: '#996699',
    products: '#ff4400', zones: '#3399ff', walls: '#444444',
    pathways: '#cccccc', utilities: '#ffff00',
  };

  var cats = Object.keys(VISIBILITY_CATEGORIES);
  for (var c = 0; c < cats.length; c++) {
    var catKey = cats[c];
    var catDef = VISIBILITY_CATEGORIES[catKey];

    var row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:2px 0;cursor:pointer;font-size:11px;';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.category = catKey;
    cb.style.cssText = 'margin:0;cursor:pointer;';
    cb.addEventListener('change', function(e) {
      setVisibilityFilter(e.target.dataset.category, e.target.checked);
    });
    row.appendChild(cb);

    var dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (categoryColors[catKey] || '#888') + ';';
    row.appendChild(dot);

    var lbl = document.createElement('span');
    lbl.textContent = catDef.label;
    lbl.style.color = '#aaa';
    row.appendChild(lbl);

    filterPanel.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Visibility Filter Logic
// ---------------------------------------------------------------------------

/**
 * Toggle visibility of a category. Swaps materials on all meshes in that category.
 */
export function setVisibilityFilter(category, visible) {
  filterState[category] = visible;

  // Update checkbox in HUD
  if (filterPanel) {
    var cb = filterPanel.querySelector('input[data-category="' + category + '"]');
    if (cb) cb.checked = visible;
  }

  // Apply to all meshes in scene with matching visibilityCategory
  if (!scene) return;

  scene.traverse(function(obj) {
    if (!obj.userData || obj.userData.visibilityCategory !== category) return;

    if (obj.isMesh) {
      if (visible) {
        // Restore original material
        if (obj.userData.originalMaterial) {
          obj.material = obj.userData.originalMaterial;
        }
      } else {
        // Store original and swap to de-emphasized
        if (!obj.userData.originalMaterial) {
          obj.userData.originalMaterial = obj.material;
        }
        obj.material = deemphasizedMaterial;
      }
    } else if (obj.isLine || obj.isLineSegments) {
      if (visible) {
        if (obj.userData.originalMaterial) {
          obj.material = obj.userData.originalMaterial;
        }
      } else {
        if (!obj.userData.originalMaterial) {
          obj.userData.originalMaterial = obj.material;
        }
        obj.material = deemphasizedLineMaterial;
      }
    }
  });
}

export function getVisibilityFilter() {
  return Object.assign({}, filterState);
}

export function setAllVisible(visible) {
  var cats = Object.keys(VISIBILITY_CATEGORIES);
  for (var i = 0; i < cats.length; i++) {
    setVisibilityFilter(cats[i], visible);
  }
}

export function isVisible(category) {
  return filterState[category] !== false;
}

// ---------------------------------------------------------------------------
// Mode Switching
// ---------------------------------------------------------------------------

export function setMode(mode) {
  currentMode = mode;

  // Update mode selector button styles
  if (modeSelector) {
    var btns = modeSelector.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset.mode === mode) {
        btns[i].style.background = '#335';
        btns[i].style.color = '#88aaff';
        btns[i].style.borderColor = '#557';
      } else {
        btns[i].style.background = 'none';
        btns[i].style.color = '#aaa';
        btns[i].style.borderColor = '#555';
      }
    }
  }
}

export function getMode() { return currentMode; }

// ---------------------------------------------------------------------------
// HUD Updates
// ---------------------------------------------------------------------------

function updateTimeDisplay() {
  if (timeDisplay) timeDisplay.textContent = formatTime(getTime());
  if (speedDisplay) speedDisplay.textContent = (isPaused() ? 'PAUSED' : getSpeed().toFixed(1) + 'x');
}

/**
 * Update the status bar with current stats.
 */
export function updateStatusBar(stats) {
  if (!statusBar) return;
  var parts = [];
  parts.push('Mode: ' + currentMode);
  parts.push('Time: ' + formatTime(getTime()));
  if (stats) {
    if (stats.equipmentCount !== undefined) parts.push('Equipment: ' + stats.equipmentCount);
    if (stats.productCount !== undefined) parts.push('Products: ' + stats.productCount);
    if (stats.mobileCount !== undefined) parts.push('Vehicles: ' + stats.mobileCount);
  }
  statusBar.textContent = parts.join('  |  ');
}

// ---------------------------------------------------------------------------
// Info Panel
// ---------------------------------------------------------------------------

export function showInfoPanel(data) {
  if (!infoPanel) return;
  infoPanel.style.display = 'block';
  infoPanel.innerHTML = '';

  if (!data) { hideInfoPanel(); return; }

  var titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#88ccff;font-weight:bold;margin-bottom:6px;font-size:13px;';
  titleEl.textContent = (data.name || data.id || 'Unknown');
  infoPanel.appendChild(titleEl);

  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'X';
  closeBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:none;border:none;color:#666;cursor:pointer;font-size:12px;';
  closeBtn.addEventListener('click', hideInfoPanel);
  infoPanel.appendChild(closeBtn);

  var fields = Object.keys(data);
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    if (key === 'mesh' || key === 'history') continue;
    var val = data[key];
    if (typeof val === 'object' && val !== null) val = JSON.stringify(val);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;padding:1px 0;font-size:11px;border-bottom:1px solid #222;';
    row.innerHTML = '<span style="color:#888">' + key + '</span><span style="color:#ccc">' + val + '</span>';
    infoPanel.appendChild(row);
  }
}

export function hideInfoPanel() {
  if (infoPanel) infoPanel.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Product Tracker Panel
// ---------------------------------------------------------------------------

/**
 * Display all products with color-coded lifecycle state.
 * @param {Array} products - Array of product registry entries
 */
export function showProductTracker(products) {
  if (!productTrackerPanel) return;
  if (!products || products.length === 0) {
    productTrackerPanel.style.display = 'none';
    return;
  }

  productTrackerPanel.style.display = 'block';
  productTrackerPanel.innerHTML = '';

  var title = document.createElement('div');
  title.style.cssText = 'color:#88ccff;font-weight:bold;margin-bottom:4px;font-size:12px;';
  title.textContent = 'Product Tracker (' + products.length + ')';
  productTrackerPanel.appendChild(title);

  var table = document.createElement('div');
  table.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto;gap:2px 8px;font-size:11px;';

  // Import STATE_COLORS dynamically from the data
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var stateColor = getProductStateColor(p.state);

    // ID
    var idEl = document.createElement('span');
    idEl.style.cssText = 'color:#aaa;cursor:pointer;';
    idEl.textContent = p.id;
    idEl.dataset.productId = p.id;
    idEl.addEventListener('click', function(e) {
      if (onObjectClickCallback) onObjectClickCallback({ type: 'product', id: e.target.dataset.productId });
    });
    table.appendChild(idEl);

    // State with color dot
    var stateEl = document.createElement('span');
    stateEl.innerHTML = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + stateColor + ';margin-right:4px;"></span>' + p.state;
    stateEl.style.color = '#ccc';
    table.appendChild(stateEl);

    // Temperature
    var tempEl = document.createElement('span');
    tempEl.style.color = p.temperature > 500 ? '#ff6633' : '#888';
    tempEl.textContent = Math.round(p.temperature) + ' C';
    table.appendChild(tempEl);

    // Location
    var locEl = document.createElement('span');
    locEl.style.color = '#666';
    locEl.textContent = p.location || '-';
    table.appendChild(locEl);
  }

  productTrackerPanel.appendChild(table);
}

function getProductStateColor(state) {
  var colors = {
    arriving: '#aaaaaa', unloading: '#aaaaaa', raw_stored: '#3399ff',
    queued: '#3399ff', transport_heat: '#ff9900', heating: '#ff4400',
    transport_forge: '#ff6600', forging: '#cc3333', transport_quench: '#ff6600',
    quenching: '#3366cc', cooling: '#6699cc', transport_store: '#66cc66',
    finished_stored: '#33cc33', loading: '#33cc33', departed: '#999999', scrapped: '#663333',
  };
  return colors[state] || '#ffffff';
}

export function hideProductTracker() {
  if (productTrackerPanel) productTrackerPanel.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Alert Bar
// ---------------------------------------------------------------------------

export function showAlert(message, duration) {
  if (!alertBar) return;
  alertBar.textContent = message;
  alertBar.style.display = 'block';
  if (duration) {
    setTimeout(function() { hideAlert(); }, duration);
  }
}

export function hideAlert() {
  if (alertBar) alertBar.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Raycasting and Event Handling
// ---------------------------------------------------------------------------

function onCanvasClick(event) {
  if (!camera || !scene) return;

  // Prevent handling during UI interaction
  if (event.target !== renderer.domElement) return;

  // Calculate mouse position in normalized device coordinates
  var rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseVec, camera);
  var intersects = raycaster.intersectObjects(scene.children, true);

  if (intersects.length === 0) return;

  // Find the first meaningful hit
  for (var i = 0; i < intersects.length; i++) {
    var hit = intersects[i];
    var obj = hit.object;

    // Check for registry-linked object (equipment, product)
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

    // Check for utility marker
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

    // Floor/zone click -> grid cell
    if (obj.userData && obj.userData.visibilityCategory === 'zones') {
      var gridX = Math.floor(hit.point.x);
      var gridZ = Math.floor(hit.point.z);
      if (onGridClickCallback) {
        onGridClickCallback({ gridX: gridX, gridZ: gridZ, point: hit.point });
      }
      return;
    }

    // Wall click
    if (obj.userData && obj.userData.visibilityCategory === 'walls') {
      if (onGridClickCallback) {
        var wx = obj.userData.gridX !== undefined ? obj.userData.gridX : Math.floor(hit.point.x);
        var wz = obj.userData.gridZ !== undefined ? obj.userData.gridZ : Math.floor(hit.point.z);
        onGridClickCallback({ gridX: wx, gridZ: wz, point: hit.point, isWall: true });
      }
      return;
    }
  }

  // Fallback: floor click from intersection point
  var fallbackHit = intersects[0];
  if (onGridClickCallback) {
    onGridClickCallback({
      gridX: Math.floor(fallbackHit.point.x),
      gridZ: Math.floor(fallbackHit.point.z),
      point: fallbackHit.point,
    });
  }
}

/**
 * Register a callback for when a 3D object (equipment/product/utility) is clicked.
 * @param {function} callback - Receives { type, id, point, object }
 */
export function onObjectClick(callback) {
  onObjectClickCallback = callback;
}

/**
 * Register a callback for when a grid cell is clicked.
 * @param {function} callback - Receives { gridX, gridZ, point }
 */
export function onGridClick(callback) {
  onGridClickCallback = callback;
}

// ---------------------------------------------------------------------------
// Camera Helpers (delegate to controls.js)
// ---------------------------------------------------------------------------

export function flyToPosition(x, y, z, distance) {
  flyTo(x, y, z, distance);
}

export function resetCamera() {
  resetView();
}

// ---------------------------------------------------------------------------
// Utility Exports
// ---------------------------------------------------------------------------

export function getVisibilityCategories() {
  return VISIBILITY_CATEGORIES;
}

export function getHUDContainer() {
  return hudContainer;
}

export function getContainer() {
  return container;
}