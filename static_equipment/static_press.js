// ============================================================================
// static_press.js — Press Behavior
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines an industrial forging press. Handles cycle timing and force calc.
//
// Mesh building and ram animation handled by forgehousebuilder.js and
// forgehousechanger.js respectively.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Press creation, update, cycle control
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

// ---------------------------------------------------------------------------
// Default Press Specs
// ---------------------------------------------------------------------------

const DEFAULT_SPECS = {
  tonnage: 2000,             // metric tons force capacity
  strokeLength: 0.5,         // meters
  cycleTime: 8,              // seconds per full cycle
  pressType: 'hydraulic',    // hydraulic, mechanical, screw
  dieSet: null,              // tool ID currently installed
  powerDraw: 150000,         // watts
  state: 'idle',             // idle, cycling, complete
  cycleProgress: 0,          // 0.0 to 1.0
  currentProduct: null,      // product ID being forged
  forceApplied: 0,           // current force in Newtons
};

// ---------------------------------------------------------------------------
// Press Creation
// ---------------------------------------------------------------------------

export function createPress(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);

  var gridWidth = 3;
  var gridDepth = 4;

  var entry = registry.register('press', name, gridX, gridZ, gridWidth, gridDepth, specs);

  return entry;
}

// ---------------------------------------------------------------------------
// Press Update
// ---------------------------------------------------------------------------

export function updatePress(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return;

  var specs = entry.specs;

  if (specs.state === 'cycling') {
    specs.cycleProgress += delta / specs.cycleTime;

    // Calculate force: peaks at mid-stroke (progress 0.5)
    var strokePhase = Math.sin(specs.cycleProgress * Math.PI);
    specs.forceApplied = specs.tonnage * 9810 * strokePhase; // convert tons to Newtons

    if (specs.cycleProgress >= 1.0) {
      specs.cycleProgress = 1.0;
      specs.state = 'complete';
      specs.forceApplied = 0;
      registry.updateStatus(id, 'idle');
    }
  }
}

// ---------------------------------------------------------------------------
// Cycle Control
// ---------------------------------------------------------------------------

/**
 * Start a press cycle with a product.
 * @param {string} id - Press ID
 * @param {string} productId - Product ID being forged
 * @returns {boolean}
 */
export function startCycle(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return false;

  if (entry.specs.state === 'cycling') {
    console.warn('static_press: press ' + id + ' already cycling');
    return false;
  }

  entry.specs.currentProduct = productId;
  entry.specs.cycleProgress = 0;
  entry.specs.state = 'cycling';
  registry.updateStatus(id, 'active');
  return true;
}

/**
 * Complete the cycle and release the product.
 * @returns {string|null} The product ID that was forged
 */
export function completeCycle(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return null;

  var productId = entry.specs.currentProduct;
  entry.specs.currentProduct = null;
  entry.specs.cycleProgress = 0;
  entry.specs.state = 'idle';
  entry.specs.forceApplied = 0;
  registry.updateStatus(id, 'idle');

  return productId;
}

/**
 * Install a die set on the press.
 */
export function installDie(id, toolId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return false;
  entry.specs.dieSet = toolId;
  return true;
}

export function getState(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return entry.specs.state;
}

export function getCurrentProduct(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return entry.specs.currentProduct;
}

export function getCycleProgress(id) {
  var entry = registry.get(id);
  if (!entry) return 0;
  return entry.specs.cycleProgress;
}

export function isIdle(id) {
  var entry = registry.get(id);
  if (!entry) return false;
  return entry.specs.state === 'idle';
}