// ============================================================================
// forgehousebuilder.js — Put Things in the World
// Forgeworks · Foundation · Tier 1
// ============================================================================
// The ONLY file that creates Three.js meshes and adds them to the scene.
// Every other file that wants something visible calls forgehousebuilder.
//
// Owns:
//   - All mesh construction (floor, walls, zones, equipment, vehicles, products)
//   - Scene add/remove operations
//   - Grid-to-world positioning of spawned objects
//   - Visibility category tagging on all meshes
//   - Tracking of world meshes (floor, walls, zones) for rebuilds
//
// Does NOT own:
//   - Equipment specs, behavior, or state (that's the equipment files)
//   - The 2D grid array or pathfinding (that's gridsquare.js)
//   - Movement or animation each frame (that's forgehousechanger.js)
//   - The renderer, camera, or HUD (that's visualhud.js)
//
// Imports: Three.js, gridsquare.js (for spatial queries and zone colors)
// Exports: Spawn functions for every object type, scene management
// ============================================================================

import * as THREE from 'three';
import {
  getGridWidth, getGridDepth, getCellSize, getWallHeight,
  getCell, getWalls, getDoors, getPathways,
  gridToWorld, getFootprintCenter,
  ZONE_COLORS,
} from './gridsquare.js';


// ---------------------------------------------------------------------------
// Scene Reference — set once during init
// ---------------------------------------------------------------------------

var scene = null;


// ---------------------------------------------------------------------------
// Tracked World Meshes (for rebuilding when layout changes)
// ---------------------------------------------------------------------------

var floorMesh = null;
var gridOverlayMesh = null;
var zoneOverlayGroup = null;
var wallGroup = null;
var pathwayGroup = null;
var utilityGroup = null;

// All spawned equipment/vehicle/product meshes, keyed by registry ID
var spawnedMeshes = {};

// Infinite grid system
var gridShaderMaterial = null;  // ShaderMaterial on the ground plane
var gridLabelPool = [];         // recycled sprite pool for axis numbers
var gridAxisLabels = {};        // fixed axis name sprites { xLabel, zLabel, originLabel }
var gridLabelGroup = null;      // THREE.Group holding all label sprites


// ---------------------------------------------------------------------------
// Color Constants for Equipment Types
// ---------------------------------------------------------------------------

var QUENCHANT_COLORS = {
  oil: 0x332200,
  water: 0x224466,
  polymer: 0x225533,
  brine: 0x334455,
};

var RACK_COLORS = {
  raw_material:   0x3366aa,
  finished_goods: 0x33aa66,
  scrap:          0x886633,
  die_storage:    0x996699,
  tool_crib:      0x669999,
};

var TOOL_COLORS = {
  die: 0x996699,
  disc: 0x669999,
  cutter: 0x999966,
  fixture: 0x887766,
};

var UTILITY_COLORS = {
  electrical: 0xffff00,
  gas: 0xff4444,
  water: 0x4444ff,
  compressed_air: 0x44ff44,
};


// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Set the Three.js scene reference. Must be called once before any spawn.
 * @param {THREE.Scene} sceneRef
 */
export function initBuilder(sceneRef) {
  scene = sceneRef;
}

/**
 * Get the scene reference.
 */
export function getScene() {
  return scene;
}


// ============================================================================
// SCENE MANAGEMENT
// ============================================================================

/**
 * Add any Three.js object to the scene.
 */
export function addToScene(object) {
  if (scene && object) scene.add(object);
}

/**
 * Remove any Three.js object from the scene and dispose its resources.
 */
export function removeFromScene(object) {
  if (!scene || !object) return;
  scene.remove(object);
}

/**
 * Remove a spawned mesh by its registry ID.
 * Removes from scene and clears the tracked reference.
 */
export function despawn(registryId) {
  var mesh = spawnedMeshes[registryId];
  if (mesh) {
    removeFromScene(mesh);
    delete spawnedMeshes[registryId];
  }
}

/**
 * Get a spawned mesh by registry ID.
 */
export function getSpawnedMesh(registryId) {
  return spawnedMeshes[registryId] || null;
}

/**
 * Get all spawned meshes (read-only copy of keys).
 */
export function getSpawnedIds() {
  return Object.keys(spawnedMeshes);
}


// ============================================================================
// WORLD BUILDING — Floor, Grid, Zones, Walls, Pathways
// ============================================================================

/**
 * Build and add all world meshes (floor, grid overlay, zones, walls, pathways).
 * Call once after gridsquare.loadLayout().
 */
export function buildWorld() {
  buildFloor();
  buildGridOverlay();
  buildZoneOverlays();
  buildWalls();
  buildPathways();
}

/**
 * Build only the grid overlay lines (no floor, walls, zones, or pathways).
 */
export function buildGridOnly() {
  buildGridOverlay();
}

/**
 * Rebuild only the zone overlay meshes (after zone painting changes).
 */
export function rebuildZoneOverlays() {
  if (zoneOverlayGroup) removeFromScene(zoneOverlayGroup);
  buildZoneOverlays();
}

/**
 * Rebuild only the wall meshes (after wall add/remove).
 */
export function rebuildWalls() {
  if (wallGroup) removeFromScene(wallGroup);
  buildWalls();
}

/**
 * Rebuild only the pathway meshes.
 */
export function rebuildPathways() {
  if (pathwayGroup) removeFromScene(pathwayGroup);
  buildPathways();
}


// ---------------------------------------------------------------------------
// Floor Plane
// ---------------------------------------------------------------------------

function buildFloor() {
  var gw = getGridWidth();
  var gd = getGridDepth();
  var cs = getCellSize();

  var geometry = new THREE.PlaneGeometry(gw * cs, gd * cs);
  var material = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.9,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  floorMesh = new THREE.Mesh(geometry, material);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set((gw * cs) / 2, 0, (gd * cs) / 2);
  floorMesh.receiveShadow = true;
  floorMesh.userData.visibilityCategory = 'zones';

  addToScene(floorMesh);
}


// ---------------------------------------------------------------------------
// Grid Overlay (wireframe lines)
// ---------------------------------------------------------------------------

function buildGridOverlay() {
  // --- Shader-based infinite grid on a single large plane ---
  var planeSize = 2000;
  var geo = new THREE.PlaneGeometry(planeSize, planeSize);

  gridShaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uCamGround: { value: new THREE.Vector2(0, 0) },
      uFadeStart: { value: 25.0 },
      uFadeEnd:   { value: 55.0 },
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
      '  // --- Thin lines (every 1 unit) ---',
      '  float thinX = gridLine(vWorldXZ.x, 0.03);',
      '  float thinZ = gridLine(vWorldXZ.y, 0.03);',
      '  float thin = max(thinX, thinZ);',
      '',
      '  // --- Bold lines (every 10 units) ---',
      '  float boldX = gridLine(vWorldXZ.x / 10.0, 0.004);',
      '  float boldZ = gridLine(vWorldXZ.y / 10.0, 0.004);',
      '  float bold = max(boldX, boldZ);',
      '',
      '  // --- Origin axes ---',
      '  float axisXWidth = 0.06;',
      '  float axisZWidth = 0.06;',
      '  float fwX = fwidth(vWorldXZ.y);',
      '  float fwZ = fwidth(vWorldXZ.x);',
      '  float onAxisX = 1.0 - smoothstep(axisXWidth - fwX, axisXWidth + fwX, abs(vWorldXZ.y));',
      '  float onAxisZ = 1.0 - smoothstep(axisZWidth - fwZ, axisZWidth + fwZ, abs(vWorldXZ.x));',
      '',
      '  // Compose color and alpha',
      '  vec3 thinColor = vec3(0.30, 0.30, 0.30);',
      '  vec3 boldColor = vec3(0.42, 0.42, 0.42);',
      '  vec3 xAxisColor = vec3(1.0, 0.27, 0.27);',
      '  vec3 zAxisColor = vec3(0.27, 0.53, 1.0);',
      '',
      '  vec3 col = thinColor;',
      '  float alpha = thin * 0.25;',
      '',
      '  // Bold overwrites thin',
      '  col = mix(col, boldColor, bold);',
      '  alpha = max(alpha, bold * 0.4);',
      '',
      '  // X axis (z=0 line) overwrites',
      '  col = mix(col, xAxisColor, onAxisX);',
      '  alpha = max(alpha, onAxisX * 0.9);',
      '',
      '  // Z axis (x=0 line) overwrites',
      '  col = mix(col, zAxisColor, onAxisZ);',
      '  alpha = max(alpha, onAxisZ * 0.9);',
      '',
      '  alpha *= fade;',
      '  if (alpha < 0.005) discard;',
      '',
      '  gl_FragColor = vec4(col, alpha);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });

  var gridPlane = new THREE.Mesh(geo, gridShaderMaterial);
  gridPlane.rotation.x = -Math.PI / 2;
  gridPlane.position.set(0, 0.01, 0);
  gridPlane.userData.visibilityCategory = 'zones';

  gridOverlayMesh = gridPlane;
  addToScene(gridPlane);

  // --- Label system ---
  gridLabelGroup = new THREE.Group();
  addToScene(gridLabelGroup);

  // Pre-allocate a pool of label sprites (enough for visible range)
  // We'll show labels for every 10-unit mark within the fade radius
  var poolSize = 60;  // plenty for both axes
  for (var i = 0; i < poolSize; i++) {
    var sprite = makeTextSprite('0', '#888888');
    sprite.visible = false;
    gridLabelGroup.add(sprite);
    gridLabelPool.push(sprite);
  }

  // Fixed axis name labels
  gridAxisLabels.xLabel = makeTextSprite('X →', '#ff4444', 1.2);
  gridAxisLabels.xLabel.visible = false;
  gridLabelGroup.add(gridAxisLabels.xLabel);

  gridAxisLabels.zLabel = makeTextSprite('Z ↓', '#4488ff', 1.2);
  gridAxisLabels.zLabel.visible = false;
  gridLabelGroup.add(gridAxisLabels.zLabel);
}


// ---------------------------------------------------------------------------
// Grid Focus Update — call each frame with camera ground position + height
// ---------------------------------------------------------------------------

/**
 * Update the infinite grid fade and reposition axis labels around camera.
 *
 * @param {number} camX - Focus world X (camera orbit target)
 * @param {number} camZ - Focus world Z (camera orbit target)
 * @param {number} cameraHeight - Camera distance from orbit target (controls fade radius)
 */
export function updateGridFocus(camX, camZ, cameraHeight) {
  if (!gridShaderMaterial) return;

  var fadeStart = Math.max(16, cameraHeight * 0.70);
  var fadeEnd   = Math.max(32, cameraHeight * 1.50);

  // Update shader
  gridShaderMaterial.uniforms.uCamGround.value.set(camX, camZ);
  gridShaderMaterial.uniforms.uFadeStart.value = fadeStart;
  gridShaderMaterial.uniforms.uFadeEnd.value = fadeEnd;

  // --- Reposition labels around the camera ---
  if (!gridLabelGroup) return;

  var labelOffset = 1.8;
  var poolIdx = 0;

  // Hide all pool sprites first
  for (var i = 0; i < gridLabelPool.length; i++) {
    gridLabelPool[i].visible = false;
  }

  // Determine visible range for 10-unit marks
  var range = fadeEnd + 5;
  var minX = Math.floor((camX - range) / 10) * 10;
  var maxX = Math.ceil((camX + range) / 10) * 10;
  var minZ = Math.floor((camZ - range) / 10) * 10;
  var maxZ = Math.ceil((camZ + range) / 10) * 10;

  // X-axis labels (along z ≈ 0, offset slightly negative)
  for (var x = minX; x <= maxX; x += 10) {
    if (poolIdx >= gridLabelPool.length) break;
    var dx = x - camX;
    var dz = 0 - camZ;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > fadeEnd) continue;

    var sprite = gridLabelPool[poolIdx++];
    updateSpriteText(sprite, String(x), x === 0 ? '#ffffff' : '#ff6666');
    sprite.position.set(x, 0.1, -labelOffset);

    var ft = Math.max(0, Math.min(1, (dist - fadeStart) / (fadeEnd - fadeStart)));
    sprite.material.opacity = 1.0 - ft * ft * (3.0 - 2.0 * ft);
    sprite.visible = sprite.material.opacity > 0.01;
  }

  // Z-axis labels (along x ≈ 0, offset slightly negative)
  for (var z = minZ; z <= maxZ; z += 10) {
    if (poolIdx >= gridLabelPool.length) break;
    if (z === 0) continue; // origin covered by X label
    var dx = 0 - camX;
    var dz = z - camZ;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > fadeEnd) continue;

    var sprite = gridLabelPool[poolIdx++];
    updateSpriteText(sprite, String(z), '#6699ff');
    sprite.position.set(-labelOffset, 0.1, z);

    var ft = Math.max(0, Math.min(1, (dist - fadeStart) / (fadeEnd - fadeStart)));
    sprite.material.opacity = 1.0 - ft * ft * (3.0 - 2.0 * ft);
    sprite.visible = sprite.material.opacity > 0.01;
  }

  // Pin axis name labels to the edge of the fade bubble along each axis
  var bubbleEdge = fadeEnd * 0.9;  // slightly inside the edge so they're visible

  // X label: sits on the X axis (z=0), at the positive edge of the bubble from focus
  gridAxisLabels.xLabel.position.set(camX + bubbleEdge, 0.1, -labelOffset);
  gridAxisLabels.xLabel.material.opacity = 0.7;
  gridAxisLabels.xLabel.visible = true;

  // Z label: sits on the Z axis (x=0), at the positive edge of the bubble from focus
  gridAxisLabels.zLabel.position.set(-labelOffset, 0.1, camZ + bubbleEdge);
  gridAxisLabels.zLabel.material.opacity = 0.7;
  gridAxisLabels.zLabel.visible = true;
}


// ---------------------------------------------------------------------------
// Text Sprite Helpers
// ---------------------------------------------------------------------------

function makeTextSprite(text, color, scaleMult) {
  var canvas = document.createElement('canvas');
  var size = 128;
  canvas.width = size;
  canvas.height = size;

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  ctx.font = 'bold 64px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(text, size / 2, size / 2);

  var texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  var mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  var sprite = new THREE.Sprite(mat);
  var s = (scaleMult || 1.0) * 2.0;
  sprite.scale.set(s, s, 1);

  // Stash canvas ref for reuse
  sprite.userData._canvas = canvas;
  sprite.userData._text = text;
  sprite.userData._color = color;

  return sprite;
}

function updateSpriteText(sprite, text, color) {
  // Skip redraw if text and color haven't changed
  if (sprite.userData._text === text && sprite.userData._color === color) return;

  var canvas = sprite.userData._canvas;
  if (!canvas) return;
  var size = canvas.width;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = 'bold 64px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(text, size / 2, size / 2);

  sprite.material.map.needsUpdate = true;
  sprite.userData._text = text;
  sprite.userData._color = color;
}


// ---------------------------------------------------------------------------
// Zone Overlays (colored floor tiles per zone type)
// PERF: Merges all tiles of each zone type into a single BufferGeometry.
// Result: ~12 draw calls instead of ~2900.
// ---------------------------------------------------------------------------

function buildZoneOverlays() {
  var gw = getGridWidth();
  var gd = getGridDepth();
  var cs = getCellSize();

  var group = new THREE.Group();
  group.userData.visibilityCategory = 'zones';

  // Collect cells by zone type
  var zoneBuckets = {};
  for (var z = 0; z < gd; z++) {
    for (var x = 0; x < gw; x++) {
      var state = getCell(x, z);
      if (ZONE_COLORS[state]) {
        if (!zoneBuckets[state]) zoneBuckets[state] = [];
        zoneBuckets[state].push({ x: x, z: z });
      }
    }
  }

  var half = cs * 0.475; // slight gap between tiles

  var zoneTypes = Object.keys(zoneBuckets);
  for (var i = 0; i < zoneTypes.length; i++) {
    var zoneType = zoneTypes[i];
    var cells = zoneBuckets[zoneType];
    var colorHex = ZONE_COLORS[zoneType];

    // Merged geometry: 2 triangles per cell = 6 vertices = 18 floats
    var vertCount = cells.length * 6;
    var positions = new Float32Array(vertCount * 3);
    var idx = 0;

    for (var c = 0; c < cells.length; c++) {
      var cx = cells[c].x * cs + cs / 2;
      var cz = cells[c].z * cs + cs / 2;

      // Triangle 1
      positions[idx++] = cx - half; positions[idx++] = 0.01; positions[idx++] = cz + half;
      positions[idx++] = cx + half; positions[idx++] = 0.01; positions[idx++] = cz - half;
      positions[idx++] = cx + half; positions[idx++] = 0.01; positions[idx++] = cz + half;
      // Triangle 2
      positions[idx++] = cx - half; positions[idx++] = 0.01; positions[idx++] = cz + half;
      positions[idx++] = cx - half; positions[idx++] = 0.01; positions[idx++] = cz - half;
      positions[idx++] = cx + half; positions[idx++] = 0.01; positions[idx++] = cz - half;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    var mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.35,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData.visibilityCategory = 'zones';
    group.add(mesh);
  }

  zoneOverlayGroup = group;
  addToScene(group);
}


// ---------------------------------------------------------------------------
// Walls (InstancedMesh for performance — one draw call for all wall blocks)
// ---------------------------------------------------------------------------

function buildWalls() {
  var gw = getGridWidth();
  var gd = getGridDepth();
  var cs = getCellSize();
  var wh = getWallHeight();

  var group = new THREE.Group();
  group.userData.visibilityCategory = 'walls';

  // Find all cells marked as 'wall'
  var wallCells = [];
  for (var z = 0; z < gd; z++) {
    for (var x = 0; x < gw; x++) {
      if (getCell(x, z) === 'wall') {
        wallCells.push({ x: x, z: z });
      }
    }
  }

  if (wallCells.length > 0) {
    var wallGeo = new THREE.BoxGeometry(cs, wh, cs);
    var wallMat = new THREE.MeshStandardMaterial({
      color: 0x606060,
      roughness: 0.7,
      metalness: 0.2,
    });

    var instancedWall = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    instancedWall.castShadow = true;
    instancedWall.receiveShadow = true;
    instancedWall.userData.visibilityCategory = 'walls';

    var matrix = new THREE.Matrix4();
    for (var i = 0; i < wallCells.length; i++) {
      var cell = wallCells[i];
      matrix.identity();
      matrix.setPosition(
        cell.x * cs + cs / 2,
        wh / 2,
        cell.z * cs + cs / 2
      );
      instancedWall.setMatrixAt(i, matrix);
    }
    instancedWall.instanceMatrix.needsUpdate = true;

    group.add(instancedWall);
  }

  wallGroup = group;
  addToScene(group);
}


// ---------------------------------------------------------------------------
// Pathways (colored lines connecting waypoints)
// ---------------------------------------------------------------------------

function buildPathways() {
  var cs = getCellSize();
  var allPathways = getPathways();

  var group = new THREE.Group();
  group.userData.visibilityCategory = 'pathways';

  for (var p = 0; p < allPathways.length; p++) {
    var pathway = allPathways[p];
    if (pathway.waypoints.length < 2) continue;

    var linePoints = [];
    for (var w = 0; w < pathway.waypoints.length; w++) {
      var wp = pathway.waypoints[w];
      linePoints.push(
        wp.x * cs + cs / 2,
        0.03,
        wp.z * cs + cs / 2
      );
    }

    var lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));

    var lineColor = pathway.type === 'forklift' ? 0x66aaff :
                    pathway.type === 'manipulator' ? 0xffaa33 : 0xaaffaa;

    var lineMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });

    var line = new THREE.Line(lineGeo, lineMat);
    line.userData.visibilityCategory = 'pathways';
    line.userData.pathwayId = pathway.id;
    group.add(line);
  }

  pathwayGroup = group;
  addToScene(group);
}


// ============================================================================
// UTILITY MARKERS
// ============================================================================

/**
 * Build and add utility connection markers (electrical panels, gas lines, etc.)
 *
 * @param {object} utilitiesData — { electrical: [...], gas: [...], water: [...], compressed_air: [...] }
 */
export function buildUtilityMarkers(utilitiesData) {
  if (utilityGroup) removeFromScene(utilityGroup);

  var group = new THREE.Group();
  group.userData.visibilityCategory = 'utilities';

  var types = Object.keys(utilitiesData);
  for (var t = 0; t < types.length; t++) {
    var uType = types[t];
    var color = UTILITY_COLORS[uType] || 0xffffff;
    var list = utilitiesData[uType];

    for (var i = 0; i < list.length; i++) {
      var conn = list[i];
      var markerGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8);
      var markerMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.7,
      });
      var marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(conn.gridX + 0.5, 0.05, conn.gridZ + 0.5);
      marker.userData.visibilityCategory = 'utilities';
      marker.userData.utilityId = conn.id;
      marker.userData.utilityType = uType;
      group.add(marker);
    }
  }

  utilityGroup = group;
  addToScene(group);
}


// ============================================================================
// STATIC EQUIPMENT — Furnaces, Presses, Hammers, Quench Tanks, Racks
// ============================================================================
// Each spawn function:
//   1. Builds a THREE.Group from the equipment specs
//   2. Tags every child mesh with visibilityCategory and registryId
//   3. Positions the group at the correct world location
//   4. Adds to scene
//   5. Stores reference in spawnedMeshes
//   6. Returns the mesh group
//
// The caller (mainlogic or whoever) attaches the returned mesh to the
// registry entry: entry.mesh = spawnFurnace(...)


// ---------------------------------------------------------------------------
// Furnace
// ---------------------------------------------------------------------------
// Specs used: chamberSize.width, chamberSize.depth, chamberSize.height
// Visual: body box + door face + chimney vent

export function spawnFurnace(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var w = (specs.chamberSize.width + 1);
  var d = (specs.chamberSize.depth + 1);
  var h = specs.chamberSize.height + 0.5;

  // Main body
  var bodyGeo = new THREE.BoxGeometry(w, h, d);
  var bodyMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
    metalness: 0.3,
  });
  var body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.registryId = id;
  body.userData.registryType = 'furnace';
  body.userData.visibilityCategory = 'furnaces';
  body.userData.isFurnaceBody = true;
  group.add(body);

  // Door face (front, slightly protruding)
  var doorW = w * 0.6;
  var doorH = h * 0.7;
  var doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.15);
  var doorMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.6,
    metalness: 0.4,
  });
  var door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, doorH / 2 + 0.1, d / 2 + 0.08);
  door.castShadow = true;
  door.userData.visibilityCategory = 'furnaces';
  group.add(door);

  // Chimney/vent on top
  var ventGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 8);
  var ventMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.3 });
  var vent = new THREE.Mesh(ventGeo, ventMat);
  vent.position.set(0, h + 0.3, 0);
  vent.userData.visibilityCategory = 'furnaces';
  group.add(vent);

  // Tag the group
  group.userData.visibilityCategory = 'furnaces';
  group.userData.registryId = id;
  group.userData.registryType = 'furnace';

  // Position in world
  var gridWidth = specs.chamberSize.width + 1;
  var gridDepth = specs.chamberSize.depth + 1;
  group.position.set(
    gridX + gridWidth / 2,
    0,
    gridZ + gridDepth / 2
  );

  // Add to scene and track
  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Press
// ---------------------------------------------------------------------------
// Specs used: tonnage (unused visually), strokeLength, pressType
// Visual: base plate + 2 columns + crown beam + moving ram

export function spawnPress(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var baseW = 3;
  var baseD = 4;
  var frameH = 4;

  var frameMat = new THREE.MeshStandardMaterial({
    color: 0x556677,
    roughness: 0.6,
    metalness: 0.5,
  });

  // Base plate
  var baseGeo = new THREE.BoxGeometry(baseW, 0.4, baseD);
  var base = new THREE.Mesh(baseGeo, frameMat);
  base.position.y = 0.2;
  base.castShadow = true;
  base.receiveShadow = true;
  base.userData.visibilityCategory = 'presses';
  group.add(base);

  // Left column
  var colGeo = new THREE.BoxGeometry(0.4, frameH, 0.5);
  var leftCol = new THREE.Mesh(colGeo, frameMat);
  leftCol.position.set(-baseW / 2 + 0.3, frameH / 2 + 0.4, 0);
  leftCol.castShadow = true;
  leftCol.userData.visibilityCategory = 'presses';
  group.add(leftCol);

  // Right column
  var rightCol = new THREE.Mesh(colGeo, frameMat);
  rightCol.position.set(baseW / 2 - 0.3, frameH / 2 + 0.4, 0);
  rightCol.castShadow = true;
  rightCol.userData.visibilityCategory = 'presses';
  group.add(rightCol);

  // Crown (top beam)
  var crownGeo = new THREE.BoxGeometry(baseW, 0.5, 1.2);
  var crown = new THREE.Mesh(crownGeo, frameMat);
  crown.position.set(0, frameH + 0.15, 0);
  crown.castShadow = true;
  crown.userData.visibilityCategory = 'presses';
  group.add(crown);

  // Ram (moving part)
  var ramMat = new THREE.MeshStandardMaterial({
    color: 0x778899,
    roughness: 0.4,
    metalness: 0.6,
  });
  var ramGeo = new THREE.BoxGeometry(baseW * 0.7, 0.6, 1.0);
  var ram = new THREE.Mesh(ramGeo, ramMat);
  ram.position.set(0, frameH - 0.3, 0);
  ram.castShadow = true;
  ram.userData.visibilityCategory = 'presses';
  ram.userData.isRam = true;
  group.add(ram);

  // Tag the group
  group.userData.visibilityCategory = 'presses';
  group.userData.registryId = id;
  group.userData.registryType = 'press';
  group.userData.frameHeight = frameH;
  group.userData.strokeLength = specs.strokeLength || 0.5;

  // Position — presses use a 3×4 footprint
  group.position.set(gridX + 1.5, 0, gridZ + 2);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Hammer
// ---------------------------------------------------------------------------
// Specs used: strikeEnergy, blowRate (unused visually)
// Visual: anvil block + 2 uprights + crossbeam + moving tup

export function spawnHammer(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var frameMat = new THREE.MeshStandardMaterial({
    color: 0x665544,
    roughness: 0.7,
    metalness: 0.4,
  });

  // Anvil block (base)
  var anvilGeo = new THREE.BoxGeometry(1.8, 0.8, 2.0);
  var anvil = new THREE.Mesh(anvilGeo, frameMat);
  anvil.position.y = 0.4;
  anvil.castShadow = true;
  anvil.receiveShadow = true;
  anvil.userData.visibilityCategory = 'hammers';
  group.add(anvil);

  // Frame uprights
  var uprightGeo = new THREE.BoxGeometry(0.3, 3.0, 0.3);
  var leftUpright = new THREE.Mesh(uprightGeo, frameMat);
  leftUpright.position.set(-0.7, 2.3, 0);
  leftUpright.castShadow = true;
  leftUpright.userData.visibilityCategory = 'hammers';
  group.add(leftUpright);

  var rightUpright = new THREE.Mesh(uprightGeo, frameMat);
  rightUpright.position.set(0.7, 2.3, 0);
  rightUpright.castShadow = true;
  rightUpright.userData.visibilityCategory = 'hammers';
  group.add(rightUpright);

  // Top crossbeam
  var crossGeo = new THREE.BoxGeometry(1.8, 0.3, 0.5);
  var cross = new THREE.Mesh(crossGeo, frameMat);
  cross.position.set(0, 3.65, 0);
  cross.castShadow = true;
  cross.userData.visibilityCategory = 'hammers';
  group.add(cross);

  // Tup (striking head — the moving part)
  var tupMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    roughness: 0.3,
    metalness: 0.7,
  });
  var tupGeo = new THREE.BoxGeometry(0.8, 0.5, 0.8);
  var tup = new THREE.Mesh(tupGeo, tupMat);
  tup.position.set(0, 2.5, 0);
  tup.castShadow = true;
  tup.userData.visibilityCategory = 'hammers';
  tup.userData.isTup = true;
  group.add(tup);

  group.userData.visibilityCategory = 'hammers';
  group.userData.registryId = id;
  group.userData.registryType = 'hammer';

  // Hammers use a 2×2 footprint
  group.position.set(gridX + 1, 0, gridZ + 1);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Quench Tank
// ---------------------------------------------------------------------------
// Specs used: quenchantType (for liquid color)
// Visual: open-top box with 4 walls + bottom + semi-transparent liquid plane

export function spawnQuenchTank(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var w = 3;
  var d = 3;
  var h = 1.2;
  var wallThickness = 0.15;

  var tankMat = new THREE.MeshStandardMaterial({
    color: 0x445566,
    roughness: 0.6,
    metalness: 0.4,
  });

  // Front wall
  var frontGeo = new THREE.BoxGeometry(w, h, wallThickness);
  var front = new THREE.Mesh(frontGeo, tankMat);
  front.position.set(0, h / 2, d / 2 - wallThickness / 2);
  front.castShadow = true;
  front.userData.visibilityCategory = 'quenchTanks';
  group.add(front);

  // Back wall
  var back = new THREE.Mesh(frontGeo, tankMat);
  back.position.set(0, h / 2, -d / 2 + wallThickness / 2);
  back.castShadow = true;
  back.userData.visibilityCategory = 'quenchTanks';
  group.add(back);

  // Left wall
  var sideGeo = new THREE.BoxGeometry(wallThickness, h, d);
  var left = new THREE.Mesh(sideGeo, tankMat);
  left.position.set(-w / 2 + wallThickness / 2, h / 2, 0);
  left.castShadow = true;
  left.userData.visibilityCategory = 'quenchTanks';
  group.add(left);

  // Right wall
  var right = new THREE.Mesh(sideGeo, tankMat);
  right.position.set(w / 2 - wallThickness / 2, h / 2, 0);
  right.castShadow = true;
  right.userData.visibilityCategory = 'quenchTanks';
  group.add(right);

  // Bottom
  var bottomGeo = new THREE.BoxGeometry(w, wallThickness, d);
  var bottom = new THREE.Mesh(bottomGeo, tankMat);
  bottom.position.set(0, wallThickness / 2, 0);
  bottom.receiveShadow = true;
  bottom.userData.visibilityCategory = 'quenchTanks';
  group.add(bottom);

  // Liquid surface (semi-transparent)
  var liquidColor = QUENCHANT_COLORS[specs.quenchantType] || 0x224466;
  var liquidGeo = new THREE.PlaneGeometry(w - wallThickness * 2, d - wallThickness * 2);
  var liquidMat = new THREE.MeshStandardMaterial({
    color: liquidColor,
    transparent: true,
    opacity: 0.6,
    roughness: 0.2,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  var liquid = new THREE.Mesh(liquidGeo, liquidMat);
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.y = h * 0.75;
  liquid.userData.visibilityCategory = 'quenchTanks';
  liquid.userData.isLiquid = true;
  group.add(liquid);

  group.userData.visibilityCategory = 'quenchTanks';
  group.userData.registryId = id;
  group.userData.registryType = 'quench';

  // Quench tanks use a 3×3 footprint
  group.position.set(gridX + 1.5, 0, gridZ + 1.5);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Rack
// ---------------------------------------------------------------------------
// Specs used: rackType (for color)
// Visual: 4 vertical posts + horizontal shelves

export function spawnRack(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var w = 2;
  var d = 3;
  var h = 2.5;
  var shelfCount = 3;

  var color = RACK_COLORS[specs.rackType] || 0x888888;

  var frameMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,
    metalness: 0.3,
  });

  // 4 vertical posts
  var postGeo = new THREE.BoxGeometry(0.08, h, 0.08);
  var postPositions = [
    [-w / 2 + 0.04, h / 2, -d / 2 + 0.04],
    [w / 2 - 0.04,  h / 2, -d / 2 + 0.04],
    [-w / 2 + 0.04, h / 2, d / 2 - 0.04],
    [w / 2 - 0.04,  h / 2, d / 2 - 0.04],
  ];
  for (var p = 0; p < postPositions.length; p++) {
    var post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(postPositions[p][0], postPositions[p][1], postPositions[p][2]);
    post.castShadow = true;
    post.userData.visibilityCategory = 'racks';
    group.add(post);
  }

  // Shelves
  var shelfGeo = new THREE.BoxGeometry(w - 0.1, 0.05, d - 0.1);
  var shelfMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.8,
    metalness: 0.2,
  });
  for (var s = 0; s <= shelfCount; s++) {
    var shelfY = (s / shelfCount) * (h - 0.1) + 0.05;
    var shelf = new THREE.Mesh(shelfGeo, shelfMat);
    shelf.position.set(0, shelfY, 0);
    shelf.receiveShadow = true;
    shelf.userData.visibilityCategory = 'racks';
    group.add(shelf);
  }

  group.userData.visibilityCategory = 'racks';
  group.userData.registryId = id;
  group.userData.registryType = 'rack';

  // Racks use a 2×3 footprint
  group.position.set(gridX + 1, 0, gridZ + 1.5);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ============================================================================
// MOBILE EQUIPMENT — Forklifts, Manipulators, Trucks, Tools
// ============================================================================


// ---------------------------------------------------------------------------
// Forklift
// ---------------------------------------------------------------------------
// Visual: body + cab/roof + 2 mast rails + 2 fork tines + 4 wheels

export function spawnForklift(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var bodyMat = new THREE.MeshStandardMaterial({
    color: 0xccaa33,
    roughness: 0.6,
    metalness: 0.3,
  });

  // Body
  var bodyGeo = new THREE.BoxGeometry(1.4, 1.0, 2.2);
  var body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.7, 0);
  body.castShadow = true;
  body.userData.visibilityCategory = 'forklifts';
  group.add(body);

  // Cab/roof
  var cabGeo = new THREE.BoxGeometry(1.2, 0.6, 1.0);
  var cabMat = new THREE.MeshStandardMaterial({ color: 0x888866, roughness: 0.7, metalness: 0.2 });
  var cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(0, 1.5, -0.3);
  cab.castShadow = true;
  cab.userData.visibilityCategory = 'forklifts';
  group.add(cab);

  // Mast (vertical rails in front)
  var mastMat = new THREE.MeshStandardMaterial({ color: 0x666655, roughness: 0.5, metalness: 0.5 });
  var mastGeo = new THREE.BoxGeometry(0.1, 2.5, 0.1);
  var leftMast = new THREE.Mesh(mastGeo, mastMat);
  leftMast.position.set(-0.4, 1.45, 1.0);
  leftMast.userData.visibilityCategory = 'forklifts';
  group.add(leftMast);

  var rightMast = new THREE.Mesh(mastGeo, mastMat);
  rightMast.position.set(0.4, 1.45, 1.0);
  rightMast.userData.visibilityCategory = 'forklifts';
  group.add(rightMast);

  // Fork tines
  var forkMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 });
  var forkGeo = new THREE.BoxGeometry(0.15, 0.08, 1.2);
  var leftFork = new THREE.Mesh(forkGeo, forkMat);
  leftFork.position.set(-0.35, 0.2, 1.5);
  leftFork.userData.visibilityCategory = 'forklifts';
  leftFork.userData.isFork = true;
  group.add(leftFork);

  var rightFork = new THREE.Mesh(forkGeo, forkMat);
  rightFork.position.set(0.35, 0.2, 1.5);
  rightFork.userData.visibilityCategory = 'forklifts';
  rightFork.userData.isFork = true;
  group.add(rightFork);

  // Wheels
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  var wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8);
  var wheelPositions = [
    [-0.7, 0.25, -0.7], [0.7, 0.25, -0.7],
    [-0.7, 0.25, 0.7],  [0.7, 0.25, 0.7],
  ];
  for (var w = 0; w < wheelPositions.length; w++) {
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wheelPositions[w][0], wheelPositions[w][1], wheelPositions[w][2]);
    wheel.userData.visibilityCategory = 'forklifts';
    group.add(wheel);
  }

  group.userData.visibilityCategory = 'forklifts';
  group.userData.registryId = id;
  group.userData.registryType = 'forklift';

  // Position at grid center (1×1 footprint, centered)
  group.position.set(gridX + 0.5, 0, gridZ + 0.5);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Manipulator
// ---------------------------------------------------------------------------
// Visual: tracked base + treads + turret + arm + gripper jaws

export function spawnManipulator(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var baseMat = new THREE.MeshStandardMaterial({
    color: 0xcc6633,
    roughness: 0.6,
    metalness: 0.3,
  });

  // Mobile base (tracked platform)
  var baseGeo = new THREE.BoxGeometry(1.6, 0.5, 1.8);
  var base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.35, 0);
  base.castShadow = true;
  base.userData.visibilityCategory = 'manipulators';
  group.add(base);

  // Track treads
  var treadMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
  var treadGeo = new THREE.BoxGeometry(0.3, 0.3, 1.8);
  var leftTread = new THREE.Mesh(treadGeo, treadMat);
  leftTread.position.set(-0.8, 0.15, 0);
  leftTread.userData.visibilityCategory = 'manipulators';
  group.add(leftTread);

  var rightTread = new THREE.Mesh(treadGeo, treadMat);
  rightTread.position.set(0.8, 0.15, 0);
  rightTread.userData.visibilityCategory = 'manipulators';
  group.add(rightTread);

  // Turret/pivot
  var turretGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.4, 12);
  var turretMat = new THREE.MeshStandardMaterial({ color: 0xaa5522, roughness: 0.5, metalness: 0.4 });
  var turret = new THREE.Mesh(turretGeo, turretMat);
  turret.position.set(0, 0.8, 0);
  turret.userData.visibilityCategory = 'manipulators';
  group.add(turret);

  // Arm
  var armMat = new THREE.MeshStandardMaterial({ color: 0x888877, roughness: 0.5, metalness: 0.5 });
  var armGeo = new THREE.BoxGeometry(0.2, 0.2, 2.5);
  var arm = new THREE.Mesh(armGeo, armMat);
  arm.position.set(0, 1.1, 1.0);
  arm.castShadow = true;
  arm.userData.visibilityCategory = 'manipulators';
  arm.userData.isArm = true;
  group.add(arm);

  // Gripper jaws
  var gripMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.6 });
  var gripGeo = new THREE.BoxGeometry(0.5, 0.15, 0.3);
  var gripLeft = new THREE.Mesh(gripGeo, gripMat);
  gripLeft.position.set(-0.2, 1.05, 2.3);
  gripLeft.userData.visibilityCategory = 'manipulators';
  gripLeft.userData.isGripper = true;
  group.add(gripLeft);

  var gripRight = new THREE.Mesh(gripGeo, gripMat);
  gripRight.position.set(0.2, 1.05, 2.3);
  gripRight.userData.visibilityCategory = 'manipulators';
  gripRight.userData.isGripper = true;
  group.add(gripRight);

  group.userData.visibilityCategory = 'manipulators';
  group.userData.registryId = id;
  group.userData.registryType = 'manipulator';

  group.position.set(gridX + 0.5, 0, gridZ + 0.5);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Truck
// ---------------------------------------------------------------------------
// Specs used: direction (inbound/outbound — changes color)
// Visual: cab + windshield + flatbed + bed rails + 6 wheels

export function spawnTruck(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var truckColor = specs.direction === 'inbound' ? 0x556677 : 0x667755;

  var bodyMat = new THREE.MeshStandardMaterial({
    color: truckColor,
    roughness: 0.7,
    metalness: 0.3,
  });

  // Cab
  var cabGeo = new THREE.BoxGeometry(2.4, 1.8, 2.0);
  var cab = new THREE.Mesh(cabGeo, bodyMat);
  cab.position.set(0, 1.1, -1.5);
  cab.castShadow = true;
  cab.userData.visibilityCategory = 'trucks';
  group.add(cab);

  // Windshield
  var windGeo = new THREE.PlaneGeometry(2.0, 1.0);
  var windMat = new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  var windshield = new THREE.Mesh(windGeo, windMat);
  windshield.position.set(0, 1.6, -0.5);
  windshield.userData.visibilityCategory = 'trucks';
  group.add(windshield);

  // Bed/trailer
  var bedGeo = new THREE.BoxGeometry(2.6, 0.3, 4.0);
  var bed = new THREE.Mesh(bedGeo, bodyMat);
  bed.position.set(0, 0.65, 1.5);
  bed.castShadow = true;
  bed.receiveShadow = true;
  bed.userData.visibilityCategory = 'trucks';
  group.add(bed);

  // Bed rails
  var railMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.4 });
  var railGeo = new THREE.BoxGeometry(0.08, 0.6, 4.0);
  var leftRail = new THREE.Mesh(railGeo, railMat);
  leftRail.position.set(-1.25, 1.1, 1.5);
  leftRail.userData.visibilityCategory = 'trucks';
  group.add(leftRail);

  var rightRail = new THREE.Mesh(railGeo, railMat);
  rightRail.position.set(1.25, 1.1, 1.5);
  rightRail.userData.visibilityCategory = 'trucks';
  group.add(rightRail);

  // Wheels (6 — front axle, 2 rear axles)
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  var wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  var wheelPos = [
    [-1.2, 0.35, -1.8], [1.2, 0.35, -1.8],
    [-1.2, 0.35, 0.5],  [1.2, 0.35, 0.5],
    [-1.2, 0.35, 2.5],  [1.2, 0.35, 2.5],
  ];
  for (var w = 0; w < wheelPos.length; w++) {
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wheelPos[w][0], wheelPos[w][1], wheelPos[w][2]);
    wheel.userData.visibilityCategory = 'trucks';
    group.add(wheel);
  }

  group.userData.visibilityCategory = 'trucks';
  group.userData.registryId = id;
  group.userData.registryType = 'truck';

  // Position (trucks use a 3×6 area, but position set by caller on arrival)
  if (gridX !== undefined && gridZ !== undefined) {
    group.position.set(gridX + 1.5, 0, gridZ + 3);
  }

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ---------------------------------------------------------------------------
// Tool / Die
// ---------------------------------------------------------------------------
// Specs used: toolType (for color/shape), dimensions (w/h/d)
// Visual: single box or cylinder depending on toolType

export function spawnTool(id, gridX, gridZ, specs) {
  var group = new THREE.Group();

  var color = TOOL_COLORS[specs.toolType] || 0x888888;
  var dims = specs.dimensions || { width: 0.3, depth: 0.3, height: 0.2 };

  var toolMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    metalness: 0.6,
  });

  var toolGeo;
  if (specs.toolType === 'disc') {
    toolGeo = new THREE.CylinderGeometry(dims.width / 2, dims.width / 2, dims.height, 16);
  } else {
    // die, cutter, fixture — box
    toolGeo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
  }

  var tool = new THREE.Mesh(toolGeo, toolMat);
  tool.position.y = dims.height / 2;
  tool.castShadow = true;
  tool.userData.visibilityCategory = 'tools';
  tool.userData.registryId = id;
  tool.userData.registryType = 'tool';
  group.add(tool);

  group.userData.visibilityCategory = 'tools';
  group.userData.registryId = id;
  group.userData.registryType = 'tool';

  group.position.set(gridX + 0.5, 0, gridZ + 0.5);

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ============================================================================
// PRODUCTS — Metal Parts
// ============================================================================

/**
 * Spawn a metal part product mesh.
 *
 * @param {string} id - Product registry ID (e.g. 'MP-001')
 * @param {object} dimensions - { length, width, height } in meters
 * @param {boolean} [visible=false] - Whether to show immediately
 * @returns {THREE.Group}
 */
export function spawnMetalPart(id, dimensions, visible) {
  var group = new THREE.Group();

  var geo = new THREE.BoxGeometry(1, 1, 1);
  var mat = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.5,
    metalness: 0.4,
  });

  var mesh = new THREE.Mesh(geo, mat);

  // Scale to actual dimensions
  mesh.scale.set(
    dimensions.width || 0.15,
    dimensions.height || 0.15,
    dimensions.length || 0.5
  );
  mesh.position.y = (dimensions.height || 0.15) / 2;

  mesh.castShadow = true;
  mesh.userData.visibilityCategory = 'products';
  mesh.userData.registryId = id;
  mesh.userData.registryType = 'metalpart';
  mesh.userData.isProductBody = true;

  group.add(mesh);

  group.userData.visibilityCategory = 'products';
  group.userData.registryId = id;
  group.userData.registryType = 'metalpart';

  // Products start invisible until placed at a location
  group.visible = visible === true;

  addToScene(group);
  spawnedMeshes[id] = group;

  return group;
}


// ============================================================================
// MESH POSITIONING HELPERS
// ============================================================================

/**
 * Move a spawned mesh to a specific world position.
 * @param {string} id - Registry ID
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} worldZ
 */
export function setMeshPosition(id, worldX, worldY, worldZ) {
  var mesh = spawnedMeshes[id];
  if (!mesh) return;
  mesh.position.set(worldX, worldY, worldZ);
}

/**
 * Move a spawned mesh to the center of a grid cell.
 * @param {string} id - Registry ID
 * @param {number} gridX
 * @param {number} gridZ
 * @param {number} [yOffset=0]
 */
export function setMeshGridPosition(id, gridX, gridZ, yOffset) {
  var pos = gridToWorld(gridX, gridZ);
  var mesh = spawnedMeshes[id];
  if (!mesh) return;
  mesh.position.set(pos.x, yOffset || 0, pos.z);
}

/**
 * Show a spawned mesh.
 */
export function showMesh(id) {
  var mesh = spawnedMeshes[id];
  if (mesh) mesh.visible = true;
}

/**
 * Hide a spawned mesh.
 */
export function hideMesh(id) {
  var mesh = spawnedMeshes[id];
  if (mesh) mesh.visible = false;
}

/**
 * Set the rotation of a spawned mesh (Y axis, in radians).
 */
export function setMeshRotation(id, yRadians) {
  var mesh = spawnedMeshes[id];
  if (mesh) mesh.rotation.y = yRadians;
}


// ============================================================================
// WORLD MESH GETTERS (for external reference if needed)
// ============================================================================

export function getFloorMesh() { return floorMesh; }
export function getGridOverlayMesh() { return gridOverlayMesh; }
export function getZoneOverlayGroup() { return zoneOverlayGroup; }
export function getWallGroup() { return wallGroup; }
export function getPathwayGroup() { return pathwayGroup; }
export function getUtilityGroup() { return utilityGroup; }