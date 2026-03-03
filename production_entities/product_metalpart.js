// ============================================================================
// product_metalpart.js — Generic Metal Part (Placeholder Product)
// Forgeworks Production Entities Tier 6
// ============================================================================
// A configurable metal part that exercises the full production pipeline.
// Responds to operations: heating (temperature rises in furnace), forging
// (dimensions change with volume conservation), quenching (temperature
// drops via Newton's law), and storage (ambient cooling).
//
// Mesh building, color updates, position, and visibility handled by
// forgehousebuilder.js and forgehousechanger.js respectively.
//
// Imports: worldclock.js, measurementunits.js, product_registry.js
// Exports: MetalPart creation, update, operation handlers
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './product_registry.js';

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