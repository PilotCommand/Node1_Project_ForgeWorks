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
import { tick, getTime, getDelta, getSpeed, setSpeed, pause, resume, getPaused, formatTime } from './worldclock.js';
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
let currentMode = 'sandbox';

// Raycasting
let raycaster = new THREE.Raycaster();
let mouseVec = new THREE.Vector2();

// Event callbacks
let onObjectClickCallback = null;
let onGridClickCallback = null;

// HUD DOM references
let hudContainer = null;
let controlsPanel = null;
let filterPanel = null;
let infoPanel = null;
let productTrackerPanel = null;
let alertBar = null;
let statusBar = null;
let statsPanel = null;
let modeIndicator = null;
let modeIndicatorTimeout = null;
let modeFlash = null;
let modeControlsPanel = null;

// HUD internal references
let modeSelector = null;
let timeDisplay = null;
let speedDisplay = null;

// Grid dimensions (set during init)
let gridW = 60;
let gridH = 80;

// Track HUD initialization
let hudInitialized = false;

// ---------------------------------------------------------------------------
// HUD Theme Colors
// ---------------------------------------------------------------------------
// Edit these to reskin the entire HUD. Every panel, button, border, and
// text color pulls from this single object.
//
// Current palette: Navy / Cyan / Teal (matches sonar-style game HUD)
// To switch to forge orange later, swap accent to '#ff8800' and change
// the (0, 255, 200) values below to (255, 136, 0).
//
// TIP: The "accentRGB" value is used to build all the rgba() variants.
// Change that one string and every transparent accent updates with it.
// ---------------------------------------------------------------------------

const ACCENT_RGB = '0, 255, 200';     // <-- CHANGE THIS ONE VALUE to re-theme

const THEME = {
  // --- Primary accent ---
  accent:       '#00ffc8',                                 // Solid accent for text/titles
  accentRGB:    ACCENT_RGB,                                // Raw RGB for rgba() building

  // --- Accent at various opacities (auto-derived from ACCENT_RGB) ---
  accentDim:    'rgba(' + ACCENT_RGB + ', 0.3)',
  accentFaint:  'rgba(' + ACCENT_RGB + ', 0.15)',
  accentGlow:   'rgba(' + ACCENT_RGB + ', 0.4)',

  // --- Panel chrome ---
  panelBg:      'rgba(0, 20, 40, 0.78)',                   // Dark navy, semi-transparent
  panelBorder:  'rgba(' + ACCENT_RGB + ', 0.25)',
  panelHover:   'rgba(' + ACCENT_RGB + ', 0.4)',            // Border on hover
  titleBg:      'rgba(' + ACCENT_RGB + ', 0.12)',
  titleBorder:  'rgba(' + ACCENT_RGB + ', 0.18)',

  // --- Text ---
  text:         '#c0e8e0',                                 // Light teal-white
  textDim:      'rgba(' + ACCENT_RGB + ', 0.5)',            // Muted labels
  textValue:    '#00ffc8',                                 // Data values

  // --- Buttons ---
  btnBorder:    'rgba(' + ACCENT_RGB + ', 0.2)',
  btnHoverBg:   'rgba(' + ACCENT_RGB + ', 0.08)',
  btnActiveBg:  'rgba(' + ACCENT_RGB + ', 0.15)',
  btnActiveBrd: 'rgba(' + ACCENT_RGB + ', 0.5)',

  // --- Scrollbars ---
  scrollTrack:  'rgba(0, 0, 0, 0.25)',
  scrollThumb:  'rgba(' + ACCENT_RGB + ', 0.3)',

  // --- Inputs ---
  inputBg:      'rgba(0, 0, 0, 0.35)',
  inputBorder:  'rgba(' + ACCENT_RGB + ', 0.2)',

  // --- Misc ---
  divider:      'rgba(' + ACCENT_RGB + ', 0.15)',
  rowBorder:    'rgba(' + ACCENT_RGB + ', 0.06)',           // Subtle row separators
  danger:       '#ff4433',
  success:      '#44cc66',
  info:         '#66aaff',
};

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

  // FPS counter
  statsPanel = new Stats();
  statsPanel.showPanel(0);
  statsPanel.dom.style.position = 'absolute';
  statsPanel.dom.style.left = '0px';
  statsPanel.dom.style.top = '0px';
  statsPanel.dom.style.bottom = 'auto';
  statsPanel.dom.style.margin = '0';
  container.appendChild(statsPanel.dom);

  // HUD styles (for mode controls panel)
  createStyles();
  // buildHUD();  — old panels disabled for clean grid view
  hudInitialized = false;

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

    // Update HUD time display
    updateTimeDisplay();

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
      background: ${THEME.panelBg};
      border: 1px solid ${THEME.panelBorder};
      border-radius: 4px;
      color: ${THEME.text};
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
      border-color: ${THEME.panelHover};
    }

    /* ================================================================
       TITLE BAR — draggable handle
       ================================================================ */
    .hud-title {
      background: ${THEME.titleBg};
      padding: 5px 8px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      border-bottom: 1px solid ${THEME.titleBorder};
      cursor: move;
      user-select: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: ${THEME.accent};
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
       RESIZE HANDLE — bottom-right default
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
      border-right: 2px solid ${THEME.accent};
      border-bottom: 2px solid ${THEME.accent};
    }

    .hud-panel:hover .resize-handle {
      opacity: 0.7;
    }

    /* Info panel — resize handle bottom-left (inner corner) */
    #info-panel .resize-handle {
      right: auto;
      left: 0;
      cursor: nesw-resize;
    }

    #info-panel .resize-handle::before {
      right: auto;
      left: 2px;
      border-right: none;
      border-left: 2px solid ${THEME.accent};
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

    /* ================================================================
       CONTROLS PANEL (Mode + Time)
       ================================================================ */
    #controls-panel {
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
    }

    #controls-panel .controls-content {
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .ctrl-group {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .ctrl-group .ctrl-divider {
      width: 1px;
      height: 18px;
      background: ${THEME.divider};
      margin: 0 4px;
    }

    .ctrl-btn {
      background: none;
      border: 1px solid ${THEME.btnBorder};
      color: ${THEME.textDim};
      padding: 3px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .ctrl-btn:hover {
      border-color: ${THEME.accent};
      color: ${THEME.accent};
      background: ${THEME.btnHoverBg};
    }

    .ctrl-btn.active {
      background: ${THEME.btnActiveBg};
      color: ${THEME.accent};
      border-color: ${THEME.btnActiveBrd};
    }

    .ctrl-time {
      color: ${THEME.accent};
      min-width: 70px;
      text-align: center;
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 0.5px;
    }

    .ctrl-speed {
      color: ${THEME.textDim};
      font-size: 10px;
      min-width: 40px;
      text-align: center;
    }

    /* ================================================================
       VISIBILITY FILTER PANEL
       ================================================================ */
    #filter-panel {
      top: 8px;
      right: 8px;
      width: 190px;
    }

    #filter-panel .filter-content {
      padding: 6px 8px;
    }

    .filter-quick {
      display: flex;
      gap: 3px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }

    .filter-quick .ctrl-btn {
      font-size: 9px;
      padding: 2px 6px;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 2px 0;
      cursor: pointer;
      font-size: 11px;
      padding: 1px 0;
      transition: color 0.15s;
    }

    .filter-row:hover {
      color: ${THEME.accent};
    }

    .filter-row input[type="checkbox"] {
      margin: 0;
      cursor: pointer;
      accent-color: ${THEME.accent};
    }

    .filter-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .filter-label {
      color: ${THEME.textDim};
    }

    .filter-row:hover .filter-label {
      color: ${THEME.text};
    }

    /* ================================================================
       INFO PANEL (Object Inspector)
       ================================================================ */
    #info-panel {
      bottom: 40px;
      right: 8px;
      width: 280px;
      max-height: 340px;
      display: none;
    }

    #info-panel .info-content {
      padding: 8px;
      overflow-y: auto;
      max-height: 280px;
    }

    #info-panel .info-content::-webkit-scrollbar {
      width: 4px;
    }

    #info-panel .info-content::-webkit-scrollbar-track {
      background: ${THEME.scrollTrack};
    }

    #info-panel .info-content::-webkit-scrollbar-thumb {
      background: ${THEME.scrollThumb};
      border-radius: 2px;
    }

    .info-title-text {
      color: ${THEME.accent};
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 6px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      font-size: 11px;
      border-bottom: 1px solid ${THEME.rowBorder};
    }

    .info-key {
      color: ${THEME.textDim};
    }

    .info-val {
      color: ${THEME.text};
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: right;
    }

    /* ================================================================
       PRODUCT TRACKER PANEL
       ================================================================ */
    #product-tracker-panel {
      bottom: 40px;
      left: 8px;
      width: 400px;
      max-height: 220px;
      display: none;
    }

    #product-tracker-panel .tracker-content {
      padding: 6px 8px;
      overflow-y: auto;
      max-height: 170px;
    }

    #product-tracker-panel .tracker-content::-webkit-scrollbar {
      width: 4px;
    }

    #product-tracker-panel .tracker-content::-webkit-scrollbar-track {
      background: ${THEME.scrollTrack};
    }

    #product-tracker-panel .tracker-content::-webkit-scrollbar-thumb {
      background: ${THEME.scrollThumb};
      border-radius: 2px;
    }

    .tracker-grid {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      gap: 2px 8px;
      font-size: 11px;
    }

    .tracker-id {
      color: ${THEME.textDim};
      cursor: pointer;
      transition: color 0.15s;
    }

    .tracker-id:hover {
      color: ${THEME.accent};
    }

    .tracker-state {
      color: ${THEME.text};
    }

    .tracker-state-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }

    .tracker-temp {
      font-variant-numeric: tabular-nums;
    }

    .tracker-loc {
      color: rgba(232, 213, 192, 0.35);
    }

    /* ================================================================
       ALERT BAR
       ================================================================ */
    #forge-alert-bar {
      position: absolute;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(180, 50, 30, 0.92);
      color: #fff;
      padding: 6px 18px;
      border-radius: 4px;
      display: none;
      pointer-events: auto;
      font-size: 12px;
      font-family: 'Consolas', monospace;
      border: 1px solid rgba(255, 80, 50, 0.5);
      box-shadow: 0 2px 16px rgba(180, 50, 30, 0.4);
      z-index: 100;
    }

    /* ================================================================
       STATUS BAR
       ================================================================ */
    #forge-status-bar {
      position: absolute;
      bottom: 0;
      right: 0;
      height: 28px;
      background: rgba(10, 8, 6, 0.92);
      border-top: 1px solid ${THEME.panelBorder};
      border-left: 1px solid ${THEME.panelBorder};
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 16px;
      font-size: 10px;
      font-family: 'Consolas', monospace;
      color: ${THEME.textDim};
      pointer-events: auto;
      border-radius: 4px 0 0 0;
      letter-spacing: 0.3px;
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

function makeFontResizable(panel) {
  var decreaseBtn = panel.querySelector('.font-decrease');
  var increaseBtn = panel.querySelector('.font-increase');
  if (!decreaseBtn || !increaseBtn) return;

  var content = panel.querySelector('.hud-collapsible') || panel;
  var currentSize = 12;
  var minSize = 8;
  var maxSize = 18;

  decreaseBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (currentSize > minSize) {
      currentSize -= 1;
      content.style.fontSize = currentSize + 'px';
    }
  });

  increaseBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (currentSize < maxSize) {
      currentSize += 1;
      content.style.fontSize = currentSize + 'px';
    }
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
// HUD CONSTRUCTION
// ============================================================================

function buildHUD() {
  hudContainer = document.createElement('div');
  hudContainer.id = 'forgeworks-hud';
  hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  container.appendChild(hudContainer);

  buildControlsPanel();
  buildFilterPanel();
  buildInfoPanel();
  buildProductTrackerPanel();
  buildAlertBar();
  buildStatusBar();
}

// ---------------------------------------------------------------------------
// Controls Panel (Mode + Time + Camera) — Top Center, Draggable
// ---------------------------------------------------------------------------

function buildControlsPanel() {
  controlsPanel = document.createElement('div');
  controlsPanel.id = 'controls-panel';
  controlsPanel.className = 'hud-panel';

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.innerHTML = titleBarHTML('Controls');
  controlsPanel.appendChild(title);

  // Collapsible content
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';

  var content = document.createElement('div');
  content.className = 'controls-content';

  // --- Mode buttons ---
  var modeGroup = document.createElement('div');
  modeGroup.className = 'ctrl-group';

  var modes = ['sandbox', 'prediction', 'operating'];
  for (var m = 0; m < modes.length; m++) {
    var btn = document.createElement('button');
    btn.textContent = modes[m].charAt(0).toUpperCase() + modes[m].slice(1);
    btn.dataset.mode = modes[m];
    btn.className = 'ctrl-btn' + (modes[m] === currentMode ? ' active' : '');
    btn.addEventListener('click', function(e) { setMode(e.target.dataset.mode); });
    modeGroup.appendChild(btn);
  }
  modeSelector = modeGroup;
  content.appendChild(modeGroup);

  // Divider
  var div1 = document.createElement('div');
  div1.className = 'ctrl-divider';
  div1.style.cssText = 'width:1px;height:18px;background:' + THEME.divider + ';margin:0 2px;';
  content.appendChild(div1);

  // --- Time controls ---
  var timeGroup = document.createElement('div');
  timeGroup.className = 'ctrl-group';

  var pauseBtn = document.createElement('button');
  pauseBtn.textContent = '⏸';
  pauseBtn.title = 'Pause / Resume';
  pauseBtn.className = 'ctrl-btn';
  pauseBtn.addEventListener('click', function() {
    if (getPaused()) resume(); else pause();
  });
  timeGroup.appendChild(pauseBtn);

  var speedBtns = [0.5, 1, 2, 5, 10];
  for (var s = 0; s < speedBtns.length; s++) {
    var sBtn = document.createElement('button');
    sBtn.textContent = speedBtns[s] + 'x';
    sBtn.dataset.speed = speedBtns[s];
    sBtn.className = 'ctrl-btn';
    sBtn.style.fontSize = '10px';
    sBtn.style.padding = '3px 5px';
    sBtn.addEventListener('click', function(e) { setSpeed(parseFloat(e.target.dataset.speed)); });
    timeGroup.appendChild(sBtn);
  }
  content.appendChild(timeGroup);

  // Time readout
  timeDisplay = document.createElement('span');
  timeDisplay.className = 'ctrl-time';
  timeDisplay.textContent = '00:00:00';
  content.appendChild(timeDisplay);

  speedDisplay = document.createElement('span');
  speedDisplay.className = 'ctrl-speed';
  speedDisplay.textContent = '1.0x';
  content.appendChild(speedDisplay);

  // Divider
  var div2 = document.createElement('div');
  div2.style.cssText = 'width:1px;height:18px;background:' + THEME.divider + ';margin:0 2px;';
  content.appendChild(div2);

  // Reset View button
  var resetBtn = document.createElement('button');
  resetBtn.textContent = '⟳ View';
  resetBtn.title = 'Reset Camera';
  resetBtn.className = 'ctrl-btn';
  resetBtn.addEventListener('click', function() { resetView(); });
  content.appendChild(resetBtn);

  collapsible.appendChild(content);
  controlsPanel.appendChild(collapsible);
  hudContainer.appendChild(controlsPanel);

  // Apply behaviors
  makeDraggable(controlsPanel);
  makeCollapsible(controlsPanel);
  makeFontResizable(controlsPanel);
}

// ---------------------------------------------------------------------------
// Visibility Filter Panel — Top Right, Draggable/Collapsible/Resizable
// ---------------------------------------------------------------------------

function buildFilterPanel() {
  filterPanel = document.createElement('div');
  filterPanel.id = 'filter-panel';
  filterPanel.className = 'hud-panel';

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.innerHTML = titleBarHTML('Visibility');
  filterPanel.appendChild(title);

  // Collapsible content
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';

  var content = document.createElement('div');
  content.className = 'filter-content';

  // Quick controls
  var quickDiv = document.createElement('div');
  quickDiv.className = 'filter-quick';

  var quickBtns = [
    { label: 'All', action: function() { setAllVisible(true); } },
    { label: 'None', action: function() { setAllVisible(false); } },
    { label: 'Products', action: function() { setAllVisible(false); setVisibilityFilter('products', true); setVisibilityFilter('zones', true); } },
    { label: 'Equip', action: function() {
      setAllVisible(false);
      var eqCats = ['furnaces','presses','hammers','quenchTanks','racks'];
      for (var i = 0; i < eqCats.length; i++) setVisibilityFilter(eqCats[i], true);
      setVisibilityFilter('zones', true);
    }},
  ];

  for (var q = 0; q < quickBtns.length; q++) {
    var qBtn = document.createElement('button');
    qBtn.textContent = quickBtns[q].label;
    qBtn.className = 'ctrl-btn';
    qBtn.style.fontSize = '9px';
    qBtn.style.padding = '2px 6px';
    qBtn.addEventListener('click', quickBtns[q].action);
    quickDiv.appendChild(qBtn);
  }
  content.appendChild(quickDiv);

  // Category colors
  var categoryColors = {
    furnaces: '#ff6600', presses: '#999999', hammers: '#cc9933',
    quenchTanks: '#3366cc', racks: '#669933', forklifts: '#cccc33',
    manipulators: '#cc6633', trucks: '#666666', tools: '#996699',
    products: '#ff4400', zones: '#3399ff', walls: '#444444',
    pathways: '#cccccc', utilities: '#ffff00',
  };

  // Category checkboxes
  var cats = Object.keys(VISIBILITY_CATEGORIES);
  for (var c = 0; c < cats.length; c++) {
    var catKey = cats[c];
    var catDef = VISIBILITY_CATEGORIES[catKey];

    var row = document.createElement('label');
    row.className = 'filter-row';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.category = catKey;
    cb.addEventListener('change', function(e) {
      setVisibilityFilter(e.target.dataset.category, e.target.checked);
    });
    row.appendChild(cb);

    var dot = document.createElement('span');
    dot.className = 'filter-dot';
    dot.style.background = categoryColors[catKey] || '#888';
    row.appendChild(dot);

    var lbl = document.createElement('span');
    lbl.className = 'filter-label';
    lbl.textContent = catDef.label;
    row.appendChild(lbl);

    content.appendChild(row);
  }

  collapsible.appendChild(content);
  filterPanel.appendChild(collapsible);
  hudContainer.appendChild(filterPanel);

  // Apply behaviors
  makeDraggable(filterPanel);
  makeResizable(filterPanel, null, 'bottom-left');
  makeCollapsible(filterPanel);
  makeFontResizable(filterPanel);
}

// ---------------------------------------------------------------------------
// Info Panel (Object Inspector) — Bottom Right, Draggable/Collapsible
// ---------------------------------------------------------------------------

function buildInfoPanel() {
  infoPanel = document.createElement('div');
  infoPanel.id = 'info-panel';
  infoPanel.className = 'hud-panel';

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.innerHTML = titleBarHTML('Inspector');
  infoPanel.appendChild(title);

  // Collapsible content
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';

  var content = document.createElement('div');
  content.className = 'info-content';
  content.id = 'info-content-body';

  collapsible.appendChild(content);
  infoPanel.appendChild(collapsible);
  hudContainer.appendChild(infoPanel);

  // Apply behaviors
  makeDraggable(infoPanel);
  makeResizable(infoPanel, null, 'bottom-left');
  makeCollapsible(infoPanel);
  makeFontResizable(infoPanel);
}

// ---------------------------------------------------------------------------
// Product Tracker Panel — Bottom Left, Draggable/Collapsible
// ---------------------------------------------------------------------------

function buildProductTrackerPanel() {
  productTrackerPanel = document.createElement('div');
  productTrackerPanel.id = 'product-tracker-panel';
  productTrackerPanel.className = 'hud-panel';

  // Title bar
  var title = document.createElement('div');
  title.className = 'hud-title';
  title.innerHTML = titleBarHTML('Product Tracker');
  productTrackerPanel.appendChild(title);

  // Collapsible content
  var collapsible = document.createElement('div');
  collapsible.className = 'hud-collapsible';

  var content = document.createElement('div');
  content.className = 'tracker-content';
  content.id = 'tracker-content-body';

  collapsible.appendChild(content);
  productTrackerPanel.appendChild(collapsible);
  hudContainer.appendChild(productTrackerPanel);

  // Apply behaviors
  makeDraggable(productTrackerPanel);
  makeResizable(productTrackerPanel);
  makeCollapsible(productTrackerPanel);
  makeFontResizable(productTrackerPanel);
}

// ---------------------------------------------------------------------------
// Alert Bar — Fixed, top center (below controls)
// ---------------------------------------------------------------------------

function buildAlertBar() {
  alertBar = document.createElement('div');
  alertBar.id = 'forge-alert-bar';
  hudContainer.appendChild(alertBar);
}

// ---------------------------------------------------------------------------
// Status Bar — Bottom Right strip
// ---------------------------------------------------------------------------

function buildStatusBar() {
  statusBar = document.createElement('div');
  statusBar.id = 'forge-status-bar';
  hudContainer.appendChild(statusBar);
}

// ============================================================================
// VISIBILITY FILTER LOGIC
// ============================================================================

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
        if (obj.userData.originalMaterial) {
          obj.material = obj.userData.originalMaterial;
        }
      } else {
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

// ============================================================================
// MODE SWITCHING
// ============================================================================

export function setMode(mode) {
  currentMode = mode;

  // Update mode selector button styles
  if (modeSelector) {
    var btns = modeSelector.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset.mode === mode) {
        btns[i].classList.add('active');
      } else {
        btns[i].classList.remove('active');
      }
    }
  }
}

export function getMode() { return currentMode; }

// ============================================================================
// HUD UPDATES (throttled — DOM writes are expensive, limit to ~4/sec)
// ============================================================================

let _lastStatusText = '';
let _trackerThrottle = 0;
const TRACKER_INTERVAL = 250; // ms between product tracker DOM rebuilds
let _lastTrackerTime = 0;

function updateTimeDisplay() {
  if (timeDisplay) timeDisplay.textContent = formatTime(getTime());
  if (speedDisplay) {
    var newText = (getPaused() ? 'PAUSED' : getSpeed().toFixed(1) + 'x');
    if (speedDisplay.textContent !== newText) speedDisplay.textContent = newText;
  }
}

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
  var text = parts.join('  ·  ');
  if (text !== _lastStatusText) {
    statusBar.textContent = text;
    _lastStatusText = text;
  }
}

// ============================================================================
// INFO PANEL
// ============================================================================

export function showInfoPanel(data) {
  if (!infoPanel) return;
  infoPanel.style.display = 'block';

  var body = document.getElementById('info-content-body');
  if (!body) return;
  body.innerHTML = '';

  if (!data) { hideInfoPanel(); return; }

  // Object title
  var titleEl = document.createElement('div');
  titleEl.className = 'info-title-text';
  titleEl.textContent = (data.name || data.id || 'Unknown');
  body.appendChild(titleEl);

  // Data rows
  var fields = Object.keys(data);
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    if (key === 'mesh' || key === 'history') continue;
    var val = data[key];
    if (typeof val === 'object' && val !== null) val = JSON.stringify(val);

    var row = document.createElement('div');
    row.className = 'info-row';

    var keySpan = document.createElement('span');
    keySpan.className = 'info-key';
    keySpan.textContent = key;
    row.appendChild(keySpan);

    var valSpan = document.createElement('span');
    valSpan.className = 'info-val';
    valSpan.textContent = val;
    valSpan.title = String(val);
    row.appendChild(valSpan);

    body.appendChild(row);
  }
}

export function hideInfoPanel() {
  if (infoPanel) infoPanel.style.display = 'none';
}

// ============================================================================
// PRODUCT TRACKER
// ============================================================================

export function showProductTracker(products) {
  if (!productTrackerPanel) return;
  if (!products || products.length === 0) {
    productTrackerPanel.style.display = 'none';
    return;
  }

  // Throttle: only rebuild DOM at TRACKER_INTERVAL
  var now = performance.now();
  if (now - _lastTrackerTime < TRACKER_INTERVAL) return;
  _lastTrackerTime = now;

  productTrackerPanel.style.display = 'block';

  // Update the title to show count
  var titleSpan = productTrackerPanel.querySelector('.hud-title span:first-child');
  if (titleSpan) titleSpan.textContent = 'Product Tracker (' + products.length + ')';

  var body = document.getElementById('tracker-content-body');
  if (!body) return;
  body.innerHTML = '';

  var table = document.createElement('div');
  table.className = 'tracker-grid';

  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var stateColor = getProductStateColor(p.state);

    // ID
    var idEl = document.createElement('span');
    idEl.className = 'tracker-id';
    idEl.textContent = p.id;
    idEl.dataset.productId = p.id;
    idEl.addEventListener('click', function(e) {
      if (onObjectClickCallback) onObjectClickCallback({ type: 'product', id: e.target.dataset.productId });
    });
    table.appendChild(idEl);

    // State with color dot
    var stateEl = document.createElement('span');
    stateEl.className = 'tracker-state';
    stateEl.innerHTML = '<span class="tracker-state-dot" style="background:' + stateColor + '"></span>' + p.state;
    table.appendChild(stateEl);

    // Temperature
    var tempEl = document.createElement('span');
    tempEl.className = 'tracker-temp';
    tempEl.style.color = p.temperature > 500 ? '#ff6633' : THEME.textDim;
    tempEl.textContent = Math.round(p.temperature) + '°C';
    table.appendChild(tempEl);

    // Location
    var locEl = document.createElement('span');
    locEl.className = 'tracker-loc';
    locEl.textContent = p.location || '—';
    table.appendChild(locEl);
  }

  body.appendChild(table);
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

// ============================================================================
// ALERT BAR
// ============================================================================

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

/**
 * Show or update the mode indicator.
 * Persistent badge in bottom-right + brief center flash on change.
 */
export function showModeIndicator(mode) {
  var cfg = MODE_CONFIG[mode] || MODE_CONFIG.build;

  // --- Create persistent badge (once) ---
  if (!modeIndicator) {
    modeIndicator = document.createElement('div');
    modeIndicator.id = 'mode-badge';
    Object.assign(modeIndicator.style, {
      position: 'absolute',
      bottom: '10px',
      right: '10px',
      fontFamily: "'Consolas', 'SF Mono', 'Fira Code', monospace",
      fontSize: '11px',
      letterSpacing: '1.5px',
      padding: '6px 14px',
      borderRadius: '3px',
      pointerEvents: 'none',
      zIndex: '20',
      transition: 'all 0.25s ease',
    });
    container.appendChild(modeIndicator);
  }

  // Update badge
  modeIndicator.textContent = cfg.icon + '  ' + cfg.label;
  modeIndicator.style.color = cfg.color;
  modeIndicator.style.border = '1px solid ' + cfg.color + '44';
  modeIndicator.style.background = 'rgba(0, 10, 20, 0.7)';

  // Update controls panel
  updateControlsPanel(mode);

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
  if (modeIndicatorTimeout) clearTimeout(modeIndicatorTimeout);

  // Fade out and remove
  modeIndicatorTimeout = setTimeout(function() {
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

export function getVisibilityCategories() {
  return VISIBILITY_CATEGORIES;
}

export function getHUDContainer() {
  return hudContainer;
}

export function getContainer() {
  return container;
}