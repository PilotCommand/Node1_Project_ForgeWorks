// ============================================================================
// static_quench.js — Quench Tank Behavior
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines a quench tank. Tracks quenchant temperature (rises as hot parts
// are introduced, cools back to ambient). Newton's law cooling on products.
//
// Mesh building and liquid color handled by forgehousebuilder.js and
// forgehousechanger.js respectively.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Quench tank creation, update, product quenching
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

const DEFAULT_SPECS = {
  tankVolume: 5000,          // liters
  quenchantType: 'oil',      // oil, water, polymer, brine
  ambientTemp: 25,           // Celsius
  currentTemp: 25,           // current quenchant temperature
  coolingCoefficient: 0.01,  // Newton's law coefficient for product cooling
  tankCoolingRate: 0.5,      // degrees/sec the tank cools back to ambient
  maxTempRise: 80,           // safe operating temp above ambient
  capacity: 4,               // max simultaneous products
  contents: [],              // product IDs submerged
  state: 'ready',            // ready, active, overheated
  powerDraw: 5000,           // watts (pumps, agitation)
  overheatCount: 0,          // track overheat events
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createQuenchTank(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);
  specs.contents = specs.contents ? specs.contents.slice() : [];

  var gridWidth = 3;
  var gridDepth = 3;

  var entry = registry.register('quench', name, gridX, gridZ, gridWidth, gridDepth, specs);

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateQuenchTank(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'quench') return;

  var specs = entry.specs;

  // Tank cools back toward ambient when no hot products inside
  if (specs.currentTemp > specs.ambientTemp) {
    specs.currentTemp -= specs.tankCoolingRate * delta;
    if (specs.currentTemp < specs.ambientTemp) specs.currentTemp = specs.ambientTemp;
  }

  // Check overheated state
  var overheatedThreshold = specs.ambientTemp + specs.maxTempRise;
  if (specs.currentTemp >= overheatedThreshold) {
    if (specs.state !== 'overheated') {
      specs.state = 'overheated';
      specs.overheatCount++;
    }
  } else if (specs.contents.length > 0) {
    specs.state = 'active';
  } else {
    specs.state = 'ready';
  }

  registry.updateStatus(id, specs.state === 'ready' ? 'idle' : 'active');
}

/**
 * Cool a product submerged in this tank (called by product update or mainlogic).
 * Returns the new product temperature.
 *
 * @param {string} id - Tank ID
 * @param {number} productTemp - Current product temp in Celsius
 * @param {number} delta - Time delta
 * @returns {number} New product temperature
 */
export function coolProduct(id, productTemp, delta) {
  var entry = registry.get(id);
  if (!entry) return productTemp;

  var specs = entry.specs;

  // Newton's law of cooling: dT/dt = -k * (T_product - T_quenchant)
  var dT = specs.coolingCoefficient * (productTemp - specs.currentTemp) * delta;
  var newProductTemp = productTemp - dT;

  // Heat transfer: quenchant absorbs heat from the product
  // Simplified: quenchant temp rises proportional to heat removed
  var heatAbsorbed = dT * 0.1; // scale factor
  specs.currentTemp += heatAbsorbed;

  return Math.max(newProductTemp, specs.currentTemp);
}

// ---------------------------------------------------------------------------
// Product Management
// ---------------------------------------------------------------------------

export function quenchProduct(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'quench') return false;

  if (entry.specs.contents.length >= entry.specs.capacity) {
    console.warn('static_quench: tank ' + id + ' is full');
    return false;
  }

  if (entry.specs.contents.indexOf(productId) !== -1) return false;

  entry.specs.contents.push(productId);
  entry.specs.state = 'active';
  return true;
}

export function removeProduct(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'quench') return false;

  var idx = entry.specs.contents.indexOf(productId);
  if (idx === -1) return false;

  entry.specs.contents.splice(idx, 1);
  if (entry.specs.contents.length === 0) entry.specs.state = 'ready';
  return true;
}

export function getContents(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.contents.slice() : [];
}

export function hasRoom(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.contents.length < entry.specs.capacity : false;
}

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}

export function getCurrentTemp(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentTemp : 0;
}

export function isOverheated(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state === 'overheated' : false;
}