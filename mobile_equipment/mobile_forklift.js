// ============================================================================
// mobile_forklift.js — Forklift Behavior
// Forgeworks Mobile Equipment Tier 5
// ============================================================================
// Defines a forklift: the primary mover of cold/warm material between
// stations. Receives task assignments, navigates along grid pathways,
// picks up and puts down products.
//
// Position tracking: preciseX/Z for smooth rendering, gridX/Z updated
// when crossing cell boundaries.
//
// Mesh building and visual updates handled by forgehousebuilder.js and
// forgehousechanger.js respectively.
//
// Imports: worldclock.js, measurementunits.js, mobile_registry.js
// Exports: Forklift creation, update, route assignment, pickup/putdown
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './mobile_registry.js';

// ---------------------------------------------------------------------------
// Default Specs
// ---------------------------------------------------------------------------

const DEFAULT_SPECS = {
  loadCapacity: 2000,      // kg
  currentLoad: null,        // product ID being carried
  currentLoadWeight: 0,     // kg
  speed: 3,                 // meters per second
  turnRadius: 2.5,          // meters (cosmetic)
  forkHeight: 0,            // current fork elevation (0 = ground)
  maxForkHeight: 3,         // meters
  state: 'idle',            // idle, traveling, loading, unloading
  currentPath: [],          // array of {x, z} waypoints
  pathIndex: 0,             // current waypoint index
  preciseX: 0,
  preciseZ: 0,
  heading: 0,               // radians, facing direction
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createForklift(name, homeGridX, homeGridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);
  specs.preciseX = homeGridX + 0.5;
  specs.preciseZ = homeGridZ + 0.5;
  specs.currentPath = [];

  var entry = registry.register('forklift', name, homeGridX, homeGridZ, 2, 3, specs);
  entry.homeGridX = homeGridX;
  entry.homeGridZ = homeGridZ;

  return entry;
}

// ---------------------------------------------------------------------------
// Update (called each tick)
// ---------------------------------------------------------------------------

/**
 * Advance forklift along its current path.
 */
export function updateForklift(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'forklift') return;

  var specs = entry.specs;

  if (specs.state !== 'traveling' || specs.currentPath.length === 0) return;

  // Current target waypoint
  if (specs.pathIndex >= specs.currentPath.length) {
    // Arrived at destination
    arriveAtDestination(entry);
    return;
  }

  var target = specs.currentPath[specs.pathIndex];
  var targetX = target.x + 0.5; // center of cell
  var targetZ = target.z + 0.5;

  var dx = targetX - specs.preciseX;
  var dz = targetZ - specs.preciseZ;
  var dist = Math.sqrt(dx * dx + dz * dz);

  var moveAmount = specs.speed * delta;

  if (dist <= moveAmount) {
    // Reached this waypoint
    specs.preciseX = targetX;
    specs.preciseZ = targetZ;
    specs.pathIndex++;

    // Update heading
    if (dist > 0.01) {
      specs.heading = Math.atan2(dx, dz);
    }

    // Update grid position
    registry.updatePrecisePosition(id, specs.preciseX, specs.preciseZ);

    // Check if path complete
    if (specs.pathIndex >= specs.currentPath.length) {
      arriveAtDestination(entry);
    }
  } else {
    // Move toward waypoint
    var ratio = moveAmount / dist;
    specs.preciseX += dx * ratio;
    specs.preciseZ += dz * ratio;
    specs.heading = Math.atan2(dx, dz);

    registry.updatePrecisePosition(id, specs.preciseX, specs.preciseZ);
  }
}

function arriveAtDestination(entry) {
  var specs = entry.specs;
  var task = entry.currentTask;

  specs.currentPath = [];
  specs.pathIndex = 0;

  if (task) {
    if (task.action === 'pickup') {
      specs.state = 'loading';
    } else if (task.action === 'deliver') {
      specs.state = 'unloading';
    } else {
      specs.state = 'idle';
      registry.clearTask(entry.id);
    }
  } else {
    specs.state = 'idle';
  }
}

// ---------------------------------------------------------------------------
// Route Assignment
// ---------------------------------------------------------------------------

/**
 * Assign a path for the forklift to follow.
 * @param {string} id
 * @param {Array<{x,z}>} waypoints - Grid cell waypoints from A* pathfinding
 */
export function assignRoute(id, waypoints) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'forklift') return false;

  entry.specs.currentPath = waypoints.slice();
  entry.specs.pathIndex = 0;
  entry.specs.state = 'traveling';
  return true;
}

// ---------------------------------------------------------------------------
// Pickup / Putdown
// ---------------------------------------------------------------------------

/**
 * Pick up a product.
 */
export function pickUp(id, productId, weight) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'forklift') return false;

  if (entry.specs.currentLoad !== null) {
    console.warn('mobile_forklift: forklift ' + id + ' already carrying ' + entry.specs.currentLoad);
    return false;
  }

  var w = weight || 0;
  if (w > entry.specs.loadCapacity) {
    console.warn('mobile_forklift: product too heavy for forklift ' + id);
    return false;
  }

  entry.specs.currentLoad = productId;
  entry.specs.currentLoadWeight = w;
  entry.specs.forkHeight = 0.5; // raise forks
  entry.specs.state = 'traveling'; // ready to move again

  return true;
}

/**
 * Put down the current load.
 * @returns {string|null} Product ID that was put down
 */
export function putDown(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'forklift') return null;

  var productId = entry.specs.currentLoad;
  entry.specs.currentLoad = null;
  entry.specs.currentLoadWeight = 0;
  entry.specs.forkHeight = 0;
  entry.specs.state = 'idle';

  registry.clearTask(id);

  return productId;
}

export function isCarrying(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentLoad !== null : false;
}

export function getLoad(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentLoad : null;
}

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}

export function isIdle(id) {
  var entry = registry.get(id);
  return entry ? (entry.specs.state === 'idle' && entry.specs.currentLoad === null) : false;
}

export function getPosition(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return { x: entry.specs.preciseX, z: entry.specs.preciseZ };
}