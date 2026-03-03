// ============================================================================
// static_furnace.js — Furnace Behavior
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines the data structure and behavior of a furnace.
// A furnace heats products to target temperature over time, holds at setpoint,
// and cools when turned off.
//
// Mesh building and color updates are handled by forgehousebuilder.js and
// forgehousechanger.js respectively.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Furnace creation, update, controls, product loading/unloading
// ============================================================================

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