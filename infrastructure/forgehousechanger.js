// ============================================================================
// forgehousechanger.js — Things Are Changing
// Forgeworks · Foundation · Tier 1
// ============================================================================
// Every frame, this file updates the state of everything that moves, heats,
// cools, cycles, strikes, or changes color. It is the ONLY file that mutates
// Three.js mesh positions, colors, and transforms at runtime.
//
// Owns:
//   - Iterating all registries each frame and advancing their state
//   - Moving vehicle meshes along A* paths (forklifts, manipulators)
//   - Animating truck arrival/departure
//   - Updating furnace body color based on temperature
//   - Animating press ram and hammer tup
//   - Updating quench tank liquid color
//   - Updating product mesh color based on temperature
//   - Processing products inside equipment (heat transfer, forging, quenching)
//   - Product ambient cooling
//
// Does NOT own:
//   - Mesh creation/destruction (that's forgehousebuilder.js)
//   - Dispatch decisions — who goes where (that's dispatcher.js)
//   - Grid data or pathfinding (that's gridsquare.js)
//   - HUD/UI updates (that's visualhud.js)
//
// Imports: Three.js (for Color manipulation), gridsquare, builder, registries,
//          equipment files (for state math only)
// Exports: update(delta) — called once per frame from mainlogic
// ============================================================================

import * as THREE from 'three';

// Spatial
import {
  gridToWorld,
} from './gridsquare.js';

// Builder — for mesh position/visibility helpers
import {
  getSpawnedMesh,
  setMeshPosition,
  showMesh,
  hideMesh,
} from './forgehousebuilder.js';

// Registries — read-only iteration
import * as staticRegistry from '../static_equipment/static_registry.js';
import * as mobileRegistry from '../mobile_equipment/mobile_registry.js';
import * as productRegistry from '../production_entities/product_registry.js';

// Equipment behavior — state math only (no mesh building)
import * as furnace from '../static_equipment/static_furnace.js';
import * as press from '../static_equipment/static_press.js';
import * as hammer from '../static_equipment/static_hammer.js';
import * as quench from '../static_equipment/static_quench.js';

// Mobile behavior — state math only
import * as forklift from '../mobile_equipment/mobile_forklift.js';
import * as manipulator from '../mobile_equipment/mobile_manipulator.js';
import * as trucks from '../mobile_equipment/mobile_trucks.js';
import * as tools from '../mobile_equipment/mobile_tools.js';

// Product behavior — state math only
import * as metalpart from '../production_entities/product_metalpart.js';

// World clock — for timestamps on state transitions
import * as worldclock from './worldclock.js';


// ============================================================================
// PRE-ALLOCATED COLOR OBJECTS (avoid per-frame allocations)
// ============================================================================

var _furnaceTempColor = new THREE.Color();
var _furnaceEmissive = new THREE.Color();
var _productTempColor = new THREE.Color();
var _productEmissive = new THREE.Color();
var _blackColor = new THREE.Color(0, 0, 0);
var _quenchBaseColor = new THREE.Color();
var _quenchHotColor = new THREE.Color(0x664422);


// ============================================================================
// TEMPERATURE → COLOR MAPPING
// ============================================================================

// --- Furnace temperature gradient ---
// 4-stop: grey → dull red → orange → yellow
function getFurnaceTempColor(temp, maxTemp) {
  var t = Math.max(0, Math.min(1, (temp - 25) / (maxTemp - 25)));

  var r, g, b;
  if (t < 0.33) {
    var s = t / 0.33;
    r = 0.2 + s * 0.47;
    g = 0.2 - s * 0.07;
    b = 0.2 - s * 0.2;
  } else if (t < 0.66) {
    var s = (t - 0.33) / 0.33;
    r = 0.67 + s * 0.33;
    g = 0.13 + s * 0.14;
    b = 0.0;
  } else {
    var s = (t - 0.66) / 0.34;
    r = 1.0;
    g = 0.27 + s * 0.53;
    b = s * 0.1;
  }

  return _furnaceTempColor.setRGB(r, g, b);
}

// --- Product temperature gradient ---
// 5-stop matching coding plan:
//   25C → grey, 400C → dull red, 800C → orange-red, 1100C → bright orange, 1300C → yellow
var TEMP_STOPS = [
  { temp: 25,   r: 0.40, g: 0.40, b: 0.40 },
  { temp: 400,  r: 0.67, g: 0.13, b: 0.00 },
  { temp: 800,  r: 1.00, g: 0.27, b: 0.00 },
  { temp: 1100, r: 1.00, g: 0.53, b: 0.00 },
  { temp: 1300, r: 1.00, g: 0.80, b: 0.00 },
];

function getProductTempColor(temp) {
  if (temp <= TEMP_STOPS[0].temp) {
    return _productTempColor.setRGB(TEMP_STOPS[0].r, TEMP_STOPS[0].g, TEMP_STOPS[0].b);
  }
  var last = TEMP_STOPS[TEMP_STOPS.length - 1];
  if (temp >= last.temp) {
    return _productTempColor.setRGB(last.r, last.g, last.b);
  }

  for (var i = 0; i < TEMP_STOPS.length - 1; i++) {
    var lo = TEMP_STOPS[i];
    var hi = TEMP_STOPS[i + 1];
    if (temp >= lo.temp && temp <= hi.temp) {
      var t = (temp - lo.temp) / (hi.temp - lo.temp);
      return _productTempColor.setRGB(
        lo.r + (hi.r - lo.r) * t,
        lo.g + (hi.g - lo.g) * t,
        lo.b + (hi.b - lo.b) * t
      );
    }
  }
  return _productTempColor.setRGB(0.4, 0.4, 0.4);
}

// --- Quenchant color constants ---
var QUENCHANT_COLORS = {
  oil: 0x332200,
  water: 0x224466,
  polymer: 0x225533,
  brine: 0x334455,
};


// ============================================================================
// EASING FUNCTIONS (for truck animations)
// ============================================================================

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }


// ============================================================================
// CACHED MESH CHILD LOOKUPS
// ============================================================================
// Instead of traversing every frame, we cache references to special child
// meshes (furnace body, press ram, hammer tup, quench liquid, product body).
// Keys are registry IDs. Cache is cleared on despawn.

var _childCache = {};

/**
 * Find and cache a specific child mesh inside a group by a userData flag.
 */
function findChild(registryId, mesh, flag) {
  if (!mesh) return null;

  var cacheKey = registryId + ':' + flag;
  if (_childCache[cacheKey]) return _childCache[cacheKey];

  var found = null;
  mesh.traverse(function(child) {
    if (child.isMesh && child.userData[flag]) {
      found = child;
    }
  });

  if (found) _childCache[cacheKey] = found;
  return found;
}

/**
 * Clear cached child references for a registry ID (call on despawn).
 */
export function clearChildCache(registryId) {
  var prefix = registryId + ':';
  var keys = Object.keys(_childCache);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) === 0) {
      delete _childCache[keys[i]];
    }
  }
}


// ============================================================================
// MAIN UPDATE — Called once per frame from mainlogic
// ============================================================================

/**
 * Advance the entire simulation world by one tick.
 *
 * @param {number} delta - Simulation time delta in seconds
 * @param {string} mode - Current mode: 'sandbox', 'prediction', 'operating'
 */
export function update(delta, mode) {
  // 1. Always update static equipment state machines
  updateStaticEquipmentState(delta);

  // 2. Always update furnace mesh colors (they preheat even in sandbox)
  updateFurnaceVisuals();

  if (mode === 'sandbox') return;

  // --- Full simulation (prediction + operating) ---

  // 3. Product ambient cooling + mesh colors
  updateProductState(delta);
  updateProductVisuals();

  // 4. Mobile equipment path following + mesh positions
  updateMobileState(delta);
  updateMobileVisuals();

  // 5. Products inside equipment (heat transfer, cycle completion, quench cooling)
  processProductsInEquipment(delta);

  // 6. Quench tank liquid color
  updateQuenchVisuals();

  // 7. Press ram and hammer tup animations
  updatePressVisuals();
  updateHammerVisuals();
}


// ============================================================================
// STATIC EQUIPMENT — State Updates (no mesh touching)
// ============================================================================

function updateStaticEquipmentState(delta) {
  var allStatic = staticRegistry.getAll();
  for (var i = 0; i < allStatic.length; i++) {
    var entry = allStatic[i];
    switch (entry.type) {
      case 'furnace':  furnace.updateFurnace(entry.id, delta); break;
      case 'press':    press.updatePress(entry.id, delta); break;
      case 'hammer':   hammer.updateHammer(entry.id, delta); break;
      case 'quench':   quench.updateQuenchTank(entry.id, delta); break;
      // racks don't need per-tick state updates
    }
  }
}


// ============================================================================
// STATIC EQUIPMENT — Visual Updates (mesh colors and animations)
// ============================================================================

// ---------------------------------------------------------------------------
// Furnace body color based on temperature
// ---------------------------------------------------------------------------

function updateFurnaceVisuals() {
  var allFurnaces = staticRegistry.getByType('furnace');
  for (var i = 0; i < allFurnaces.length; i++) {
    var entry = allFurnaces[i];
    var mesh = entry.mesh || getSpawnedMesh(entry.id);
    if (!mesh) continue;

    var specs = entry.specs;

    // Skip if temperature hasn't changed meaningfully
    if (entry._lastColorTemp !== undefined && Math.abs(specs.currentTemp - entry._lastColorTemp) < 2) continue;
    entry._lastColorTemp = specs.currentTemp;

    var body = findChild(entry.id, mesh, 'isFurnaceBody');
    if (!body) continue;

    var color = getFurnaceTempColor(specs.currentTemp, specs.maxTemp);
    var emissiveIntensity = Math.max(0, (specs.currentTemp - 100) / specs.maxTemp) * 0.6;

    body.material.color.copy(color);
    _furnaceEmissive.copy(color).multiplyScalar(0.5);
    body.material.emissive.copy(_furnaceEmissive);
    body.material.emissiveIntensity = emissiveIntensity;
  }
}

// ---------------------------------------------------------------------------
// Press ram position based on cycle progress
// ---------------------------------------------------------------------------

function updatePressVisuals() {
  var allPresses = staticRegistry.getByType('press');
  for (var i = 0; i < allPresses.length; i++) {
    var entry = allPresses[i];
    var mesh = entry.mesh || getSpawnedMesh(entry.id);
    if (!mesh) continue;

    var frameH = mesh.userData.frameHeight || 4;
    var strokeLen = mesh.userData.strokeLength || 0.5;
    var progress = entry.specs.cycleProgress || 0;

    // Ram moves down at 0→0.5 progress, back up at 0.5→1.0
    var phase = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
    var ramY = frameH - 0.3 - (phase * strokeLen * 2);

    var ram = findChild(entry.id, mesh, 'isRam');
    if (ram) ram.position.y = ramY;
  }
}

// ---------------------------------------------------------------------------
// Hammer tup oscillation based on strike phase
// ---------------------------------------------------------------------------

function updateHammerVisuals() {
  var allHammers = staticRegistry.getByType('hammer');
  for (var i = 0; i < allHammers.length; i++) {
    var entry = allHammers[i];
    var mesh = entry.mesh || getSpawnedMesh(entry.id);
    if (!mesh) continue;

    var specs = entry.specs;
    var baseY = 2.5;
    var strokeDist = 1.2;
    var offset = 0;

    if (specs.state === 'striking') {
      offset = Math.abs(Math.sin(specs.strikePhase)) * strokeDist;
    }

    var tup = findChild(entry.id, mesh, 'isTup');
    if (tup) tup.position.y = baseY - offset;
  }
}

// ---------------------------------------------------------------------------
// Quench tank liquid color based on temperature
// ---------------------------------------------------------------------------

function updateQuenchVisuals() {
  var allQuench = staticRegistry.getByType('quench');
  for (var i = 0; i < allQuench.length; i++) {
    var entry = allQuench[i];
    var mesh = entry.mesh || getSpawnedMesh(entry.id);
    if (!mesh) continue;

    var specs = entry.specs;

    // Skip if temperature hasn't changed meaningfully
    if (entry._lastLiquidTemp !== undefined && Math.abs(specs.currentTemp - entry._lastLiquidTemp) < 1) continue;
    entry._lastLiquidTemp = specs.currentTemp;

    var tempRatio = Math.min(1, (specs.currentTemp - specs.ambientTemp) / specs.maxTempRise);

    var liquid = findChild(entry.id, mesh, 'isLiquid');
    if (!liquid) continue;

    _quenchBaseColor.set(QUENCHANT_COLORS[specs.quenchantType] || 0x224466);
    liquid.material.color.copy(_quenchBaseColor).lerp(_quenchHotColor, tempRatio);
  }
}


// ============================================================================
// PRODUCT STATE & VISUALS
// ============================================================================

// Ambient cooling constants (same as product_metalpart.js)
var AMBIENT_TEMP = 25;
var AMBIENT_COOLING_COEFFICIENT = 0.002;

// ---------------------------------------------------------------------------
// Product state update: ambient cooling
// ---------------------------------------------------------------------------

function updateProductState(delta) {
  var allProducts = productRegistry.getAll();
  for (var i = 0; i < allProducts.length; i++) {
    metalpart.updateMetalPart(allProducts[i].id, delta);
  }
}

// ---------------------------------------------------------------------------
// Product mesh color based on temperature
// ---------------------------------------------------------------------------

function updateProductVisuals() {
  var allProducts = productRegistry.getAll();
  for (var i = 0; i < allProducts.length; i++) {
    var entry = allProducts[i];
    var mesh = entry.mesh || getSpawnedMesh(entry.id);
    if (!mesh) continue;

    // Skip if temperature hasn't changed meaningfully
    if (entry._lastColorTemp !== undefined && Math.abs(entry.temperature - entry._lastColorTemp) < 1) continue;
    entry._lastColorTemp = entry.temperature;

    var body = findChild(entry.id, mesh, 'isProductBody');
    if (!body) continue;

    var color = getProductTempColor(entry.temperature);
    body.material.color.copy(color);

    if (entry.temperature > 400) {
      var emissiveIntensity = Math.min(0.5, (entry.temperature - 400) / 1800);
      _productEmissive.copy(color).multiplyScalar(0.6);
      body.material.emissive.copy(_productEmissive);
      body.material.emissiveIntensity = emissiveIntensity;
    } else {
      body.material.emissive.copy(_blackColor);
      body.material.emissiveIntensity = 0;
    }
  }
}

/**
 * Update a product's mesh scale after forging deformation.
 * Called externally after applyForging().
 * @param {string} id - Product registry ID
 */
export function updateProductMeshScale(id) {
  var entry = productRegistry.get(id);
  if (!entry) return;

  var mesh = entry.mesh || getSpawnedMesh(id);
  if (!mesh) return;

  var body = findChild(id, mesh, 'isProductBody');
  if (!body) return;

  var dims = entry.dimensions;
  body.scale.set(
    dims.width || 0.15,
    dims.height || 0.15,
    dims.length || 0.5
  );
  body.position.y = (dims.height || 0.15) / 2;
}


// ============================================================================
// MOBILE EQUIPMENT — State Updates (path following math)
// ============================================================================

function updateMobileState(delta) {
  var allMobile = mobileRegistry.getAll();
  for (var i = 0; i < allMobile.length; i++) {
    var entry = allMobile[i];
    switch (entry.type) {
      case 'forklift':     forklift.updateForklift(entry.id, delta); break;
      case 'manipulator':  manipulator.updateManipulator(entry.id, delta); break;
      case 'truck':        updateTruckState(entry, delta); break;
      case 'tool':         tools.updateTool(entry.id, delta); break;
    }
  }
}


// ============================================================================
// MOBILE EQUIPMENT — Visual Updates (mesh position and rotation)
// ============================================================================

function updateMobileVisuals() {
  var allMobile = mobileRegistry.getAll();
  for (var i = 0; i < allMobile.length; i++) {
    var entry = allMobile[i];
    var mesh = entry.mesh || getSpawnedMesh(entry.id);
    if (!mesh) continue;

    switch (entry.type) {
      case 'forklift':
        // Position and rotation already set by forklift.updateForklift
        // (it touches entry.mesh directly — we'll refactor later to be clean)
        // For now, ensure mesh tracks the entry's precise position
        mesh.position.set(entry.specs.preciseX, 0, entry.specs.preciseZ);
        mesh.rotation.y = entry.specs.heading || 0;

        // Fork height animation
        updateForkHeight(mesh, entry.specs.forkHeight || 0);
        break;

      case 'manipulator':
        mesh.position.set(entry.specs.preciseX, 0, entry.specs.preciseZ);
        mesh.rotation.y = entry.specs.heading || 0;

        // Arm extension visual
        updateArmVisual(mesh, entry.specs.armExtended || false);
        break;

      case 'truck':
        // Truck mesh position handled by updateTruckVisual
        updateTruckVisual(entry, mesh);
        break;
    }
  }
}


// ---------------------------------------------------------------------------
// Forklift fork height animation
// ---------------------------------------------------------------------------

function updateForkHeight(mesh, height) {
  if (!mesh) return;
  mesh.traverse(function(child) {
    if (child.userData && child.userData.isFork) {
      child.position.y = 0.2 + (height || 0);
    }
  });
}


// ---------------------------------------------------------------------------
// Manipulator arm glow when extended
// ---------------------------------------------------------------------------

var _gripEmissive = new THREE.Color(0x332200);
var _gripOff = new THREE.Color(0x000000);

function updateArmVisual(mesh, extended) {
  if (!mesh) return;
  mesh.traverse(function(child) {
    if (child.userData && child.userData.isGripper && child.isMesh) {
      child.material.emissive.copy(extended ? _gripEmissive : _gripOff);
      child.material.emissiveIntensity = extended ? 0.3 : 0;
    }
  });
}


// ---------------------------------------------------------------------------
// Truck arrival/departure state (no mesh touching — just state math)
// ---------------------------------------------------------------------------

function updateTruckState(entry, delta) {
  var specs = entry.specs;

  if (specs.state === 'arriving') {
    specs.arrivalProgress += delta * 0.3;
    if (specs.arrivalProgress >= 1.0) {
      specs.arrivalProgress = 1.0;
      specs.state = 'docked';
      mobileRegistry.updateStatus(entry.id, 'idle');
    }
  } else if (specs.state === 'departing') {
    specs.departureProgress += delta * 0.3;
    if (specs.departureProgress >= 1.0) {
      specs.departureProgress = 1.0;
      specs.state = 'departed';
      mobileRegistry.updateStatus(entry.id, 'idle');
    }
  }
}


// ---------------------------------------------------------------------------
// Truck mesh position (arrival/departure animation)
// ---------------------------------------------------------------------------

function updateTruckVisual(entry, mesh) {
  if (!mesh) return;

  var specs = entry.specs;

  if (specs.state === 'arriving') {
    var startZ = specs.dockGridZ - 10;
    var endZ = specs.dockGridZ + 3;
    var currentZ = startZ + (endZ - startZ) * easeOutCubic(specs.arrivalProgress);
    mesh.position.set(specs.dockGridX + 1.5, 0, currentZ);
    mesh.visible = true;

  } else if (specs.state === 'departing') {
    var startZ = specs.dockGridZ + 3;
    var endZ = specs.dockGridZ - 15;
    var currentZ = startZ + (endZ - startZ) * easeInCubic(specs.departureProgress);
    mesh.position.set(specs.dockGridX + 1.5, 0, currentZ);

  } else if (specs.state === 'departed') {
    mesh.visible = false;

  } else if (specs.state === 'docked') {
    mesh.position.set(specs.dockGridX + 1.5, 0, specs.dockGridZ + 3);
    mesh.visible = true;
  }
}


// ============================================================================
// PRODUCTS IN EQUIPMENT — Heat Transfer, Forging, Quenching
// ============================================================================
// This runs each frame and handles the physics interactions between products
// and the equipment they're inside.

function processProductsInEquipment(delta) {

  // ----- Furnaces: heat products inside -----
  var allFurnaces = staticRegistry.getByType('furnace');
  for (var f = 0; f < allFurnaces.length; f++) {
    var fn = allFurnaces[f];
    var contents = furnace.getContents(fn.id);
    var fnTemp = furnace.getCurrentTemp(fn.id);

    for (var p = 0; p < contents.length; p++) {
      var productId = contents[p];
      var product = productRegistry.get(productId);
      if (!product) continue;

      metalpart.applyHeat(productId, fnTemp, delta);

      // Check if product reached furnace target temp (within 20°C tolerance)
      // State transition is handled by dispatcher, not here
    }
  }

  // ----- Quench Tanks: cool products inside -----
  var allQuench = staticRegistry.getByType('quench');
  for (var q = 0; q < allQuench.length; q++) {
    var qt = allQuench[q];
    var qContents = quench.getContents(qt.id);
    var qTemp = quench.getCurrentTemp(qt.id);

    for (var p = 0; p < qContents.length; p++) {
      var qProductId = qContents[p];
      var qProduct = productRegistry.get(qProductId);
      if (!qProduct) continue;

      metalpart.applyQuench(qProductId, qTemp, qt.specs.coolingCoefficient, delta);
      quench.coolProduct(qt.id, qProduct.temperature, delta);

      // If product cooled below 200°C while quenching, transition to 'cooling'
      if (qProduct.state === 'quenching' && metalpart.isCooledBelow(qProductId, 200)) {
        productRegistry.updateState(qProductId, 'cooling', worldclock.getTime());
      }
    }
  }

  // ----- Presses: check cycle completion -----
  var allPresses = staticRegistry.getByType('press');
  for (var pr = 0; pr < allPresses.length; pr++) {
    var prEntry = allPresses[pr];
    if (press.getState(prEntry.id) === 'complete') {
      var forgedProductId = press.getCurrentProduct(prEntry.id);
      if (forgedProductId) {
        metalpart.applyForging(forgedProductId, 0.3);
        updateProductMeshScale(forgedProductId);
        press.completeCycle(prEntry.id);
        productRegistry.updateState(forgedProductId, 'transport_quench', worldclock.getTime());
        productRegistry.updateLocation(forgedProductId, 'in_transit');
      }
    }
  }

  // ----- Hammers: check strike completion -----
  var allHammers = staticRegistry.getByType('hammer');
  for (var h = 0; h < allHammers.length; h++) {
    var hmEntry = allHammers[h];
    if (hammer.getState(hmEntry.id) === 'complete') {
      var struckProductId = hammer.getCurrentProduct(hmEntry.id);
      if (struckProductId) {
        metalpart.applyForging(struckProductId, 0.2);
        updateProductMeshScale(struckProductId);
        hammer.completeStriking(hmEntry.id);
        productRegistry.updateState(struckProductId, 'transport_quench', worldclock.getTime());
        productRegistry.updateLocation(struckProductId, 'in_transit');
      }
    }
  }
}


// ============================================================================
// PRODUCT MESH POSITIONING
// ============================================================================
// Positions a product's mesh at its current location (equipment, rack, vehicle).
// Called by the dispatcher or mainlogic after assigning a product to a station.

/**
 * Position a product mesh at the world-space location of its container.
 * The container is the equipment or rack or vehicle it's sitting in/on.
 *
 * @param {string} productId - Product registry ID
 * @param {number} worldX - World X
 * @param {number} worldY - World Y (height above floor)
 * @param {number} worldZ - World Z
 */
export function positionProduct(productId, worldX, worldY, worldZ) {
  var entry = productRegistry.get(productId);
  if (!entry) return;

  var mesh = entry.mesh || getSpawnedMesh(productId);
  if (!mesh) return;

  mesh.position.set(worldX, worldY, worldZ);
  mesh.visible = true;
}

/**
 * Hide a product mesh (when in transit or not yet placed).
 */
export function hideProduct(productId) {
  var entry = productRegistry.get(productId);
  if (!entry) return;

  var mesh = entry.mesh || getSpawnedMesh(productId);
  if (mesh) mesh.visible = false;
}

/**
 * Show a product mesh.
 */
export function showProduct(productId) {
  var entry = productRegistry.get(productId);
  if (!entry) return;

  var mesh = entry.mesh || getSpawnedMesh(productId);
  if (mesh) mesh.visible = true;
}

/**
 * Position a product at the center of an equipment footprint.
 *
 * @param {string} productId
 * @param {number} gridX - Equipment grid position
 * @param {number} gridZ
 * @param {number} footprintW - Equipment footprint width in cells
 * @param {number} footprintD - Equipment footprint depth in cells
 * @param {number} [yOffset=0.5] - Height above floor
 */
export function positionProductAtEquipment(productId, gridX, gridZ, footprintW, footprintD, yOffset) {
  var centerX = gridX + (footprintW || 1) / 2;
  var centerZ = gridZ + (footprintD || 1) / 2;
  positionProduct(productId, centerX, yOffset || 0.5, centerZ);
}

/**
 * Position a product on a vehicle (follows the vehicle's precise position).
 *
 * @param {string} productId
 * @param {string} vehicleId
 * @param {number} [yOffset=1.0]
 */
export function positionProductOnVehicle(productId, vehicleId) {
  var vEntry = mobileRegistry.get(vehicleId);
  if (!vEntry) return;

  var vx = vEntry.specs ? vEntry.specs.preciseX : (vEntry.gridX + 0.5);
  var vz = vEntry.specs ? vEntry.specs.preciseZ : (vEntry.gridZ + 0.5);

  positionProduct(productId, vx, 1.0, vz);
}