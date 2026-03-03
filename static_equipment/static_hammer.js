// ============================================================================
// static_hammer.js — Power Hammer Behavior
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines an industrial power hammer. Rapid reciprocating strikes at a
// configured blow rate.
//
// Mesh building and tup animation handled by forgehousebuilder.js and
// forgehousechanger.js respectively.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Hammer creation, update, strike control
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

const DEFAULT_SPECS = {
  strikeEnergy: 5000,      // Joules per blow
  blowRate: 60,            // strikes per minute
  dieSet: null,            // tool ID installed
  powerDraw: 50000,        // watts
  state: 'idle',           // idle, striking, complete
  strikesRemaining: 0,
  strikesDelivered: 0,
  totalStrikesRequested: 0,
  currentProduct: null,
  strikePhase: 0,          // 0-1 animation phase within a single blow
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createHammer(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);

  var gridWidth = 2;
  var gridDepth = 3;

  var entry = registry.register('hammer', name, gridX, gridZ, gridWidth, gridDepth, specs);

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateHammer(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return;

  var specs = entry.specs;
  if (specs.state !== 'striking') return;

  // Calculate strikes this tick
  var strikesPerSecond = specs.blowRate / 60;
  var strikesThisTick = strikesPerSecond * delta;

  specs.strikesDelivered += strikesThisTick;
  specs.strikesRemaining -= strikesThisTick;

  // Animation phase: oscillate within each blow
  specs.strikePhase += strikesPerSecond * delta * Math.PI * 2;

  if (specs.strikesRemaining <= 0) {
    specs.strikesRemaining = 0;
    specs.strikesDelivered = specs.totalStrikesRequested;
    specs.state = 'complete';
    specs.strikePhase = 0;
    registry.updateStatus(id, 'idle');
  }
}

// ---------------------------------------------------------------------------
// Strike Control
// ---------------------------------------------------------------------------

export function startStriking(id, productId, totalStrikes) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return false;

  if (entry.specs.state === 'striking') {
    console.warn('static_hammer: hammer ' + id + ' already striking');
    return false;
  }

  entry.specs.currentProduct = productId;
  entry.specs.totalStrikesRequested = totalStrikes;
  entry.specs.strikesRemaining = totalStrikes;
  entry.specs.strikesDelivered = 0;
  entry.specs.state = 'striking';
  entry.specs.strikePhase = 0;
  registry.updateStatus(id, 'active');
  return true;
}

export function completeStriking(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return null;

  var productId = entry.specs.currentProduct;
  entry.specs.currentProduct = null;
  entry.specs.strikesRemaining = 0;
  entry.specs.strikesDelivered = 0;
  entry.specs.state = 'idle';
  entry.specs.strikePhase = 0;
  registry.updateStatus(id, 'idle');
  return productId;
}

export function installDie(id, toolId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return false;
  entry.specs.dieSet = toolId;
  return true;
}

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}

export function getCurrentProduct(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentProduct : null;
}

export function isIdle(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state === 'idle' : false;
}

export function getProgress(id) {
  var entry = registry.get(id);
  if (!entry || entry.specs.totalStrikesRequested === 0) return 0;
  return entry.specs.strikesDelivered / entry.specs.totalStrikesRequested;
}