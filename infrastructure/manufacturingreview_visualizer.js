// ============================================================================
// manufacturingreview_visualizer.js — Part Geometry Visualizer
// Manufacturing Review · Forgeworks Infrastructure
// ============================================================================
// Renders a 3D preview of the target part defined in the Part tab, and
// optionally a per-node in-progress view as the process chain is walked.
//
// Architecture:
//   - One persistent Three.js scene, camera, renderer, and OrbitControls
//     instance created when buildVisualizerPanel() is first called.
//   - refreshVisualizer(context) swaps the displayed geometry without
//     rebuilding the scene — just disposes the old mesh and adds the new one.
//   - Geometry generators are pure functions: (params) → THREE.Object3D
//
// Exports:
//   buildVisualizerPanel()         → HTMLElement  (call once, insert in DOM)
//   refreshVisualizer(context)     → void         (call whenever data changes)
//
// context shapes:
//   { type: 'part' }               → render _part geometry
//   { type: 'node', step }         → render post-node geometry from computeChain step
//   null                           → show placeholder / no active order
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as S from './manufacturingreview_states.js';
import { MATERIAL_CATALOG, computeChain } from './manufacturingreview_defs.js';

// ---------------------------------------------------------------------------
// Module-level scene state — one instance for the lifetime of the MR session
// ---------------------------------------------------------------------------

var _renderer  = null;
var _scene     = null;
var _camera    = null;
var _controls  = null;
var _container = null;    // the canvas wrapper div
var _canvas    = null;
var _animFrame = null;
var _currentMesh = null;  // the THREE.Object3D currently in the scene

var _activeContext   = null;
var _partYOffset     = false;
var _axisLabelMode   = 'screen';  // 'screen' | 'part' | 'none'
var _htmlAxisLabels  = null;

// ---------------------------------------------------------------------------
// Public: buildVisualizerPanel
// ---------------------------------------------------------------------------

/**
 * Build and return the visualizer panel element.
 * Call once — the panel is persistent and reused across context switches.
 *
 * @returns {HTMLElement}
 */
export function buildVisualizerPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-viz-panel';
  Object.assign(panel.style, {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    position: 'relative', overflow: 'hidden',
    background: 'transparent',
  });

  // ── Toolbar ───────────────────────────────────────────────────────────────
  var toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 12px', flexShrink: '0',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0,0,0,0.2)',
    fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: '#7a9aaa',
  });

  var titleEl = document.createElement('span');
  titleEl.id = 'mr-viz-title';
  titleEl.textContent = '3D View';
  toolbar.appendChild(titleEl);

  // ── Toolbar right side: Y offset checkbox + Reset View button ────────────
  var rightGroup = document.createElement('div');
  Object.assign(rightGroup.style, { display: 'flex', alignItems: 'center', gap: '10px' });

  // Grid plane selector
  var planeSel = document.createElement('select');
  Object.assign(planeSel.style, {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '2px', color: '#7a9aaa', fontSize: '8px', letterSpacing: '1px',
    padding: '3px 6px', cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
  });
  [['xz','XZ Plane'],['xy','XY Plane'],['zy','ZY Plane']].forEach(function(opt) {
    var o = document.createElement('option');
    o.value = opt[0]; o.textContent = opt[1];
    if (opt[0] === _gridPlane) o.selected = true;
    planeSel.appendChild(o);
  });
  planeSel.addEventListener('change', function() {
    _gridPlane = planeSel.value;
    if (_scene) _buildSimpleGrid(_gridPlane);
  });
  rightGroup.appendChild(planeSel);

  // Axis label mode dropdown
  var axisSel = document.createElement('select');
  Object.assign(axisSel.style, {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '2px', color: '#7a9aaa', fontSize: '8px', letterSpacing: '1px',
    padding: '3px 6px', cursor: 'pointer', fontFamily: 'inherit',
    outline: 'none',
  });
  [
    ['screen',       'Label on Screen'],
    ['part',         'Label on Part'],
    ['neg_screen',   'Negatives on Screen'],
    ['neg_part',     'Negatives on Part'],
    ['none',         'No Labels'],
  ].forEach(function(opt) {
    var o = document.createElement('option');
    o.value = opt[0]; o.textContent = opt[1];
    if (opt[0] === _axisLabelMode) o.selected = true;
    axisSel.appendChild(o);
  });
  axisSel.addEventListener('change', function() {
    _axisLabelMode = axisSel.value;
  });
  rightGroup.appendChild(axisSel);

  // Y offset toggle
  var offsetLabel = document.createElement('label');
  Object.assign(offsetLabel.style, {
    display: 'flex', alignItems: 'center', gap: '5px',
    cursor: 'pointer', color: '#7a9aaa', fontSize: '8px', letterSpacing: '1px',
    textTransform: 'uppercase', userSelect: 'none',
  });
  var offsetCheck = document.createElement('input');
  offsetCheck.type    = 'checkbox';
  offsetCheck.checked = _partYOffset;
  Object.assign(offsetCheck.style, { cursor: 'pointer', accentColor: '#50d080' });
  offsetCheck.addEventListener('change', function() {
    _partYOffset = offsetCheck.checked;
    // Re-render current context with new offset
    if (_activeContext) refreshVisualizer(_activeContext);
  });
  offsetLabel.appendChild(offsetCheck);
  offsetLabel.appendChild(document.createTextNode('Lift Part'));
  rightGroup.appendChild(offsetLabel);

  // Reset camera button
  var resetBtn = document.createElement('button');
  Object.assign(resetBtn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '2px', color: '#7a9aaa', fontSize: '8px',
    letterSpacing: '1px', padding: '3px 8px',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s ease',
  });
  resetBtn.textContent = 'Reset View';
  resetBtn.addEventListener('mouseenter', function() {
    resetBtn.style.color = '#c0ccd8';
    resetBtn.style.borderColor = 'rgba(255,255,255,0.35)';
  });
  resetBtn.addEventListener('mouseleave', function() {
    resetBtn.style.color = '#7a9aaa';
    resetBtn.style.borderColor = 'rgba(255,255,255,0.15)';
  });
  resetBtn.addEventListener('click', function() { resetCamera(); });
  rightGroup.appendChild(resetBtn);
  toolbar.appendChild(rightGroup);
  panel.appendChild(toolbar);

  // ── Canvas wrapper ────────────────────────────────────────────────────────
  _container = document.createElement('div');
  Object.assign(_container.style, {
    flex: '1', position: 'relative', overflow: 'hidden',
  });
  panel.appendChild(_container);

  // ── HTML axis label overlays — project() keeps them attached to 3D points ─
  // Anchor positions are computed live in _updateHtmlAxisLabels relative to camera distance.
  function makeAxisDiv(text, color) {
    var d = document.createElement('div');
    Object.assign(d.style, {
      position:    'absolute',
      pointerEvents: 'none',
      fontSize:    '11px',
      fontWeight:  '700',
      fontFamily:  'Consolas, monospace',
      letterSpacing: '1px',
      color:       color,
      textShadow:  '0 0 6px ' + color + ', 0 1px 3px rgba(0,0,0,0.8)',
      transform:   'translate(-50%, -50%)',
      zIndex:      '5',
      opacity:     '0',
      transition:  'opacity 0.1s ease',
    });
    d.textContent = text;
    _container.appendChild(d);
    return d;
  }

  _htmlAxisLabels = {
    x:  makeAxisDiv('+X', '#ff4444'),
    y:  makeAxisDiv('+Y', '#22dd66'),
    z:  makeAxisDiv('+Z', '#4488ff'),
    nx: makeAxisDiv('-X', '#ff4444'),
    ny: makeAxisDiv('-Y', '#22dd66'),
    nz: makeAxisDiv('-Z', '#4488ff'),
  };

  // ── Placeholder (shown when nothing to display) ────────────────────────
  var placeholder = document.createElement('div');
  placeholder.id = 'mr-viz-placeholder';
  Object.assign(placeholder.style, {
    position: 'absolute', inset: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#3a5060', fontSize: '10px', textAlign: 'center',
    lineHeight: '1.8', whiteSpace: 'pre-line', pointerEvents: 'none',
    zIndex: '2',
  });
  placeholder.textContent = 'Open a delivery order\nand fill in the Part tab\nto see a 3D preview.';
  _container.appendChild(placeholder);

  // Defer Three.js init to first use so we don't block page load
  _initThree();

  return panel;
}

// ---------------------------------------------------------------------------
// Public: refreshVisualizer
// ---------------------------------------------------------------------------

/**
 * Refresh the 3D view with the given context.
 *
 * @param {{ type: 'part' } | { type: 'node', step: object } | null} context
 */
export function refreshVisualizer(context) {
  _activeContext = context;

  var placeholder = document.getElementById('mr-viz-placeholder');
  var titleEl     = document.getElementById('mr-viz-title');

  if (!context || !S.getActiveOrderId()) {
    _clearMesh();
    if (placeholder) placeholder.style.display = 'flex';
    if (titleEl) titleEl.textContent = '3D View';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  var obj = null;

  if (context.type === 'part') {
    obj = geometryFromPart(S.getPart());
    if (titleEl) {
      var pt = S.getPart();
      var label = pt.partName || pt.partNumber || 'Part Preview';
      titleEl.textContent = label;
    }
  } else if (context.type === 'node' && context.step) {
    obj = geometryFromNodeStep(context.step);
    if (titleEl) titleEl.textContent = context.step.label || 'Node View';
  }

  if (obj) {
    _clearMesh();
    _currentMesh = obj;

    // If Y offset is enabled, lift the part so its base sits on the grid
    if (_partYOffset) {
      var bbox = new THREE.Box3().setFromObject(_currentMesh);
      var lowestY = bbox.min.y;
      if (lowestY < 0) _currentMesh.position.y -= lowestY;
    }

    _scene.add(_currentMesh);
    _fitCamera(_currentMesh);
  }
}

// ---------------------------------------------------------------------------
// Three.js initialisation
// ---------------------------------------------------------------------------

function _initThree() {
  if (_renderer) return;
  if (!_container) return;

  var w = _container.offsetWidth  || 300;
  var h = _container.offsetHeight || 300;

  // Renderer
  _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(w, h);
  _renderer.setClearColor(0x000000, 0);
  _renderer.shadowMap.enabled = false;
  _canvas = _renderer.domElement;
  Object.assign(_canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
  });
  _container.appendChild(_canvas);

  // Scene
  _scene = new THREE.Scene();

  // Lighting
  var ambient = new THREE.AmbientLight(0xffffff, 0.4);
  _scene.add(ambient);

  var key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1, 2, 1.5);
  _scene.add(key);

  var fill = new THREE.DirectionalLight(0x8899cc, 0.4);
  fill.position.set(-1, 0.5, -1);
  _scene.add(fill);

  // Simple fixed grid
  _buildSimpleGrid(_gridPlane);

  // Camera
  _camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
  _camera.position.set(200, 200, 400);
  _camera.lookAt(0, 0, 0);

  // OrbitControls
  _controls = new OrbitControls(_camera, _canvas);
  _controls.enableDamping  = true;
  _controls.dampingFactor  = 0.08;
  _controls.minDistance    = 10;
  _controls.maxDistance    = 5000;
  _controls.target.set(0, 0, 0);
  _controls.update();

  // Resize observer
  var ro = new ResizeObserver(function() { _onResize(); });
  ro.observe(_container);

  // Animation loop
  function animate() {
    _animFrame = requestAnimationFrame(animate);
    _controls.update();
    _updateGrid();
    _updateHtmlAxisLabels();
    _renderer.render(_scene, _camera);
  }
  animate();
}

function _onResize() {
  if (!_renderer || !_container) return;
  var w = _container.offsetWidth;
  var h = _container.offsetHeight;
  if (w < 1 || h < 1) return;
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
  _renderer.setSize(w, h);
}

function _clearMesh() {
  if (_currentMesh && _scene) {
    _scene.remove(_currentMesh);
    _currentMesh.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(function(m) { m.dispose(); });
        } else {
          child.material.dispose();
        }
      }
    });
    _currentMesh = null;
  }
}

function resetCamera() {
  if (!_camera || !_controls) return;
  _camera.position.set(200, 200, 400);
  _camera.lookAt(0, 0, 0);
  _controls.target.set(0, 0, 0);
  _controls.update();
  if (_currentMesh) _fitCamera(_currentMesh);
}

function _fitCamera(obj) {
  if (!obj || !_camera || !_controls) return;
  var box = new THREE.Box3().setFromObject(obj);
  var center = box.getCenter(new THREE.Vector3());
  var size   = box.getSize(new THREE.Vector3());
  var maxDim = Math.max(size.x, size.y, size.z);
  var fov    = _camera.fov * (Math.PI / 180);
  var dist   = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 2.0;

  _controls.target.copy(center);
  _camera.position.set(
    center.x + dist * 0.6,
    center.y + dist * 0.5,
    center.z + dist * 0.8
  );
  _camera.lookAt(center);
  _controls.update();
}

// ---------------------------------------------------------------------------
// Grid — simple LineSegments-based grid, three opacity tiers
// ---------------------------------------------------------------------------

// ── Tune these values to change the grid appearance ───────────────────────
var GRID_CFG = {
  extent:       500,    // grid extends ±this many units from origin each direction
  minorStep:    10,     // spacing between minor lines
  majorStep:    50,     // spacing between major lines (must be a multiple of minorStep)
  axisOpacity:  0.90,   // axis lines (x=0, z=0 etc)
  majorOpacity: 0.38,   // major grid lines
  minorOpacity: 0.10,   // minor grid lines
  gridColor:    0x445566,  // color for all non-axis grid lines
  spriteScale:  10,     // world-unit size of numeric sprites
  labelOffset:  8,      // how far off-axis the numeric labels sit (world units)
};
// ─────────────────────────────────────────────────────────────────────────

var _gridGroup      = null;
var _gridPlane      = 'xz';
var _gridSprites    = [];    // positive grid numeric sprites
var _negSprites     = [];    // negative grid numeric sprites
var _partLabelGroup = null;  // sprites for 'part' / 'neg_part' bbox labels
var _fadeSphere     = null;

// ---------------------------------------------------------------------------
// Simple fixed grid — three opacity tiers, no adaptive snapping
// ---------------------------------------------------------------------------

/** Make a simple canvas text sprite. Created once per grid build, not updated. */
function _makeSprite(text, color) {
  var canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = 'bold 56px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(text, 64, 64);
  var tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  var spr = new THREE.Sprite(mat);
  spr.scale.set(GRID_CFG.spriteScale, GRID_CFG.spriteScale, 1);
  return spr;
}

/**
 * Build (or rebuild) the grid for the given plane.
 * Disposes the old grid group first.
 * plane: 'xz' | 'xy' | 'zy'
 */
function _buildSimpleGrid(plane) {
  // ── Dispose old grid ────────────────────────────────────────────────────
  if (_gridGroup) {
    _scene.remove(_gridGroup);
    _gridGroup.traverse(function(obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(function(m){ m.dispose(); });
        else obj.material.dispose();
      }
    });
    _gridGroup = null;
    _gridSprites = [];
    _negSprites  = [];
  }

  var cfg  = GRID_CFG;
  var ext  = cfg.extent;
  var minS = cfg.minorStep;
  var majS = cfg.majorStep;

  // ── Helpers ─────────────────────────────────────────────────────────────
  function makeLines(verts, color, opacity) {
    if (!verts.length) return null;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(verts), 3));
    var mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false });
    return new THREE.LineSegments(geo, mat);
  }

  // Axis colors: X=red, Y=green, Z=blue
  var COLOR_X   = 0xff3333;
  var COLOR_Y   = 0x22dd66;
  var COLOR_Z   = 0x3366ff;

  var group = new THREE.Group();
  var minorV = [], majorV = [];

  // ── Build geometry per plane ─────────────────────────────────────────────
  if (plane === 'xz') {
    // Horizontal plane at y=0
    // Lines parallel to Z (x = v)
    for (var x = -ext; x <= ext; x += minS) {
      if (x === 0) continue;
      var vm = x % majS === 0 ? majorV : minorV;
      vm.push(x,0,-ext, x,0,ext);
    }
    // Lines parallel to X (z = v)
    for (var z = -ext; z <= ext; z += minS) {
      if (z === 0) continue;
      var vm2 = z % majS === 0 ? majorV : minorV;
      vm2.push(-ext,0,z, ext,0,z);
    }
    // Axis lines
    group.add(makeLines([-ext,0,0, ext,0,0], COLOR_X, cfg.axisOpacity));
    group.add(makeLines([0,0,-ext, 0,0,ext], COLOR_Z, cfg.axisOpacity));

    // Positive X sprites (x > 0 only)
    for (var lx = majS; lx <= ext; lx += majS) {
      var spr = _makeSprite(String(lx), '#ff6666');
      spr.position.set(lx, 1, cfg.labelOffset);
      spr.userData.isPos = true;
      group.add(spr); _gridSprites.push(spr);
    }
    // Origin
    var sprO = _makeSprite('0', '#ffffff');
    sprO.position.set(0, 1, cfg.labelOffset);
    sprO.userData.isPos = true;
    group.add(sprO); _gridSprites.push(sprO);
    // Negative X sprites
    for (var lxn = -majS; lxn >= -ext; lxn -= majS) {
      var sprxn = _makeSprite(String(lxn), '#ff6666');
      sprxn.position.set(lxn, 1, cfg.labelOffset);
      sprxn.userData.isNeg = true;
      group.add(sprxn); _negSprites.push(sprxn);
    }
    // Positive Z sprites (z > 0 only)
    for (var lz = majS; lz <= ext; lz += majS) {
      var sprz = _makeSprite(String(lz), '#6699ff');
      sprz.position.set(cfg.labelOffset, 1, lz);
      sprz.userData.isPos = true;
      group.add(sprz); _gridSprites.push(sprz);
    }
    // Negative Z sprites
    for (var lzn = -majS; lzn >= -ext; lzn -= majS) {
      var sprzn = _makeSprite(String(lzn), '#6699ff');
      sprzn.position.set(cfg.labelOffset, 1, lzn);
      sprzn.userData.isNeg = true;
      group.add(sprzn); _negSprites.push(sprzn);
    }

  } else if (plane === 'xy') {
    for (var x2 = -ext; x2 <= ext; x2 += minS) {
      if (x2 === 0) continue;
      var vm3 = x2 % majS === 0 ? majorV : minorV;
      vm3.push(x2,-ext,0, x2,ext,0);
    }
    for (var y2 = -ext; y2 <= ext; y2 += minS) {
      if (y2 === 0) continue;
      var vm4 = y2 % majS === 0 ? majorV : minorV;
      vm4.push(-ext,y2,0, ext,y2,0);
    }
    group.add(makeLines([-ext,0,0, ext,0,0], COLOR_X, cfg.axisOpacity));
    group.add(makeLines([0,-ext,0, 0,ext,0], COLOR_Y, cfg.axisOpacity));

    var sprO2 = _makeSprite('0', '#ffffff');
    sprO2.position.set(0, cfg.labelOffset, 1);
    sprO2.userData.isPos = true;
    group.add(sprO2); _gridSprites.push(sprO2);
    for (var lx2 = majS; lx2 <= ext; lx2 += majS) {
      var sprx2 = _makeSprite(String(lx2), '#ff6666');
      sprx2.position.set(lx2, cfg.labelOffset, 1);
      sprx2.userData.isPos = true;
      group.add(sprx2); _gridSprites.push(sprx2);
    }
    for (var lx2n = -majS; lx2n >= -ext; lx2n -= majS) {
      var sprx2n = _makeSprite(String(lx2n), '#ff6666');
      sprx2n.position.set(lx2n, cfg.labelOffset, 1);
      sprx2n.userData.isNeg = true;
      group.add(sprx2n); _negSprites.push(sprx2n);
    }
    for (var ly2 = majS; ly2 <= ext; ly2 += majS) {
      var spry2 = _makeSprite(String(ly2), '#66cc88');
      spry2.position.set(cfg.labelOffset, ly2, 1);
      spry2.userData.isPos = true;
      group.add(spry2); _gridSprites.push(spry2);
    }
    for (var ly2n = -majS; ly2n >= -ext; ly2n -= majS) {
      var spry2n = _makeSprite(String(ly2n), '#66cc88');
      spry2n.position.set(cfg.labelOffset, ly2n, 1);
      spry2n.userData.isNeg = true;
      group.add(spry2n); _negSprites.push(spry2n);
    }

  } else if (plane === 'zy') {
    for (var z3 = -ext; z3 <= ext; z3 += minS) {
      if (z3 === 0) continue;
      var vm5 = z3 % majS === 0 ? majorV : minorV;
      vm5.push(0,-ext,z3, 0,ext,z3);
    }
    for (var y3 = -ext; y3 <= ext; y3 += minS) {
      if (y3 === 0) continue;
      var vm6 = y3 % majS === 0 ? majorV : minorV;
      vm6.push(0,y3,-ext, 0,y3,ext);
    }
    group.add(makeLines([0,0,-ext, 0,0,ext], COLOR_Z, cfg.axisOpacity));
    group.add(makeLines([0,-ext,0, 0,ext,0], COLOR_Y, cfg.axisOpacity));

    var sprO3 = _makeSprite('0', '#ffffff');
    sprO3.position.set(1, cfg.labelOffset, 0);
    sprO3.userData.isPos = true;
    group.add(sprO3); _gridSprites.push(sprO3);
    for (var lz3 = majS; lz3 <= ext; lz3 += majS) {
      var sprz3 = _makeSprite(String(lz3), '#6699ff');
      sprz3.position.set(1, cfg.labelOffset, lz3);
      sprz3.userData.isPos = true;
      group.add(sprz3); _gridSprites.push(sprz3);
    }
    for (var lz3n = -majS; lz3n >= -ext; lz3n -= majS) {
      var sprz3n = _makeSprite(String(lz3n), '#6699ff');
      sprz3n.position.set(1, cfg.labelOffset, lz3n);
      sprz3n.userData.isNeg = true;
      group.add(sprz3n); _negSprites.push(sprz3n);
    }
    for (var ly3 = majS; ly3 <= ext; ly3 += majS) {
      var spry3 = _makeSprite(String(ly3), '#66cc88');
      spry3.position.set(1, ly3, cfg.labelOffset);
      spry3.userData.isPos = true;
      group.add(spry3); _gridSprites.push(spry3);
    }
    for (var ly3n = -majS; ly3n >= -ext; ly3n -= majS) {
      var spry3n = _makeSprite(String(ly3n), '#66cc88');
      spry3n.position.set(1, ly3n, cfg.labelOffset);
      spry3n.userData.isNeg = true;
      group.add(spry3n); _negSprites.push(spry3n);
    }
  }

  // Add minor and major lines to group
  var minorLines = makeLines(minorV, cfg.gridColor, cfg.minorOpacity);
  if (minorLines) group.add(minorLines);
  var majorLines = makeLines(majorV, cfg.gridColor, cfg.majorOpacity);
  if (majorLines) group.add(majorLines);

  // ── Perpendicular axis — the axis that pokes through the grid plane ────────
  if (plane === 'xz') {
    // Y axis pokes through the XZ plane vertically
    group.add(makeLines([0,-ext,0, 0,ext,0], COLOR_Y, cfg.axisOpacity));
  } else if (plane === 'xy') {
    // Z axis pokes through the XY plane
    group.add(makeLines([0,0,-ext, 0,0,ext], COLOR_Z, cfg.axisOpacity));
  } else {
    // X axis pokes through the ZY plane
    group.add(makeLines([-ext,0,0, ext,0,0], COLOR_X, cfg.axisOpacity));
  }

  _gridGroup = group;
  _scene.add(_gridGroup);

  // ── Radial fade mask ──────────────────────────────────────────────────────
  // A large plane sitting on the grid, same orientation.
  // The fragment shader computes 2D distance from the origin in the plane's
  // coordinate space — this is the intersection circle of a sphere with the plane.
  //   dist < uInner  → transparent (grid shows through)
  //   uInner–uOuter  → smoothstep fade
  //   dist > uOuter  → fully opaque (background colour — hides grid)
  if (_fadeSphere) {
    _scene.remove(_fadeSphere);
    _fadeSphere.geometry.dispose();
    _fadeSphere.material.dispose();
    _fadeSphere = null;
  }

  // The two world-space coordinates that measure distance in this plane
  var distLine = plane === 'xz' ? 'float dist = length(vec2(vWorldPos.x, vWorldPos.z));'
               : plane === 'xy' ? 'float dist = length(vec2(vWorldPos.x, vWorldPos.y));'
               :                  'float dist = length(vec2(vWorldPos.z, vWorldPos.y));';

  var fadeMat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: ext * 0.60 },
      uOuter: { value: ext * 0.95 },
    },
    vertexShader: [
      'varying vec3 vWorldPos;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPos = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vWorldPos;',
      'uniform float uInner;',
      'uniform float uOuter;',
      'void main() {',
      '  ' + distLine,
      '  float t = clamp((dist - uInner) / (uOuter - uInner), 0.0, 1.0);',
      '  float alpha = t * t * (3.0 - 2.0 * t);',
      '  if (alpha < 0.005) discard;',
      '  gl_FragColor = vec4(0.016, 0.031, 0.055, alpha);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite:  false,
    depthTest:   true,   // keeps depth so the part occludes naturally
    side:        THREE.DoubleSide,
  });

  var fadeGeo = new THREE.PlaneGeometry(ext * 4, ext * 4);

  // Two planes bracketing the grid surface — one on each side.
  // Whichever side the camera is on, that plane passes the depth test and renders.
  // depthTest:true means the part’s depth buffer occludes the fade automatically.
  var sideOffsets = {
    xz: [ [0,  0.5, 0, -Math.PI/2, 0, 0],
          [0, -0.5, 0, -Math.PI/2, 0, 0] ],
    xy: [ [0, 0,  0.5, 0, 0, 0],
          [0, 0, -0.5, 0, 0, 0] ],
    zy: [ [ 0.5, 0, 0, 0, Math.PI/2, 0],
          [-0.5, 0, 0, 0, Math.PI/2, 0] ],
  }[plane];

  _fadeSphere = null;
  sideOffsets.forEach(function(o) {
    var mesh = new THREE.Mesh(fadeGeo, fadeMat);
    mesh.position.set(o[0], o[1], o[2]);
    mesh.rotation.set(o[3], o[4], o[5]);
    mesh.renderOrder = 2;   // after grid (0), before part (1000)
    mesh.userData.fadeMat = fadeMat;
    group.add(mesh);
    if (!_fadeSphere) _fadeSphere = mesh;
  });
}

// Scale the fade radii with camera distance each frame so the visible circle
// always shows the grid around the orbit target at a consistent screen size.
function _updateGrid() {
  if (!_fadeSphere || !_camera || !_controls) return;

  var target = _controls.target;
  var height = _camera.position.distanceTo(target);

  // Move the mask to follow the orbit target on the correct axes for this plane
  if (_gridPlane === 'xz') {
    _fadeSphere.position.x = target.x;
    _fadeSphere.position.y = 0.2;
    _fadeSphere.position.z = target.z;
  } else if (_gridPlane === 'xy') {
    _fadeSphere.position.x = target.x;
    _fadeSphere.position.y = target.y;
    _fadeSphere.position.z = 0.2;
  } else {
    _fadeSphere.position.x = 0.2;
    _fadeSphere.position.y = target.y;
    _fadeSphere.position.z = target.z;
  }

  var mat = _fadeSphere.userData.fadeMat;
  if (!mat) return;

  // Scale the two radii with camera distance
  // Tune these fractions to adjust visible grid size and fade width
  mat.uniforms.uInner.value = height * 0.50;
  mat.uniforms.uOuter.value = height * 0.85;
}

/**
 * Update HTML axis name labels (X/Y/Z divs) and numeric sprite visibility.
 * Called every frame from the animation loop.
 */
function _updateHtmlAxisLabels() {
  if (!_htmlAxisLabels || !_camera || !_container) return;

  var w = _container.offsetWidth;
  var h = _container.offsetHeight;
  if (w < 1 || h < 1) return;

  var mode   = _axisLabelMode;
  var plane  = _gridPlane;
  var hasNeg = mode === 'neg_screen' || mode === 'neg_part';
  var onPart = (mode === 'part' || mode === 'neg_part') && _currentMesh;
  var none   = mode === 'none';

  // Which axis name divs are relevant to the current plane
  // Each plane has two in-plane axes plus one perpendicular
  var planeAxes = {
    xz: ['x', 'z', 'y'],
    xy: ['x', 'y', 'z'],
    zy: ['z', 'y', 'x'],
  }[plane] || ['x', 'z', 'y'];

  // Update +/- prefix text
  _htmlAxisLabels.x.textContent  = hasNeg ? '+X' : 'X';
  _htmlAxisLabels.y.textContent  = hasNeg ? '+Y' : 'Y';
  _htmlAxisLabels.z.textContent  = hasNeg ? '+Z' : 'Z';
  _htmlAxisLabels.nx.textContent = '-X';
  _htmlAxisLabels.ny.textContent = '-Y';
  _htmlAxisLabels.nz.textContent = '-Z';

  // Compute anchor positions
  var target = _controls ? _controls.target : new THREE.Vector3();
  var dist   = _camera.position.distanceTo(target);
  var d      = dist * 0.35;

  var pos = {}, neg = {};
  if (onPart) {
    var bbox = new THREE.Box3().setFromObject(_currentMesh);
    pos.x = new THREE.Vector3(bbox.max.x, 0, 0);
    pos.y = new THREE.Vector3(0, bbox.max.y, 0);
    pos.z = new THREE.Vector3(0, 0, bbox.max.z);
    neg.x = new THREE.Vector3(bbox.min.x, 0, 0);
    neg.y = new THREE.Vector3(0, bbox.min.y, 0);
    neg.z = new THREE.Vector3(0, 0, bbox.min.z);
  } else {
    pos.x = new THREE.Vector3( d,  0,  0);
    pos.y = new THREE.Vector3( 0,  d,  0);
    pos.z = new THREE.Vector3( 0,  0,  d);
    neg.x = new THREE.Vector3(-d,  0,  0);
    neg.y = new THREE.Vector3( 0, -d,  0);
    neg.z = new THREE.Vector3( 0,  0, -d);
  }

  // All pairs — show flag determined by mode and plane
  var pairs = [
    { div: _htmlAxisLabels.x,  world: pos.x, show: !none },
    { div: _htmlAxisLabels.y,  world: pos.y, show: !none },
    { div: _htmlAxisLabels.z,  world: pos.z, show: !none },
    { div: _htmlAxisLabels.nx, world: neg.x, show: !none && hasNeg },
    { div: _htmlAxisLabels.ny, world: neg.y, show: !none && hasNeg },
    { div: _htmlAxisLabels.nz, world: neg.z, show: !none && hasNeg },
  ];

  var tmp = new THREE.Vector3();
  pairs.forEach(function(pair) {
    if (!pair.show) { pair.div.style.opacity = '0'; return; }
    tmp.copy(pair.world);
    tmp.project(_camera);
    var pctX = ( tmp.x * 0.5 + 0.5) * 100;
    var pctY = (-tmp.y * 0.5 + 0.5) * 100;
    var off  = tmp.z > 1 || pctX < -10 || pctX > 110 || pctY < -10 || pctY > 110;
    pair.div.style.left    = pctX + '%';
    pair.div.style.top     = pctY + '%';
    pair.div.style.opacity = off ? '0' : '0.92';
  });

  // ── Numeric sprite visibility ─────────────────────────────────────────────
  _updateSpriteVisibility(mode, onPart);
}

function _updateSpriteVisibility(mode, onPart) {
  var showPos  = mode !== 'none' && !onPart;
  var showNeg  = (mode === 'neg_screen') && !onPart;
  var showPart = onPart;

  // Positive grid sprites
  _gridSprites.forEach(function(s) { s.visible = showPos; });
  // Negative grid sprites
  _negSprites.forEach(function(s)  { s.visible = showNeg; });

  // Part label sprites — rebuild if needed
  if (showPart) {
    _buildPartLabels();
  } else {
    _clearPartLabels();
  }
}

function _clearPartLabels() {
  if (_partLabelGroup) {
    _scene.remove(_partLabelGroup);
    _partLabelGroup.traverse(function(o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    _partLabelGroup = null;
  }
}

function _buildPartLabels() {
  // Rebuild part labels only when mesh or plane changed — check a hash
  var meshId   = _currentMesh ? _currentMesh.uuid : null;
  var cacheKey = meshId + '|' + _gridPlane + '|' + _axisLabelMode;
  if (_partLabelGroup && _partLabelGroup.userData.cacheKey === cacheKey) return;

  _clearPartLabels();
  if (!_currentMesh || !_scene) return;

  var hasNeg = _axisLabelMode === 'neg_part';
  var bbox   = new THREE.Box3().setFromObject(_currentMesh);
  var off    = GRID_CFG.labelOffset;
  var grp    = new THREE.Group();
  grp.userData.cacheKey = cacheKey;

  function addSpr(val, pos) {
    var s = _makeSprite(String(Math.round(val)), val >= 0 ? '#ffdd88' : '#ffdd88');
    s.position.copy(pos);
    grp.add(s);
  }

  // Only show extents for the two axes that exist on the current grid plane
  if (_gridPlane === 'xz') {
    addSpr(bbox.max.x, new THREE.Vector3(bbox.max.x, 1, off));
    addSpr(bbox.max.z, new THREE.Vector3(off, 1, bbox.max.z));
    if (hasNeg) {
      addSpr(bbox.min.x, new THREE.Vector3(bbox.min.x, 1, off));
      addSpr(bbox.min.z, new THREE.Vector3(off, 1, bbox.min.z));
    }
  } else if (_gridPlane === 'xy') {
    addSpr(bbox.max.x, new THREE.Vector3(bbox.max.x, off, 1));
    addSpr(bbox.max.y, new THREE.Vector3(off, bbox.max.y, 1));
    if (hasNeg) {
      addSpr(bbox.min.x, new THREE.Vector3(bbox.min.x, off, 1));
      addSpr(bbox.min.y, new THREE.Vector3(off, bbox.min.y, 1));
    }
  } else {  // zy
    addSpr(bbox.max.z, new THREE.Vector3(1, off, bbox.max.z));
    addSpr(bbox.max.y, new THREE.Vector3(1, bbox.max.y, off));
    if (hasNeg) {
      addSpr(bbox.min.z, new THREE.Vector3(1, off, bbox.min.z));
      addSpr(bbox.min.y, new THREE.Vector3(1, bbox.min.y, off));
    }
  }

  _partLabelGroup = grp;
  _scene.add(_partLabelGroup);
}

/**
 * Format a dimension value for display as a grid label.
 * Shows mm for small units, cm for mid, m for large.
 */
function _fmtDim(val, unit) {
  if (unit >= 1000) return (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + 'm';
  if (unit >= 10)   return (val / 10).toFixed(0) + 'cm';
  return val + 'mm';
}

// ---------------------------------------------------------------------------
// Text sprite helpers — ported from forgehousebuilder.js
// ---------------------------------------------------------------------------

function _makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color:     color || 0x8899aa,
    metalness: 0.55,
    roughness: 0.45,
    envMapIntensity: 0.5,
  });
}

// ---------------------------------------------------------------------------
// Geometry generators — pure functions, return THREE.Object3D (Group)
// ---------------------------------------------------------------------------

/**
 * Generate a 3D object from the _part state object.
 * @param {object} part  S.getPart()
 * @returns {THREE.Group}
 */
export function geometryFromPart(part) {
  var group = new THREE.Group();
  var mesh, geo;
  var mat = _makeMaterial(0x8899aa);

  switch (part.productType) {

    case 'bar': {
      var L = part.barLength   || 500;
      var segs = 32;

      if (part.barShape === 'round') {
        var r = (part.barDiameter || 100) / 2;
        geo = new THREE.CylinderGeometry(r, r, L, segs);
        mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);

      } else if (part.barShape === 'hexagonal') {
        var af = (part.barAcrossFlats || 100);
        var hexR = af / Math.cos(Math.PI / 6) / 2;
        var hexShape = new THREE.Shape();
        for (var i = 0; i < 6; i++) {
          var angle = (Math.PI / 6) + (i * Math.PI / 3);
          var px = hexR * Math.cos(angle);
          var py = hexR * Math.sin(angle);
          if (i === 0) hexShape.moveTo(px, py);
          else hexShape.lineTo(px, py);
        }
        hexShape.closePath();
        var extSettings = { depth: L, bevelEnabled: false };
        geo = new THREE.ExtrudeGeometry(hexShape, extSettings);
        mesh = new THREE.Mesh(geo, mat);
        // Rotate so length runs along Y (consistent with cylinders)
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = -L / 2;
        group.add(mesh);

      } else if (part.barShape === 'rectangular') {
        var W = part.barWidth      || 100;
        var T = part.barThickness  || 50;
        geo = new THREE.BoxGeometry(W, L, T);
        mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
      }

      // Stepped: add faint step division lines
      if (part.isStepped === 'yes' && part.numSteps > 1) {
        var n   = part.numSteps;
        var stepL = L / n;
        var lineMat = new THREE.LineBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.25,
        });
        for (var s = 1; s < n; s++) {
          var y = -L / 2 + s * stepL;
          var pts = [];
          for (var a = 0; a <= 64; a++) {
            var ang = (a / 64) * Math.PI * 2;
            var rr = (part.barShape === 'round') ? (part.barDiameter || 100) / 2 * 1.01 : 60;
            pts.push(new THREE.Vector3(Math.cos(ang) * rr, y, Math.sin(ang) * rr));
          }
          var lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          group.add(new THREE.Line(lineGeo, lineMat));
        }
      }
      break;
    }

    case 'disc': {
      var dR = (part.discOD || 300) / 2;
      var dT = part.discThickness || 80;
      geo = new THREE.CylinderGeometry(dR, dR, dT, 64);
      mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      break;
    }

    case 'ring': {
      var rOD = (part.ringOD || 400) / 2;
      var rID = (part.ringID || 200) / 2;
      var rH  = part.ringHeight || 100;

      // Build ring via lathe of a rectangular cross-section profile
      var profile = [];
      profile.push(new THREE.Vector2(rID, -rH / 2));
      profile.push(new THREE.Vector2(rOD, -rH / 2));
      profile.push(new THREE.Vector2(rOD,  rH / 2));
      profile.push(new THREE.Vector2(rID,  rH / 2));
      profile.push(new THREE.Vector2(rID, -rH / 2));

      geo = new THREE.LatheGeometry(profile, 64);
      mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      // OD contour indicator — thin highlight ring
      if (part.odContour && part.odContour !== 'none') {
        var contourMat = new THREE.MeshStandardMaterial({
          color: part.odContour === 'machined' ? 0x60d0a0 : 0xe0a040,
          metalness: 0.3, roughness: 0.6,
        });
        var contourGeo = new THREE.TorusGeometry(rOD, rH * 0.04, 8, 64);
        contourGeo.rotateX(Math.PI / 2);
        group.add(new THREE.Mesh(contourGeo, contourMat));
      }
      break;
    }

    case 'mushroom': {
      var fD = (part.flangeDiam || 300) / 2;
      var sD = (part.stemDiam   || 100) / 2;
      var tH = part.totalHeight || 200;
      var flangeH  = tH * 0.25;
      var stemH    = tH * 0.75;

      var flangeGeo = new THREE.CylinderGeometry(fD, fD, flangeH, 64);
      var flangeMesh = new THREE.Mesh(flangeGeo, mat);
      flangeMesh.position.y = stemH + flangeH / 2;
      group.add(flangeMesh);

      var stemGeo = new THREE.CylinderGeometry(sD, sD, stemH, 32);
      var stemMesh = new THREE.Mesh(stemGeo, mat);
      stemMesh.position.y = stemH / 2;
      group.add(stemMesh);
      break;
    }

    default: {
      // Fallback — generic cube placeholder
      geo = new THREE.BoxGeometry(100, 100, 100);
      mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      break;
    }
  }

  // Centre the group at origin for consistent camera framing
  var box = new THREE.Box3().setFromObject(group);
  var centre = box.getCenter(new THREE.Vector3());
  group.position.sub(centre);

  return group;
}

/**
 * Generate a 3D object representing the part state after a process chain step.
 * These are approximations — they communicate what is happening, not precise geometry.
 *
 * @param {object} step  A step object from computeChain()
 * @returns {THREE.Group}
 */
export function geometryFromNodeStep(step) {
  if (!step) return geometryFromPart(S.getPart());

  var group = new THREE.Group();
  var dimsOut = step.dimsOut || {};
  var nodeType = step.type || '';

  // Colour by node category
  var colours = {
    stock_in:   0x5588aa,   // blue-grey — raw incoming stock
    cut:        0xaa7744,   // amber — material removal
    heat:       0xdd6622,   // orange — thermal
    forge:      0xcc4444,   // red — forming
    ring_mill:  0xaa44aa,   // purple
    trim:       0x997733,   // brown
    heat_treat: 0xdd8833,   // warm orange
    machine:    0x448888,   // teal — machining
    inspect:    0x44aa66,   // green
    weld:       0xaabb44,   // yellow-green
    stock_out:  0x6699bb,   // blue — finished product
  };
  var colour = colours[nodeType] || 0x8899aa;

  var mat = _makeMaterial(colour);

  // Determine geometry from dimsOut — fall back to _part if not available
  var geom = dimsOut.geometry || 'round_cylinder';
  var D  = dimsOut.diameter   || dimsOut.width   || 100;
  var L  = dimsOut.length     || 200;
  var geo, mesh;

  if (geom === 'rectangular_prism') {
    var W2 = dimsOut.width  || 100;
    var T2 = dimsOut.sectionHeight || 80;
    geo  = new THREE.BoxGeometry(W2, L, T2);
    mesh = new THREE.Mesh(geo, mat);
  } else {
    // round_cylinder and round_corner_square both approximate as cylinder
    var r2 = D / 2;
    geo  = new THREE.CylinderGeometry(r2, r2, L, 48);
    mesh = new THREE.Mesh(geo, mat);
  }

  group.add(mesh);

  // Heat glow effect — add a slightly larger emissive shell
  if (nodeType === 'heat' || nodeType === 'forge') {
    var glowMat = new THREE.MeshStandardMaterial({
      color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 0.4,
      transparent: true, opacity: 0.18, side: THREE.BackSide,
    });
    var glowGeo = (geom === 'rectangular_prism')
      ? new THREE.BoxGeometry(D * 1.08, L * 1.04, D * 1.08)
      : new THREE.CylinderGeometry(D / 2 * 1.08, D / 2 * 1.08, L * 1.04, 48);
    group.add(new THREE.Mesh(glowGeo, glowMat));
  }

  // Stock out — overlay the target part shape faintly for comparison
  if (nodeType === 'stock_out') {
    var targetObj = geometryFromPart(S.getPart());
    targetObj.traverse(function(child) {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x00eebb, transparent: true, opacity: 0.18,
          wireframe: false,
        });
      }
    });
    group.add(targetObj);
  }

  // Centre
  var box = new THREE.Box3().setFromObject(group);
  var centre = box.getCenter(new THREE.Vector3());
  group.position.sub(centre);

  return group;
}

// ---------------------------------------------------------------------------
// Cleanup — call when the MR overlay is torn down
// ---------------------------------------------------------------------------

export function destroyVisualizer() {
  if (_animFrame) cancelAnimationFrame(_animFrame);
  _clearMesh();
  // Dispose grid
  if (_gridGroup) {
    if (_scene) _scene.remove(_gridGroup);
    _gridGroup.traverse(function(obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    _gridGroup = null;
    _gridSprites = [];
    _negSprites  = [];
  }
  if (_fadeSphere) {
    if (_scene) _scene.remove(_fadeSphere);
    _fadeSphere.geometry.dispose();
    _fadeSphere.material.dispose();
    _fadeSphere = null;
  }
  _clearPartLabels();
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  _scene = null; _camera = null; _controls = null;
  _container = null; _canvas = null; _activeContext = null;
}