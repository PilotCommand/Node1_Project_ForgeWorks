// ============================================================================
// mode_select.js — Select Mode
// Forgeworks Infrastructure
// ============================================================================
// Handles clicking and inspecting objects on the forge floor.
// Active when the user is selecting equipment, products, or zones
// to view details or modify properties.
//
// Click any object or zone in the 3D scene to show its details in the
// Information panel and highlight it in the Registry panel.
//
// Cursor: cyan ring follows mouse on ground plane.
// Click:  left-click selects whatever is under the cursor.
//         Priority: 3D mesh hit → static equipment → mobile → zone
//
// Imports: visualhud, floorplan, registries
// Exports: activate(), deactivate(), update()
// ============================================================================

import * as THREE from 'three';
import { getCamera, getRenderer, addToScene, removeFromScene, setInfoContent, selectRegistryItem } from './visualhud.js';
import { getZonesAtCell, getZoneLabel, getZoneColor } from './floorplan.js';
import { get as getStatic, getAtPosition as getStaticAtPos } from '../static_equipment/static_registry.js';
import { get as getMobile, getAtPosition as getMobileAtPos } from '../mobile_equipment/mobile_registry.js';
import { get as getProduct, getAll as getAllProducts } from '../production_entities/product_registry.js';

let active = false;

// Raycasting
let raycaster = new THREE.Raycaster();
let mouseVec = new THREE.Vector2();
let groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let intersectPoint = new THREE.Vector3();

// Cursor
let cursorMesh = null;

// Selection highlight
let selectionHighlight = null;
let selectedId = null;

// Bound listener references
let onMouseMoveBound = null;
let onClickBound = null;

// ---------------------------------------------------------------------------
// Activate / Deactivate
// ---------------------------------------------------------------------------

/**
 * Called when switching TO select mode.
 */
export function activate() {
  active = true;

  // --- Cursor ring ---
  if (!cursorMesh) {
    var group = new THREE.Group();
    var radius = 0.35;
    var segments = 48;

    // Ring
    var ringPts = [];
    for (var i = 0; i <= segments; i++) {
      var a = (i / segments) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * radius, 0.03, Math.sin(a) * radius));
    }
    var ringMat = new THREE.LineBasicMaterial({ color: 0x00ffc8, transparent: true, opacity: 0.7 });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat));

    // Crosshair lines (small)
    var chSize = 0.12;
    var chMat = new THREE.LineBasicMaterial({ color: 0x00ffc8, transparent: true, opacity: 0.5 });
    var chGeo = new THREE.BufferGeometry();
    chGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -chSize, 0.03, 0,  chSize, 0.03, 0,
       0, 0.03, -chSize,  0, 0.03, chSize,
    ], 3));
    group.add(new THREE.LineSegments(chGeo, chMat));

    cursorMesh = group;
    cursorMesh.visible = false;
  }
  addToScene(cursorMesh);

  // --- Selection highlight box ---
  if (!selectionHighlight) {
    selectionHighlight = createSelectionHighlight();
    selectionHighlight.visible = false;
  }
  addToScene(selectionHighlight);

  // --- Event listeners ---
  var domEl = getRenderer().domElement;
  onMouseMoveBound = onMouseMove;
  onClickBound = onClick;
  domEl.addEventListener('mousemove', onMouseMoveBound);
  domEl.addEventListener('click', onClickBound);
}

/**
 * Called when switching AWAY from select mode.
 */
export function deactivate() {
  active = false;

  if (cursorMesh) { cursorMesh.visible = false; removeFromScene(cursorMesh); }
  if (selectionHighlight) { selectionHighlight.visible = false; removeFromScene(selectionHighlight); }

  selectedId = null;
  setInfoContent(null);
  selectRegistryItem(null);

  var domEl = getRenderer() && getRenderer().domElement;
  if (domEl) {
    if (onMouseMoveBound) domEl.removeEventListener('mousemove', onMouseMoveBound);
    if (onClickBound) domEl.removeEventListener('click', onClickBound);
  }
  onMouseMoveBound = null;
  onClickBound = null;
}

// ---------------------------------------------------------------------------
// Raycast helpers
// ---------------------------------------------------------------------------

function raycastToGround(event) {
  var renderer = getRenderer();
  var camera = getCamera();
  if (!renderer || !camera) return null;

  var rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseVec, camera);
  var hit = raycaster.ray.intersectPlane(groundPlane, intersectPoint);
  if (!hit) return null;

  return {
    x: Math.floor(intersectPoint.x),
    z: Math.floor(intersectPoint.z),
    worldX: intersectPoint.x,
    worldZ: intersectPoint.z,
  };
}

/**
 * Raycast the scene and walk up parent chain to find an object with registryId.
 */
function raycastToObject(event) {
  var renderer = getRenderer();
  var camera = getCamera();
  if (!renderer || !camera) return null;

  var rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseVec, camera);

  // Get scene root by walking up from camera
  var sceneRoot = camera;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent;

  var intersects = raycaster.intersectObjects(sceneRoot.children, true);

  for (var i = 0; i < intersects.length; i++) {
    var obj = intersects[i].object;

    // Skip our own cursor and selection highlight
    if (isOwnMesh(obj)) continue;

    // Walk up parent chain to find registryId
    var current = obj;
    while (current) {
      if (current.userData && current.userData.registryId) {
        return {
          registryId: current.userData.registryId,
          registryType: current.userData.registryType,
          point: intersects[i].point,
        };
      }
      current = current.parent;
    }
  }

  return null;
}

function isOwnMesh(obj) {
  var current = obj;
  while (current) {
    if (current === cursorMesh || current === selectionHighlight) return true;
    current = current.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Product position lookup (products don't store grid coords, use mesh position)
// ---------------------------------------------------------------------------

/**
 * Find a product whose mesh is near the given grid cell.
 * Searches all products and checks mesh world position within 1 cell tolerance.
 */
function findProductNearCell(gridX, gridZ) {
  var all = getAllProducts();
  var bestDist = 1.5;  // tolerance in grid units
  var best = null;

  for (var i = 0; i < all.length; i++) {
    var entry = all[i];
    if (!entry.mesh) continue;

    var mx = entry.mesh.position.x;
    var mz = entry.mesh.position.z;

    var dx = mx - (gridX + 0.5);
    var dz = mz - (gridZ + 0.5);
    var dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Selection highlight
// ---------------------------------------------------------------------------

function createSelectionHighlight() {
  var group = new THREE.Group();

  // A wireframe box that will be scaled to fit the selected object
  var geo = new THREE.BoxGeometry(1, 1, 1);
  var edges = new THREE.EdgesGeometry(geo);
  var mat = new THREE.LineBasicMaterial({
    color: 0x00ffc8,
    transparent: true,
    opacity: 0.6,
  });
  var wireframe = new THREE.LineSegments(edges, mat);
  group.add(wireframe);

  // A ground plane glow under the object
  var glowGeo = new THREE.PlaneGeometry(1, 1);
  var glowMat = new THREE.MeshBasicMaterial({
    color: 0x00ffc8,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  var glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.01;
  group.add(glow);

  return group;
}

function positionHighlightOnRect(rect) {
  if (!selectionHighlight) return;

  var w = rect.maxX - rect.minX + 1;
  var h = rect.maxZ - rect.minZ + 1;
  var cx = rect.minX + w / 2;
  var cz = rect.minZ + h / 2;

  // Wireframe box
  var wireframe = selectionHighlight.children[0];
  if (wireframe) {
    wireframe.scale.set(w + 0.1, 0.3, h + 0.1);
    wireframe.position.set(cx, 0.15, cz);
  }

  // Ground glow
  var glow = selectionHighlight.children[1];
  if (glow) {
    glow.scale.set(w + 0.2, h + 0.2, 1);
    glow.position.set(cx, 0.01, cz);
  }

  selectionHighlight.visible = true;
}

function positionHighlightOnEquipment(entry) {
  if (!selectionHighlight) return;

  var w = entry.gridWidth;
  var h = entry.gridDepth;
  var cx = entry.gridX + w / 2;
  var cz = entry.gridZ + h / 2;
  var boxH = 2.5;

  // Wireframe box
  var wireframe = selectionHighlight.children[0];
  if (wireframe) {
    wireframe.scale.set(w + 0.15, boxH, h + 0.15);
    wireframe.position.set(cx, boxH / 2, cz);
  }

  // Ground glow
  var glow = selectionHighlight.children[1];
  if (glow) {
    glow.scale.set(w + 0.3, h + 0.3, 1);
    glow.position.set(cx, 0.01, cz);
  }

  selectionHighlight.visible = true;
}

function positionHighlightOnProduct(entry) {
  if (!selectionHighlight) return;

  // Products use mesh world position, not grid coords
  var pos = entry.mesh ? entry.mesh.position : null;
  if (!pos) return;

  var cx = pos.x;
  var cz = pos.z;
  var size = 1.0;
  var boxH = 0.6;

  // Wireframe box (small, product-sized)
  var wireframe = selectionHighlight.children[0];
  if (wireframe) {
    wireframe.scale.set(size, boxH, size);
    wireframe.position.set(cx, boxH / 2, cz);
  }

  // Ground glow
  var glow = selectionHighlight.children[1];
  if (glow) {
    glow.scale.set(size + 0.2, size + 0.2, 1);
    glow.position.set(cx, 0.01, cz);
  }

  selectionHighlight.visible = true;
}

// ---------------------------------------------------------------------------
// Mouse Events
// ---------------------------------------------------------------------------

function onMouseMove(event) {
  var cell = raycastToGround(event);

  if (cell) {
    cursorMesh.position.set(cell.worldX, 0, cell.worldZ);
    cursorMesh.visible = true;
  } else {
    cursorMesh.visible = false;
  }
}

function onClick(event) {
  if (event.button !== 0) return;

  // 1. Try hitting a 3D object with registryId
  var objectHit = raycastToObject(event);
  if (objectHit) {
    var result = selectByRegistryId(objectHit.registryId, objectHit.registryType);
    if (result) return;
  }

  // 2. Fall back to grid position lookup
  var cell = raycastToGround(event);
  if (!cell) {
    clearSelection();
    return;
  }

  // Try static equipment at position
  var staticEntry = getStaticAtPos(cell.x, cell.z);
  if (staticEntry) {
    selectByRegistryId(staticEntry.id, staticEntry.type);
    return;
  }

  // Try mobile equipment at position
  var mobileEntry = getMobileAtPos(cell.x, cell.z);
  if (mobileEntry) {
    selectByRegistryId(mobileEntry.id, mobileEntry.type);
    return;
  }

  // Try products at position (products don't have grid positions, check mesh world position)
  var productEntry = findProductNearCell(cell.x, cell.z);
  if (productEntry) {
    selectByRegistryId(productEntry.id, productEntry.type);
    return;
  }

  // Try zones at position
  var zones = getZonesAtCell(cell.x, cell.z);
  if (zones.length > 0) {
    selectZone(zones[0]);
    return;
  }

  // Nothing found — clear selection
  clearSelection();
}

// ---------------------------------------------------------------------------
// Selection logic
// ---------------------------------------------------------------------------

var STATIC_TYPES = { furnace: true, press: true, hammer: true, quench: true, rack: true };
var MOBILE_TYPES = { forklift: true, manipulator: true, truck: true, tool: true };

function selectByRegistryId(id, type) {
  // Look up in the appropriate registry
  var entry = null;
  var category = null;

  if (STATIC_TYPES[type]) {
    entry = getStatic(id);
    category = 'stationary';
  } else if (MOBILE_TYPES[type]) {
    entry = getMobile(id);
    category = 'mobile';
  } else if (type === 'metalpart') {
    entry = getProduct(id);
    category = 'products';
  }

  if (!entry) return false;

  selectedId = id;

  // Build info content based on type
  var infoData = {
    type: category === 'products' ? 'product' : (category === 'mobile' ? 'mobile' : 'equipment'),
    id: entry.id,
    name: entry.name || entry.materialGrade || entry.id,
    properties: [],
    status: entry.status || entry.state || null,
  };

  // Common position info
  if (entry.gridX !== undefined) {
    infoData.properties.push({ label: 'Position', value: '(' + entry.gridX + ', ' + entry.gridZ + ')' });
  }
  if (entry.gridWidth !== undefined) {
    infoData.properties.push({ label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth });
  }

  // Type-specific details
  if (type === 'furnace' && entry.specs) {
    infoData.properties.push({ label: 'Fuel', value: entry.specs.fuelType || '—' });
    infoData.properties.push({ label: 'Max Temp', value: entry.specs.maxTemp + ' °C' });
    if (entry.specs.currentTemp !== undefined) {
      infoData.properties.push({ label: 'Temp', value: Math.round(entry.specs.currentTemp) + ' °C' });
    }
    if (entry.specs.maxContents !== undefined) {
      var cur = entry.specs.contents ? entry.specs.contents.length : 0;
      infoData.properties.push({ label: 'Contents', value: cur + ' / ' + entry.specs.maxContents });
    }
  } else if (type === 'press' && entry.specs) {
    infoData.properties.push({ label: 'Tonnage', value: entry.specs.tonnage + ' T' });
    infoData.properties.push({ label: 'Type', value: entry.specs.pressType || '—' });
    infoData.properties.push({ label: 'Cycle Time', value: entry.specs.cycleTime + ' s' });
  } else if (type === 'hammer' && entry.specs) {
    infoData.properties.push({ label: 'Strike Energy', value: entry.specs.strikeEnergy + ' J' });
    infoData.properties.push({ label: 'Blow Rate', value: entry.specs.blowRate + ' /min' });
  } else if (type === 'quench' && entry.specs) {
    infoData.properties.push({ label: 'Quenchant', value: entry.specs.quenchantType || '—' });
    infoData.properties.push({ label: 'Volume', value: entry.specs.tankVolume + ' L' });
    if (entry.specs.currentTemp !== undefined) {
      infoData.properties.push({ label: 'Temp', value: Math.round(entry.specs.currentTemp) + ' °C' });
    }
  } else if (type === 'rack' && entry.specs) {
    infoData.properties.push({ label: 'Rack Type', value: entry.specs.rackType || '—' });
    var curCount = entry.specs.currentContents ? entry.specs.currentContents.length : 0;
    infoData.properties.push({ label: 'Occupancy', value: curCount + ' / ' + entry.specs.capacityCount });
    infoData.properties.push({ label: 'Weight Cap', value: entry.specs.capacityWeight + ' kg' });
  } else if (type === 'forklift' && entry.specs) {
    infoData.properties.push({ label: 'Load Cap', value: (entry.specs.loadCapacity || '—') + ' kg' });
    infoData.properties.push({ label: 'Speed', value: (entry.specs.speed || '—') + ' m/s' });
    if (entry.currentTask) {
      infoData.properties.push({ label: 'Task', value: entry.currentTask.action || 'assigned' });
    }
  } else if (type === 'manipulator' && entry.specs) {
    infoData.properties.push({ label: 'Reach', value: (entry.specs.armReach || '—') + ' m' });
    infoData.properties.push({ label: 'Grip Cap', value: (entry.specs.gripCapacity || '—') + ' kg' });
    infoData.properties.push({ label: 'Thermal', value: (entry.specs.thermalTolerance || '—') + ' °C' });
  } else if (type === 'truck' && entry.specs) {
    infoData.properties.push({ label: 'Truck Type', value: entry.specs.truckType || '—' });
    infoData.properties.push({ label: 'Direction', value: entry.specs.direction || '—' });
  } else if (type === 'tool' && entry.specs) {
    infoData.properties.push({ label: 'Tool Type', value: entry.specs.toolType || '—' });
    infoData.properties.push({ label: 'Weight', value: (entry.specs.weight || '—') + ' kg' });
    infoData.properties.push({ label: 'Material', value: entry.specs.material || '—' });
    infoData.properties.push({ label: 'Wear', value: Math.round((entry.specs.wearState || 1) * 100) + '%' });
  } else if (type === 'metalpart') {
    infoData.properties = [];
    infoData.properties.push({ label: 'Material', value: entry.materialGrade || '—' });
    infoData.properties.push({ label: 'State', value: entry.state || '—' });
    if (entry.mesh) {
      var p = entry.mesh.position;
      infoData.properties.push({ label: 'Position', value: '(' + Math.round(p.x) + ', ' + Math.round(p.z) + ')' });
    }
    if (entry.temperature !== undefined) {
      infoData.properties.push({ label: 'Temp', value: Math.round(entry.temperature) + ' °C' });
    }
    if (entry.weight !== undefined) {
      infoData.properties.push({ label: 'Weight', value: entry.weight + ' kg' });
    }
    if (entry.dimensions) {
      var d = entry.dimensions;
      infoData.properties.push({
        label: 'Dims',
        value: Math.round(d.length * 100) / 100 + ' × ' +
               Math.round(d.width * 100) / 100 + ' × ' +
               Math.round(d.height * 100) / 100 + ' m'
      });
    }
    if (entry.location) {
      infoData.properties.push({ label: 'Location', value: entry.location });
    }
  }

  setInfoContent(infoData);
  selectRegistryItem(id);

  // Position highlight based on entity type
  if (type === 'metalpart') {
    positionHighlightOnProduct(entry);
  } else if (entry.gridWidth !== undefined) {
    positionHighlightOnEquipment(entry);
  }

  return true;
}

function selectZone(zone) {
  selectedId = zone.id;

  var w = zone.rect.maxX - zone.rect.minX + 1;
  var h = zone.rect.maxZ - zone.rect.minZ + 1;

  setInfoContent({
    type: 'zone',
    id: zone.id,
    name: getZoneLabel(zone.type),
    properties: [
      { label: 'Zone Type', value: zone.type.replace('zone:', '') },
      { label: 'Origin', value: '(' + zone.rect.minX + ', ' + zone.rect.minZ + ')' },
      { label: 'Size', value: w + ' × ' + h },
      { label: 'Area', value: zone.area + ' cells' },
    ],
    status: 'active',
  });
  selectRegistryItem(zone.id);

  positionHighlightOnRect(zone.rect);
}

function clearSelection() {
  selectedId = null;
  setInfoContent(null);
  selectRegistryItem(null);
  if (selectionHighlight) selectionHighlight.visible = false;
}

// ---------------------------------------------------------------------------
// Per-frame Update
// ---------------------------------------------------------------------------

/**
 * Called each frame while select mode is active.
 * @param {number} dt - Simulation delta time in seconds
 */
export function update(dt) {
  if (!active) return;

  // Pulse the selection highlight for a subtle breathing effect
  if (selectionHighlight && selectionHighlight.visible) {
    var t = performance.now() * 0.003;
    var pulse = 0.45 + Math.sin(t) * 0.15;

    // Wireframe
    var wireframe = selectionHighlight.children[0];
    if (wireframe && wireframe.material) {
      wireframe.material.opacity = pulse + 0.15;
    }

    // Glow
    var glow = selectionHighlight.children[1];
    if (glow && glow.material) {
      glow.material.opacity = pulse * 0.25;
    }
  }
}