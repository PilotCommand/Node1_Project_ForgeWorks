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

  // Grid — shader-based with labels (matches forge floor aesthetic)
  _buildGrid();

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
// Grid — shader-based infinite grid with fade + axis labels (matches forge floor)
// ---------------------------------------------------------------------------

var _gridMaterial  = null;
var _labelGroup    = null;
var _labelPool     = [];     // recycled sprites for numeric labels
var _axisLabels    = {};     // { xLabel, yLabel, originLabel }

function _buildGrid() {
  var geo = new THREE.PlaneGeometry(20000, 20000);

  _gridMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uCamGround:  { value: new THREE.Vector2(0, 0) },
      uFadeStart:  { value: 100.0 },
      uFadeEnd:    { value: 500.0 },
      uGridUnit:   { value: 1.0 },   // mm per minor grid square
      uMinorFade:  { value: 1.0 },   // 0 = major only, 1 = minor fully visible
    },
    vertexShader: [
      'varying vec2 vWorldXZ;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldXZ = wp.xz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vWorldXZ;',
      'uniform vec2 uCamGround;',
      'uniform float uFadeStart;',
      'uniform float uFadeEnd;',
      'uniform float uGridUnit;',
      'uniform float uMinorFade;',
      '',
      'float gridLine(float coord, float width) {',
      '  float d = abs(fract(coord + 0.5) - 0.5);',
      '  float fw = fwidth(coord);',
      '  return 1.0 - smoothstep(width - fw, width + fw, d);',
      '}',
      '',
      'void main() {',
      '  float dist = distance(vWorldXZ, uCamGround);',
      '  float t = clamp((dist - uFadeStart) / (uFadeEnd - uFadeStart), 0.0, 1.0);',
      '  float fade = 1.0 - t * t * (3.0 - 2.0 * t);',
      '  if (fade < 0.005) discard;',
      '',
      '  vec2 scaled = vWorldXZ / uGridUnit;',
      '',
      '  // Minor lines — every 1 unit, fade out when zoomed out',
      '  float thinX = gridLine(scaled.x, 0.04);',
      '  float thinZ = gridLine(scaled.y, 0.04);',
      '  float thin = max(thinX, thinZ) * uMinorFade;',
      '',
      '  // Major lines — every 10 units, always visible',
      '  float boldX = gridLine(scaled.x / 10.0, 0.008);',
      '  float boldZ = gridLine(scaled.y / 10.0, 0.008);',
      '  float bold = max(boldX, boldZ);',
      '',
      '  // Axis lines — thicker, brighter',
      '  float fwX = fwidth(vWorldXZ.y);',
      '  float fwZ = fwidth(vWorldXZ.x);',
      '  float onX = 1.0 - smoothstep(0.10 - fwX, 0.10 + fwX, abs(vWorldXZ.y));',
      '  float onZ = 1.0 - smoothstep(0.10 - fwZ, 0.10 + fwZ, abs(vWorldXZ.x));',
      '',
      '  vec3 thinColor = vec3(0.30, 0.33, 0.38);',
      '  vec3 boldColor = vec3(0.55, 0.60, 0.68);',
      '  vec3 xAxisColor = vec3(1.0, 0.20, 0.20);',
      '  vec3 zAxisColor = vec3(0.20, 0.48, 1.0);',
      '',
      '  vec3 col = thinColor;',
      '  float alpha = thin * 0.35;',
      '  col = mix(col, boldColor, bold);',
      '  alpha = max(alpha, bold * 0.70);',
      '  col = mix(col, xAxisColor, onX);',
      '  alpha = max(alpha, onX * 0.90);',
      '  col = mix(col, zAxisColor, onZ);',
      '  alpha = max(alpha, onZ * 0.90);',
      '  alpha *= fade;',
      '  if (alpha < 0.005) discard;',
      '  gl_FragColor = vec4(col, alpha);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    extensions:  { derivatives: true },
  });

  var gridPlane = new THREE.Mesh(geo, _gridMaterial);
  gridPlane.rotation.x = -Math.PI / 2;
  gridPlane.position.y = -0.5;    // sit slightly below the part origin
  _scene.add(gridPlane);

  // ── Y axis — vertical green line through origin ───────────────────────────
  var yAxisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -2000, 0),
    new THREE.Vector3(0,  2000, 0),
  ]);
  var yAxisMat = new THREE.LineBasicMaterial({ color: 0x22dd66, transparent: true, opacity: 0.85, depthWrite: false });
  _scene.add(new THREE.Line(yAxisGeo, yAxisMat));

  // ── Label sprites — numeric pool only (axis names are HTML overlays) ──────
  _labelGroup = new THREE.Group();
  _scene.add(_labelGroup);

  var poolSize = 80;
  for (var i = 0; i < poolSize; i++) {
    var spr = _makeTextSprite('0', '#888888');
    spr.visible = false;
    _labelGroup.add(spr);
    _labelPool.push(spr);
  }

  // Origin marker sprite (small "0" at grid origin)
  _axisLabels.origin = _makeTextSprite('0', '#aabbcc', 0.9);
  _axisLabels.origin.visible = false;
  _labelGroup.add(_axisLabels.origin);
}

/**
 * Recompute grid density and label positions based on current camera height.
 * Call every frame from the animation loop.
 */
function _updateGrid() {
  if (!_gridMaterial || !_camera) return;

  // ─────────────────────────────────────────────────────────────────────────
  // GRID VISUAL SETTINGS — tweak these to adjust the look
  // ─────────────────────────────────────────────────────────────────────────
  var CFG = {
    // How many minor grid divisions are "ideal" across the visible area
    // Lower = coarser grid, Higher = finer grid
    minorDivisionsTarget:  10,

    // Fraction of camera distance used for fade start/end
    fadeStartFraction:  0.5,
    fadeEndFraction:    1.8,

    // Minor lines fade out when they'd be smaller than this fraction of viewport
    // 0.008 = start fading when minor lines are ~0.8% of view width apart
    minorFadeIn:   0.008,   // below this → fully hidden
    minorFadeOut:  0.016,   // above this → fully visible

    // Sprite size as a fraction of camera distance (so they stay same screen size)
    numericSpriteScale: 0.045,   // for the axis number labels
    axisSpriteScale:    0.06,    // for the X / Y / Z name labels

    // All axis labels and numbers share this opacity
    labelOpacity:  0.90,

    // Y label floats at this fraction of camera distance above origin
    // (currently unused — Y label is pinned to AX/AY/AZ above)

    // Labels sit this many units above the grid plane
    labelY: 1.0,
  };
  // ─────────────────────────────────────────────────────────────────────────

  var target = _controls ? _controls.target : new THREE.Vector3();
  var height = _camera.position.distanceTo(target);

  // Choose minor grid unit — snap to clean engineering values
  var SNAPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  var desiredMinorSpacing = height / CFG.minorDivisionsTarget;
  var unit = SNAPS[SNAPS.length - 1];
  for (var si = 0; si < SNAPS.length; si++) {
    if (SNAPS[si] >= desiredMinorSpacing) { unit = SNAPS[si]; break; }
  }

  var majorUnit  = unit * 10;
  var fadeStart  = height * CFG.fadeStartFraction;
  var fadeEnd    = height * CFG.fadeEndFraction;

  // Minor fade — crossfade minor lines in/out based on screen density
  var minorScreenSize = unit / height;
  var minorFade = Math.min(1.0, Math.max(0.0,
    (minorScreenSize - CFG.minorFadeIn) / (CFG.minorFadeOut - CFG.minorFadeIn)
  ));

  _gridMaterial.uniforms.uCamGround.value.set(target.x, target.z);
  _gridMaterial.uniforms.uFadeStart.value  = fadeStart;
  _gridMaterial.uniforms.uFadeEnd.value    = fadeEnd;
  _gridMaterial.uniforms.uGridUnit.value   = unit;
  _gridMaterial.uniforms.uMinorFade.value  = minorFade;

  // Sprite world sizes — proportional to camera distance
  var numSize  = height * CFG.numericSpriteScale;
  var labelY   = CFG.labelY;

  // Label step: use minor unit when lines are visible, major unit when zoomed out
  var labelStep = minorFade > 0.3 ? unit : majorUnit;

  // ── Number labels ─────────────────────────────────────────────────────────
  var poolIdx = 0;
  for (var pi = 0; pi < _labelPool.length; pi++) _labelPool[pi].visible = false;

  if (_axisLabelMode === 'none') {
    if (_axisLabels.origin) _axisLabels.origin.visible = false;
    return;
  }

  var hasNegNums = _axisLabelMode === 'neg_screen' || _axisLabelMode === 'neg_part';
  var onPart     = (_axisLabelMode === 'part' || _axisLabelMode === 'neg_part') && _currentMesh;

  if (onPart) {
    // ── Part mode: labels at the bbox extents on each axis ──────────────────
    var bbox = new THREE.Box3().setFromObject(_currentMesh);

    var partPoints = [
      { val: bbox.max.x, pos: new THREE.Vector3(bbox.max.x, labelY, 0), color: '#ff5555' },
      { val: bbox.max.y, pos: new THREE.Vector3(0, bbox.max.y,        0), color: '#44cc77' },
      { val: bbox.max.z, pos: new THREE.Vector3(0, labelY, bbox.max.z), color: '#5599ff' },
    ];

    if (hasNegNums) {
      partPoints.push(
        { val: bbox.min.x, pos: new THREE.Vector3(bbox.min.x, labelY, 0), color: '#ff5555' },
        { val: bbox.min.y, pos: new THREE.Vector3(0, bbox.min.y,        0), color: '#44cc77' },
        { val: bbox.min.z, pos: new THREE.Vector3(0, labelY, bbox.min.z), color: '#5599ff' }
      );
    }

    partPoints.forEach(function(pt) {
      if (poolIdx >= _labelPool.length) return;
      var spr = _labelPool[poolIdx++];
      _updateSpriteText(spr, _fmtDim(Math.round(pt.val), unit), pt.color);
      spr.scale.set(numSize, numSize, 1);
      spr.position.copy(pt.pos);
      spr.material.opacity = CFG.labelOpacity;
      spr.visible = true;
    });

    if (_axisLabels.origin) _axisLabels.origin.visible = false;

  } else {
    // ── Screen mode: numbers on their axis at every label step ───────────────
    // labelStep = minor unit when zoomed in, major unit when zoomed out
    var range = fadeEnd * 0.80;
    var minX  = Math.floor((target.x - range) / labelStep) * labelStep;
    var maxX  = Math.ceil ((target.x + range) / labelStep) * labelStep;
    var minZ  = Math.floor((target.z - range) / labelStep) * labelStep;
    var maxZ  = Math.ceil ((target.z + range) / labelStep) * labelStep;

    for (var lx = minX; lx <= maxX; lx += labelStep) {
      if (poolIdx >= _labelPool.length) break;
      if (!hasNegNums && lx < 0) continue;
      var dx  = lx - target.x, dzx = -target.z;
      var dist = Math.sqrt(dx * dx + dzx * dzx);
      if (dist > fadeEnd) continue;
      var spr = _labelPool[poolIdx++];
      var val = Math.round(lx);
      // Major line labels are brighter, minor line labels are dimmer
      var onMajor = (Math.round(lx / majorUnit) * majorUnit === Math.round(lx));
      var col = val === 0 ? '#ffffff' : '#ff5555';
      _updateSpriteText(spr, _fmtDim(val, unit), col);
      spr.scale.set(numSize, numSize, 1);
      spr.position.set(lx, labelY, 0);   // ON the X axis
      var ft = Math.max(0, Math.min(1, (dist - fadeStart) / (fadeEnd - fadeStart)));
      var baseOp = onMajor ? CFG.labelOpacity : CFG.labelOpacity * 0.55;
      spr.material.opacity = (1.0 - ft * ft * (3.0 - 2.0 * ft)) * baseOp;
      spr.visible = spr.material.opacity > 0.01;
    }

    for (var lz = minZ; lz <= maxZ; lz += labelStep) {
      if (poolIdx >= _labelPool.length) break;
      if (lz === 0) continue;
      if (!hasNegNums && lz < 0) continue;
      var dx2  = -target.x, dz2 = lz - target.z;
      var dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
      if (dist2 > fadeEnd) continue;
      var spr2 = _labelPool[poolIdx++];
      var val2 = Math.round(lz);
      var onMajor2 = (Math.round(lz / majorUnit) * majorUnit === Math.round(lz));
      _updateSpriteText(spr2, _fmtDim(val2, unit), '#5599ff');
      spr2.scale.set(numSize, numSize, 1);
      spr2.position.set(0, labelY, lz);   // ON the Z axis
      var ft2 = Math.max(0, Math.min(1, (dist2 - fadeStart) / (fadeEnd - fadeStart)));
      var baseOp2 = onMajor2 ? CFG.labelOpacity : CFG.labelOpacity * 0.55;
      spr2.material.opacity = (1.0 - ft2 * ft2 * (3.0 - 2.0 * ft2)) * baseOp2;
      spr2.visible = spr2.material.opacity > 0.01;
    }

    // Origin marker
    if (_axisLabels.origin) {
      _axisLabels.origin.scale.set(numSize * 0.85, numSize * 0.85, 1);
      _axisLabels.origin.position.set(0, labelY, 0);
      _axisLabels.origin.material.opacity = CFG.labelOpacity;
      _axisLabels.origin.visible = true;
    }
  }

  // HTML axis labels are updated separately in _updateHtmlAxisLabels()
}

/**
 * Project the 3D anchor positions for X/Y/Z labels into percentage-based
 * CSS coordinates and move the HTML divs accordingly.
 * Called every frame from the animation loop.
 */
function _updateHtmlAxisLabels() {
  if (!_htmlAxisLabels || !_camera || !_container) return;

  var w = _container.offsetWidth;
  var h = _container.offsetHeight;
  if (w < 1 || h < 1) return;

  var allDivs = [_htmlAxisLabels.x,  _htmlAxisLabels.y,  _htmlAxisLabels.z,
                 _htmlAxisLabels.nx, _htmlAxisLabels.ny, _htmlAxisLabels.nz];

  // ── No Labels ─────────────────────────────────────────────────────────────
  if (_axisLabelMode === 'none') {
    allDivs.forEach(function(d) { d.style.opacity = '0'; });
    return;
  }

  var target  = _controls ? _controls.target : new THREE.Vector3();
  var dist    = _camera.position.distanceTo(target);
  var hasNeg  = _axisLabelMode === 'neg_screen' || _axisLabelMode === 'neg_part';
  var onPart  = (_axisLabelMode === 'part' || _axisLabelMode === 'neg_part') && _currentMesh;
  var d       = dist * 0.35;

  // Update label text — plain X/Y/Z for basic modes, +X/-X etc for negative modes
  _htmlAxisLabels.x.textContent  = hasNeg ? '+X' : 'X';
  _htmlAxisLabels.y.textContent  = hasNeg ? '+Y' : 'Y';
  _htmlAxisLabels.z.textContent  = hasNeg ? '+Z' : 'Z';

  var px, py, pz, nx, ny, nz;

  if (onPart) {
    var bbox = new THREE.Box3().setFromObject(_currentMesh);
    px = new THREE.Vector3( bbox.max.x, 0,          0          );
    py = new THREE.Vector3( 0,          bbox.max.y,  0          );
    pz = new THREE.Vector3( 0,          0,           bbox.max.z );
    nx = new THREE.Vector3( bbox.min.x, 0,          0          );
    ny = new THREE.Vector3( 0,          bbox.min.y,  0          );
    nz = new THREE.Vector3( 0,          0,           bbox.min.z );
  } else {
    px = new THREE.Vector3( d, 0, 0);
    py = new THREE.Vector3( 0, d, 0);
    pz = new THREE.Vector3( 0, 0, d);
    nx = new THREE.Vector3(-d, 0, 0);
    ny = new THREE.Vector3( 0,-d, 0);
    nz = new THREE.Vector3( 0, 0,-d);
  }

  var pairs = [
    { div: _htmlAxisLabels.x,  world: px, show: true   },
    { div: _htmlAxisLabels.y,  world: py, show: true   },
    { div: _htmlAxisLabels.z,  world: pz, show: true   },
    { div: _htmlAxisLabels.nx, world: nx, show: hasNeg },
    { div: _htmlAxisLabels.ny, world: ny, show: hasNeg },
    { div: _htmlAxisLabels.nz, world: nz, show: hasNeg },
  ];

  var tmp = new THREE.Vector3();

  pairs.forEach(function(pair) {
    if (!pair.show) { pair.div.style.opacity = '0'; return; }

    tmp.copy(pair.world);
    tmp.project(_camera);

    var pctX = ( tmp.x * 0.5 + 0.5) * 100;
    var pctY = (-tmp.y * 0.5 + 0.5) * 100;

    var offScreen = tmp.z > 1 || pctX < -10 || pctX > 110 || pctY < -10 || pctY > 110;

    pair.div.style.left    = pctX + '%';
    pair.div.style.top     = pctY + '%';
    pair.div.style.opacity = offScreen ? '0' : '0.92';
  });
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

function _makeTextSprite(text, color, scaleMult) {
  var canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = 'bold 80px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(text, 128, 128);

  var tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;

  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  var spr = new THREE.Sprite(mat);
  var s = (scaleMult || 1.0) * 4.0;
  spr.scale.set(s, s, 1);
  spr.userData._canvas = canvas;
  spr.userData._text   = text;
  spr.userData._color  = color;
  return spr;
}

function _updateSpriteText(sprite, text, color) {
  if (sprite.userData._text === text && sprite.userData._color === color) return;
  var canvas = sprite.userData._canvas;
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = 'bold 80px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(text, 128, 128);
  sprite.material.map.needsUpdate = true;
  sprite.userData._text  = text;
  sprite.userData._color = color;
}

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
  if (_gridMaterial) { _gridMaterial.dispose(); _gridMaterial = null; }
  _labelPool = []; _axisLabels = {}; _labelGroup = null;
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  _scene = null; _camera = null; _controls = null;
  _container = null; _canvas = null; _activeContext = null;
}