// ============================================================================
// mobile_trucks.js — Truck Behavior
// Forgeworks Mobile Equipment Tier 5
// ============================================================================
// Trucks are the interface between the forge and the outside world.
// Inbound trucks arrive with raw material. Outbound trucks depart with
// finished product. They dock, get loaded/unloaded, then depart.
//
// Truck state updates and arrival/departure animations handled by
// forgehousechanger.js. Mesh building handled by forgehousebuilder.js.
//
// Imports: worldclock.js, measurementunits.js, mobile_registry.js
// Exports: Truck creation, load/unload, arrive/depart
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './mobile_registry.js';

const DEFAULT_SPECS = {
  payloadCapacity: 20000,    // kg
  currentManifest: [],        // product IDs on truck
  currentWeight: 0,           // kg
  dockGridX: null,            // where the truck is docked
  dockGridZ: null,
  state: 'absent',            // absent, arriving, docked, departing, departed
  truckType: 'flatbed',       // flatbed, enclosed, tanker
  direction: 'inbound',       // inbound or outbound
  speed: 2,                   // arrival/departure animation speed
  preciseX: 0,
  preciseZ: 0,
  arrivalProgress: 0,         // 0 to 1 animation
  departureProgress: 0,
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createTruck(name, truckType, direction, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  specs.truckType = truckType || 'flatbed';
  specs.direction = direction || 'inbound';
  if (specOverrides) Object.assign(specs, specOverrides);
  specs.currentManifest = specs.currentManifest ? specs.currentManifest.slice() : [];

  var entry = registry.register('truck', name, 0, 0, 3, 6, specs);

  return entry;
}

// ---------------------------------------------------------------------------
// Arrive / Depart
// ---------------------------------------------------------------------------

/**
 * Trigger truck arrival at a dock.
 * @param {string} id - Truck ID
 * @param {number} dockGridX - Dock grid X
 * @param {number} dockGridZ - Dock grid Z
 * @param {Array<string>} [manifest] - Product IDs on the truck (for inbound)
 */
export function arrive(id, dockGridX, dockGridZ, manifest) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'truck') return false;

  var specs = entry.specs;
  specs.dockGridX = dockGridX;
  specs.dockGridZ = dockGridZ;
  specs.state = 'arriving';
  specs.arrivalProgress = 0;
  specs.departureProgress = 0;

  if (manifest) {
    specs.currentManifest = manifest.slice();
  }

  registry.updateGridPosition(id, dockGridX, dockGridZ);
  registry.updateStatus(id, 'active');
  return true;
}

/**
 * Trigger truck departure.
 */
export function depart(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'truck') return false;

  entry.specs.state = 'departing';
  entry.specs.departureProgress = 0;
  registry.updateStatus(id, 'active');
  return true;
}

// ---------------------------------------------------------------------------
// Load / Unload
// ---------------------------------------------------------------------------

/**
 * Load a product onto the truck (for outbound).
 */
export function loadItem(id, productId, weight) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'truck') return false;

  if (entry.specs.state !== 'docked') {
    console.warn('mobile_trucks: truck ' + id + ' not docked');
    return false;
  }

  var w = weight || 0;
  if (entry.specs.currentWeight + w > entry.specs.payloadCapacity) {
    console.warn('mobile_trucks: truck ' + id + ' overweight');
    return false;
  }

  entry.specs.currentManifest.push(productId);
  entry.specs.currentWeight += w;
  return true;
}

/**
 * Unload a product from the truck (for inbound).
 * @returns {string|null} Product ID unloaded
 */
export function unloadItem(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'truck') return null;

  var idx = entry.specs.currentManifest.indexOf(productId);
  if (idx === -1) return null;

  entry.specs.currentManifest.splice(idx, 1);
  return productId;
}

/**
 * Unload the next available product from manifest.
 */
export function unloadNext(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'truck') return null;
  if (entry.specs.currentManifest.length === 0) return null;

  return entry.specs.currentManifest.shift();
}

export function getManifest(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentManifest.slice() : [];
}

export function getManifestCount(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentManifest.length : 0;
}

export function isDocked(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state === 'docked' : false;
}

export function isEmpty(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentManifest.length === 0 : true;
}

export function isFull(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentWeight >= entry.specs.payloadCapacity : true;
}

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}