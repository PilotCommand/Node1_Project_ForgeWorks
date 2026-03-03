// ============================================================================
// static_furnace.js — Furnace Behavior and Rendering
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines the data structure, behavior, and 3D representation of a furnace.
// A furnace heats products to target temperature over time, holds at setpoint,
// and cools when turned off. Visual color shifts from dark grey to glowing
// orange based on current temperature.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Furnace creation, update, product loading/unloading, mesh building
// ============================================================================

import * as THREE from 'three';
import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

// ---------------------------------------------------------------------------
// Default Furnace Specs
// ---------------------------------------------------------------------------

const DEFAULT_SPECS = {
  maxTemp: 1300,           // Celsius
  heatingRate: 5,          // degrees per second at full power
  coolingRate: 1,          // degrees per second (ambient loss)
  fuelType: 'gas',         // gas or electric
  chamberSize: { width: 2, depth: 3, height: 1.5 },
  powerDraw: 75000,        // watts
  currentTemp: 25,         // Celsius (current furnace atmosphere temp)
  targetTemp: 0,           // 0 = off
  state: 'idle',           // idle, heating, holding, cooling
  contents: [],            // product IDs currently inside
  maxContents: 4,          // max products at once
};

// ---------------------------------------------------------------------------
// Temperature-to-Color Mapping
// ---------------------------------------------------------------------------
// Cold (25C) = dark grey, hot (1300C) = bright yellow-orange

// PERF: Reuse a single Color object to avoid per-frame allocations
const _furnaceTempColor = new THREE.Color();

function getTemperatureColor(temp, maxTemp) {
  var t = Math.max(0, Math.min(1, (temp - 25) / (maxTemp - 25)));

  // 4-stop gradient: grey -> dull red -> orange -> yellow
  var r, g, b;
  if (t < 0.33) {
    var s = t / 0.33;
    r = 0.2 + s * 0.47;    // 0.2 -> 0.67
    g = 0.2 - s * 0.07;    // 0.2 -> 0.13
    b = 0.2 - s * 0.2;     // 0.2 -> 0.0
  } else if (t < 0.66) {
    var s = (t - 0.33) / 0.33;
    r = 0.67 + s * 0.33;   // 0.67 -> 1.0
    g = 0.13 + s * 0.14;   // 0.13 -> 0.27
    b = 0.0;
  } else {
    var s = (t - 0.66) / 0.34;
    r = 1.0;
    g = 0.27 + s * 0.53;   // 0.27 -> 0.8
    b = s * 0.1;            // 0.0 -> 0.1
  }

  return _furnaceTempColor.setRGB(r, g, b);
}

// ---------------------------------------------------------------------------
// Furnace Creation
// ---------------------------------------------------------------------------

/**
 * Create and register a new furnace.
 *
 * @param {string} name - Display name
 * @param {number} gridX - Grid X position
 * @param {number} gridZ - Grid Z position
 * @param {object} [specOverrides={}] - Override default specs
 * @returns {object} Registry entry
 */
export function createFurnace(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) {
    Object.assign(specs, specOverrides);
    if (specOverrides.chamberSize) {
      specs.chamberSize = Object.assign({}, DEFAULT_SPECS.chamberSize, specOverrides.chamberSize);
    }
  }
  // Ensure contents is a fresh array
  specs.contents = specs.contents ? specs.contents.slice() : [];

  var gridWidth = specs.chamberSize.width + 1;  // chamber + walls
  var gridDepth = specs.chamberSize.depth + 1;

  var entry = registry.register('furnace', name, gridX, gridZ, gridWidth, gridDepth, specs);

  // Build and attach mesh
  var mesh = buildFurnaceMesh(specs, entry.id);
  mesh.position.set(
    gridX + gridWidth / 2,
    0,
    gridZ + gridDepth / 2
  );
  entry.mesh = mesh;

  return entry;
}

// ---------------------------------------------------------------------------
// Furnace Update (called each tick)
// ---------------------------------------------------------------------------

/**
 * Advance furnace state by one tick.
 * Handles temperature ramping, holding, and cooling.
 *
 * @param {string} id - Furnace registry ID
 * @param {number} delta - Time delta in seconds
 */
export function updateFurnace(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'furnace') return;

  var specs = entry.specs;

  // State machine
  if (specs.targetTemp > specs.currentTemp) {
    // Need to heat up
    specs.state = 'heating';
    specs.currentTemp += specs.heatingRate * delta;
    if (specs.currentTemp >= specs.targetTemp) {
      specs.currentTemp = specs.targetTemp;
      specs.state = 'holding';
    }
  } else if (specs.targetTemp > 0 && specs.targetTemp < specs.currentTemp) {
    // Cooling to a lower setpoint
    specs.state = 'cooling';
    specs.currentTemp -= specs.coolingRate * delta;
    if (specs.currentTemp <= specs.targetTemp) {
      specs.currentTemp = specs.targetTemp;
      specs.state = 'holding';
    }
  } else if (specs.targetTemp <= 0 && specs.currentTemp > 25) {
    // Turned off, cooling to ambient
    specs.state = 'cooling';
    specs.currentTemp -= specs.coolingRate * delta;
    if (specs.currentTemp <= 25) {
      specs.currentTemp = 25;
      specs.state = 'idle';
    }
  } else if (specs.targetTemp > 0) {
    specs.state = 'holding';
  } else {
    specs.state = 'idle';
  }

  // Update status in registry
  registry.updateStatus(id, specs.state === 'idle' ? 'idle' : 'active');

  // Update mesh color to reflect temperature
  updateFurnaceMeshColor(entry);
}

// ---------------------------------------------------------------------------
// Furnace Controls
// ---------------------------------------------------------------------------

/**
 * Set the target temperature for a furnace.
 */
export function setTarget(id, temp) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'furnace') return false;
  entry.specs.targetTemp = Math.min(temp, entry.specs.maxTemp);
  return true;
}

/**
 * Turn off the furnace (set target to 0, will cool to ambient).
 */
export function turnOff(id) {
  return setTarget(id, 0);
}

/**
 * Get the current furnace temperature.
 */
export function getCurrentTemp(id) {
  var entry = registry.get(id);
  if (!entry) return 0;
  return entry.specs.currentTemp;
}

/**
 * Get furnace state.
 */
export function getState(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return entry.specs.state;
}

// ---------------------------------------------------------------------------
// Product Loading / Unloading
// ---------------------------------------------------------------------------

/**
 * Load a product into the furnace.
 * @param {string} id - Furnace ID
 * @param {string} productId - Product ID
 * @returns {boolean}
 */
export function loadProduct(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'furnace') return false;

  var specs = entry.specs;
  if (specs.contents.length >= specs.maxContents) {
    console.warn('static_furnace: furnace ' + id + ' is full');
    return false;
  }

  if (specs.contents.indexOf(productId) !== -1) {
    console.warn('static_furnace: product ' + productId + ' already in furnace ' + id);
    return false;
  }

  specs.contents.push(productId);
  return true;
}

/**
 * Remove a product from the furnace.
 * @param {string} id - Furnace ID
 * @param {string} productId - Product ID
 * @returns {boolean}
 */
export function unloadProduct(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'furnace') return false;

  var idx = entry.specs.contents.indexOf(productId);
  if (idx === -1) return false;

  entry.specs.contents.splice(idx, 1);
  return true;
}

/**
 * Get all products currently in the furnace.
 */
export function getContents(id) {
  var entry = registry.get(id);
  if (!entry) return [];
  return entry.specs.contents.slice();
}

/**
 * Check if furnace has room for another product.
 */
export function hasRoom(id) {
  var entry = registry.get(id);
  if (!entry) return false;
  return entry.specs.contents.length < entry.specs.maxContents;
}

/**
 * Check if furnace is at or above target temperature (ready for loading).
 */
export function isAtTarget(id) {
  var entry = registry.get(id);
  if (!entry) return false;
  return entry.specs.state === 'holding' && entry.specs.currentTemp >= entry.specs.targetTemp - 5;
}

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

/**
 * Build a furnace mesh: box body with inset door face, colored by temperature.
 */
export function buildFurnaceMesh(specs, registryId) {
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
  body.userData.registryId = registryId;
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

  group.userData.visibilityCategory = 'furnaces';
  group.userData.registryId = registryId;
  group.userData.registryType = 'furnace';

  return group;
}

/**
 * Update furnace mesh color based on current temperature.
 * PERF: Caches body mesh, skips if temp hasn't changed by >2°C, reuses Color.
 */
const _furnaceEmissive = new THREE.Color();

function updateFurnaceMeshColor(entry) {
  if (!entry.mesh) return;

  // Skip if temperature hasn't changed meaningfully
  var lastTemp = entry._lastColorTemp;
  if (lastTemp !== undefined && Math.abs(entry.specs.currentTemp - lastTemp) < 2) return;
  entry._lastColorTemp = entry.specs.currentTemp;

  // Cache the furnace body mesh child
  if (!entry._bodyMesh) {
    entry.mesh.traverse(function(child) {
      if (child.isMesh && child.userData.isFurnaceBody) {
        entry._bodyMesh = child;
      }
    });
  }
  var body = entry._bodyMesh;
  if (!body) return;

  var color = getTemperatureColor(entry.specs.currentTemp, entry.specs.maxTemp);
  var emissiveIntensity = Math.max(0, (entry.specs.currentTemp - 100) / entry.specs.maxTemp) * 0.6;

  body.material.color.copy(color);
  _furnaceEmissive.copy(color).multiplyScalar(0.5);
  body.material.emissive.copy(_furnaceEmissive);
  body.material.emissiveIntensity = emissiveIntensity;
}