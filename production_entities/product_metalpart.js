// ============================================================================
// product_metalpart.js — Generic Metal Part (Placeholder Product)
// Forgeworks Production Entities Tier 6
// ============================================================================
// A configurable metal part that exercises the full production pipeline.
// Responds to operations: heating (temperature rises in furnace), forging
// (dimensions change with volume conservation), quenching (temperature
// drops via Newton's law), and storage (ambient cooling).
//
// 3D mesh is a simple block/cylinder colored by temperature:
//   25C = grey, 400C = dull red, 800C = orange-red, 1100C = bright orange,
//   1300C = yellow.
//
// This file will eventually be supplemented by specific product definitions,
// but its structure serves as the template for all future product types.
//
// Imports: worldclock.js, measurementunits.js, product_registry.js
// Exports: MetalPart creation, update, operation handlers, mesh building
// ============================================================================

import * as THREE from 'three';
import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './product_registry.js';

// ---------------------------------------------------------------------------
// Temperature-to-Color Mapping
// ---------------------------------------------------------------------------
// 5-stop gradient matching the coding plan specification:
//   25C   -> #666666 (grey)
//   400C  -> #aa2200 (dull red)
//   800C  -> #ff4400 (orange-red)
//   1100C -> #ff8800 (bright orange)
//   1300C -> #ffcc00 (yellow)

const TEMP_STOPS = [
  { temp: 25,   r: 0.40, g: 0.40, b: 0.40 },
  { temp: 400,  r: 0.67, g: 0.13, b: 0.00 },
  { temp: 800,  r: 1.00, g: 0.27, b: 0.00 },
  { temp: 1100, r: 1.00, g: 0.53, b: 0.00 },
  { temp: 1300, r: 1.00, g: 0.80, b: 0.00 },
];

/**
 * Get the RGB color for a given temperature by interpolating between stops.
 * @param {number} temp - Temperature in Celsius
 * @returns {THREE.Color}
 */
export function getTemperatureColor(temp) {
  // Clamp to range
  if (temp <= TEMP_STOPS[0].temp) {
    return new THREE.Color(TEMP_STOPS[0].r, TEMP_STOPS[0].g, TEMP_STOPS[0].b);
  }
  if (temp >= TEMP_STOPS[TEMP_STOPS.length - 1].temp) {
    var last = TEMP_STOPS[TEMP_STOPS.length - 1];
    return new THREE.Color(last.r, last.g, last.b);
  }

  // Find the two stops we're between
  for (var i = 0; i < TEMP_STOPS.length - 1; i++) {
    var lo = TEMP_STOPS[i];
    var hi = TEMP_STOPS[i + 1];
    if (temp >= lo.temp && temp <= hi.temp) {
      var t = (temp - lo.temp) / (hi.temp - lo.temp);
      return new THREE.Color(
        lo.r + (hi.r - lo.r) * t,
        lo.g + (hi.g - lo.g) * t,
        lo.b + (hi.b - lo.b) * t
      );
    }
  }

  return new THREE.Color(0.4, 0.4, 0.4);
}

// ---------------------------------------------------------------------------
// Ambient Cooling Rate
// ---------------------------------------------------------------------------
// Products cool slowly in open air. This is much slower than quench cooling.
// Approximate: lose ~0.5 C/sec when hot, less as temperature approaches ambient.

const AMBIENT_TEMP = 25;
const AMBIENT_COOLING_COEFFICIENT = 0.002; // Newton's law coefficient for air

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Create and register a new metal part.
 *
 * @param {string} materialGrade - e.g., '4140', '1045', '304SS'
 * @param {object} dimensions - { length, width, height } in meters
 * @param {number} weight - Mass in kg
 * @param {object} [options] - Passed through to product_registry.register()
 * @returns {object} Registry entry
 */
export function createMetalPart(materialGrade, dimensions, weight, options) {
  var entry = registry.register(materialGrade, dimensions, weight, options || {});

  // Build and attach mesh
  var mesh = buildMetalPartMesh(entry.dimensions, entry.id);

  // Position will be set by mainlogic based on the product's location
  // (the container's grid position). Start invisible until placed.
  mesh.visible = false;

  entry.mesh = mesh;
  registry.setMesh(entry.id, mesh);

  return entry;
}

// ---------------------------------------------------------------------------
// Update (called each tick)
// ---------------------------------------------------------------------------

/**
 * Update a metal part each tick. Handles:
 * - Ambient cooling when not in furnace or quench tank
 * - Mesh color update based on temperature
 * - Mesh position update based on location
 *
 * @param {string} id - Product ID
 * @param {number} delta - Time delta in seconds
 */
export function updateMetalPart(id, delta) {
  var entry = registry.get(id);
  if (!entry) return;

  // Ambient cooling (only when not actively being heated or quenched)
  var state = entry.state;
  var isBeingProcessed = (state === 'heating' || state === 'quenching');

  if (!isBeingProcessed && entry.temperature > AMBIENT_TEMP) {
    // Newton's law: dT/dt = -k * (T - T_ambient)
    var dT = AMBIENT_COOLING_COEFFICIENT * (entry.temperature - AMBIENT_TEMP) * delta;
    entry.temperature -= dT;
    if (entry.temperature < AMBIENT_TEMP) entry.temperature = AMBIENT_TEMP;
    registry.updateTemperature(id, entry.temperature);
  }

  // Update mesh color
  updateMeshColor(entry);
}

// ---------------------------------------------------------------------------
// Operation Handlers
// ---------------------------------------------------------------------------

/**
 * Apply heat to the product (called each tick while in a furnace).
 * Product temperature approaches furnace atmosphere temperature.
 *
 * @param {string} id - Product ID
 * @param {number} furnaceTemp - Current furnace temperature in Celsius
 * @param {number} delta - Time delta in seconds
 * @returns {number} New product temperature
 */
export function applyHeat(id, furnaceTemp, delta) {
  var entry = registry.get(id);
  if (!entry) return 0;

  // Product heats toward furnace temperature
  // Thicker parts heat slower — use a coefficient based on minimum dimension
  var minDim = Math.min(entry.dimensions.length, entry.dimensions.width, entry.dimensions.height);
  var heatCoeff = 0.005 / Math.max(minDim, 0.01); // thinner = faster

  if (entry.temperature < furnaceTemp) {
    var dT = heatCoeff * (furnaceTemp - entry.temperature) * delta;
    entry.temperature += dT;
    if (entry.temperature > furnaceTemp) entry.temperature = furnaceTemp;
  }

  registry.updateTemperature(id, entry.temperature);
  return entry.temperature;
}

/**
 * Apply forging deformation (called when press/hammer completes action).
 * Volume conservation: height decreases, width and length increase.
 *
 * @param {string} id - Product ID
 * @param {number} reductionRatio - How much height reduces (0.0 to 1.0, e.g., 0.3 = 30% reduction)
 * @returns {object} New dimensions
 */
export function applyForging(id, reductionRatio) {
  var entry = registry.get(id);
  if (!entry) return null;

  var dims = entry.dimensions;
  var ratio = Math.max(0.05, Math.min(0.8, reductionRatio || 0.3));

  // Volume before
  var volume = dims.length * dims.width * dims.height;

  // Reduce height
  var newHeight = dims.height * (1 - ratio);
  if (newHeight < 0.01) newHeight = 0.01;

  // Distribute volume into length and width (equal spread)
  var areaNeeded = volume / newHeight;
  var currentArea = dims.length * dims.width;
  var areaScale = Math.sqrt(areaNeeded / currentArea);

  var newDims = {
    length: dims.length * areaScale,
    width: dims.width * areaScale,
    height: newHeight,
  };

  registry.updateDimensions(id, newDims);

  // Update mesh geometry to reflect new shape
  updateMeshGeometry(entry);

  return newDims;
}

/**
 * Apply quench cooling (called each tick while in quench tank).
 * Uses Newton's law with the tank's cooling coefficient.
 *
 * @param {string} id - Product ID
 * @param {number} quenchantTemp - Current quenchant temperature
 * @param {number} coolingCoefficient - Tank's cooling coefficient
 * @param {number} delta - Time delta
 * @returns {number} New product temperature
 */
export function applyQuench(id, quenchantTemp, coolingCoefficient, delta) {
  var entry = registry.get(id);
  if (!entry) return 0;

  // Newton's law: dT/dt = -k * (T_product - T_quenchant)
  var dT = coolingCoefficient * (entry.temperature - quenchantTemp) * delta;
  entry.temperature -= dT;
  if (entry.temperature < quenchantTemp) entry.temperature = quenchantTemp;

  registry.updateTemperature(id, entry.temperature);
  return entry.temperature;
}

/**
 * Check if product has reached a target temperature (within tolerance).
 */
export function hasReachedTemp(id, targetTemp, tolerance) {
  var entry = registry.get(id);
  if (!entry) return false;
  var tol = tolerance || 10; // default 10C tolerance
  return Math.abs(entry.temperature - targetTemp) <= tol;
}

/**
 * Check if product has cooled below a threshold.
 */
export function isCooledBelow(id, threshold) {
  var entry = registry.get(id);
  if (!entry) return false;
  return entry.temperature <= threshold;
}

/**
 * Get current product temperature.
 */
export function getTemperature(id) {
  var entry = registry.get(id);
  return entry ? entry.temperature : 0;
}

/**
 * Get current product dimensions.
 */
export function getDimensions(id) {
  var entry = registry.get(id);
  return entry ? Object.assign({}, entry.dimensions) : null;
}

/**
 * Get the deformation ratio compared to original dimensions.
 */
export function getDeformationRatio(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return {
    length: entry.dimensions.length / entry.originalDimensions.length,
    width: entry.dimensions.width / entry.originalDimensions.width,
    height: entry.dimensions.height / entry.originalDimensions.height,
  };
}

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

/**
 * Build a metal part mesh. Simple box geometry colored by temperature.
 * Mesh scale will update as dimensions change during forging.
 */
export function buildMetalPartMesh(dimensions, registryId) {
  var group = new THREE.Group();

  // Use a box geometry at unit scale; we'll set scale from dimensions
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
  mesh.userData.registryId = registryId;
  mesh.userData.registryType = 'metalpart';
  mesh.userData.isProductBody = true;

  group.add(mesh);

  group.userData.visibilityCategory = 'products';
  group.userData.registryId = registryId;
  group.userData.registryType = 'metalpart';

  return group;
}

// ---------------------------------------------------------------------------
// Mesh Updates
// ---------------------------------------------------------------------------

/**
 * Update mesh color based on current temperature.
 */
function updateMeshColor(entry) {
  if (!entry.mesh) return;

  var color = getTemperatureColor(entry.temperature);
  var emissiveIntensity = 0;

  // Products above ~400C start glowing
  if (entry.temperature > 400) {
    emissiveIntensity = Math.min(0.5, (entry.temperature - 400) / 1800);
  }

  entry.mesh.traverse(function(child) {
    if (child.isMesh && child.userData.isProductBody) {
      child.material.color.copy(color);
      if (emissiveIntensity > 0) {
        child.material.emissive = color.clone().multiplyScalar(0.6);
        child.material.emissiveIntensity = emissiveIntensity;
      } else {
        child.material.emissive = new THREE.Color(0, 0, 0);
        child.material.emissiveIntensity = 0;
      }
    }
  });
}

/**
 * Update mesh scale to reflect changed dimensions (after forging).
 */
function updateMeshGeometry(entry) {
  if (!entry.mesh) return;

  var dims = entry.dimensions;

  entry.mesh.traverse(function(child) {
    if (child.isMesh && child.userData.isProductBody) {
      child.scale.set(
        dims.width || 0.15,
        dims.height || 0.15,
        dims.length || 0.5
      );
      child.position.y = (dims.height || 0.15) / 2;
    }
  });
}

/**
 * Position the product mesh at a world location.
 * Called by mainlogic when a product's container (equipment, rack, vehicle) is known.
 *
 * @param {string} id - Product ID
 * @param {number} worldX - World X position
 * @param {number} worldY - World Y position (usually 0 or on equipment surface)
 * @param {number} worldZ - World Z position
 */
export function setMeshPosition(id, worldX, worldY, worldZ) {
  var entry = registry.get(id);
  if (!entry || !entry.mesh) return;

  entry.mesh.position.set(worldX, worldY, worldZ);
  entry.mesh.visible = true;
}

/**
 * Hide the product mesh (when in transit or not yet placed).
 */
export function hideMesh(id) {
  var entry = registry.get(id);
  if (!entry || !entry.mesh) return;
  entry.mesh.visible = false;
}

/**
 * Show the product mesh.
 */
export function showMesh(id) {
  var entry = registry.get(id);
  if (!entry || !entry.mesh) return;
  entry.mesh.visible = true;
}