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

var _activeContext = null;  // last context passed to refreshVisualizer

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
  toolbar.appendChild(resetBtn);
  panel.appendChild(toolbar);

  // ── Canvas wrapper ────────────────────────────────────────────────────────
  _container = document.createElement('div');
  Object.assign(_container.style, {
    flex: '1', position: 'relative', overflow: 'hidden',
  });
  panel.appendChild(_container);

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

  // Grid helper — subtle
  var grid = new THREE.GridHelper(400, 20, 0x1a2a38, 0x1a2a38);
  grid.position.y = 0;
  _scene.add(grid);

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
// Part material (shared across all geometries)
// ---------------------------------------------------------------------------

function _makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color:     color || 0x8899aa,
    metalness: 0.55,
    roughness: 0.45,
    envMapIntensity: 0.5,
  });
}

function _makeWireframe(color) {
  return new THREE.MeshBasicMaterial({
    color: color || 0x4466aa,
    wireframe: true,
    transparent: true,
    opacity: 0.15,
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
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  _scene = null; _camera = null; _controls = null;
  _container = null; _canvas = null; _activeContext = null;
}
