// ============================================================================
// static_racks.js — Storage Rack and Bin Behavior
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines storage infrastructure: material racks, finished part racks, scrap
// bins, die storage shelves, and tool cribs. Primarily inventory tracking.
//
// Mesh building handled by forgehousebuilder.js.
//
// Imports: measurementunits.js, static_registry.js
// Exports: Rack creation, inventory management
// ============================================================================

import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

const DEFAULT_SPECS = {
  rackType: 'raw_material',    // raw_material, finished_goods, scrap, die_storage, tool_crib
  capacityCount: 20,
  capacityWeight: 5000,        // kg
  currentContents: [],         // item IDs
  currentWeight: 0,            // kg
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createRack(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);
  specs.currentContents = specs.currentContents ? specs.currentContents.slice() : [];

  var gridWidth = 2;
  var gridDepth = 3;

  var entry = registry.register('rack', name, gridX, gridZ, gridWidth, gridDepth, specs);

  return entry;
}

// ---------------------------------------------------------------------------
// Inventory Management
// ---------------------------------------------------------------------------

/**
 * Store an item on the rack.
 * @param {string} rackId
 * @param {string} itemId - Product or tool ID
 * @param {number} weight - Item weight in kg
 * @returns {boolean}
 */
export function storeItem(rackId, itemId, weight) {
  var entry = registry.get(rackId);
  if (!entry || entry.type !== 'rack') return false;

  var specs = entry.specs;
  if (specs.currentContents.length >= specs.capacityCount) {
    console.warn('static_racks: rack ' + rackId + ' is full (count)');
    return false;
  }
  if (specs.currentWeight + weight > specs.capacityWeight) {
    console.warn('static_racks: rack ' + rackId + ' is full (weight)');
    return false;
  }
  if (specs.currentContents.indexOf(itemId) !== -1) return false;

  specs.currentContents.push(itemId);
  specs.currentWeight += weight;
  return true;
}

/**
 * Remove an item from the rack.
 */
export function removeItem(rackId, itemId, weight) {
  var entry = registry.get(rackId);
  if (!entry || entry.type !== 'rack') return false;

  var idx = entry.specs.currentContents.indexOf(itemId);
  if (idx === -1) return false;

  entry.specs.currentContents.splice(idx, 1);
  entry.specs.currentWeight -= weight;
  if (entry.specs.currentWeight < 0) entry.specs.currentWeight = 0;
  return true;
}

export function isFull(rackId) {
  var entry = registry.get(rackId);
  if (!entry) return true;
  return entry.specs.currentContents.length >= entry.specs.capacityCount ||
         entry.specs.currentWeight >= entry.specs.capacityWeight;
}

export function hasRoom(rackId, weight) {
  var entry = registry.get(rackId);
  if (!entry) return false;
  return entry.specs.currentContents.length < entry.specs.capacityCount &&
         entry.specs.currentWeight + (weight || 0) <= entry.specs.capacityWeight;
}

export function getContents(rackId) {
  var entry = registry.get(rackId);
  return entry ? entry.specs.currentContents.slice() : [];
}

export function getOccupancy(rackId) {
  var entry = registry.get(rackId);
  if (!entry) return { count: 0, maxCount: 0, weight: 0, maxWeight: 0 };
  return {
    count: entry.specs.currentContents.length,
    maxCount: entry.specs.capacityCount,
    weight: entry.specs.currentWeight,
    maxWeight: entry.specs.capacityWeight,
  };
}

export function getRackType(rackId) {
  var entry = registry.get(rackId);
  return entry ? entry.specs.rackType : null;
}