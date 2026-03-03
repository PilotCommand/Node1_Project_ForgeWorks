// ============================================================================
// mobile_forklift.js — Forklift Behavior and Rendering
// Forgeworks Mobile Equipment Tier 5
// ============================================================================
// Defines a forklift: the primary mover of cold/warm material between
// stations. Receives task assignments, navigates along grid pathways,
// picks up and puts down products.
//
// Position tracking: preciseX/Z for smooth rendering, gridX/Z updated
// when crossing cell boundaries.
//
// Imports: worldclock.js, measurementunits.js, mobile_registry.js
// Exports: Forklift creation, update, route assignment, pickup/putdown
// ============================================================================

import * as THREE from 'three';
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

  var mesh = buildForkliftMesh(specs, entry.id);
  mesh.position.set(specs.preciseX, 0, specs.preciseZ);
  entry.mesh = mesh;

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

  // Update mesh position and rotation
  if (entry.mesh) {
    entry.mesh.position.set(specs.preciseX, 0, specs.preciseZ);
    entry.mesh.rotation.y = specs.heading;
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

  // Animate fork raise
  if (entry.mesh) updateForkHeight(entry.mesh, 0.5);

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

  if (entry.mesh) updateForkHeight(entry.mesh, 0);

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

// ---------------------------------------------------------------------------
// 3D Mesh
// ---------------------------------------------------------------------------

export function buildForkliftMesh(specs, registryId) {
  var group = new THREE.Group();

  var bodyMat = new THREE.MeshStandardMaterial({
    color: 0xccaa33,
    roughness: 0.6,
    metalness: 0.3,
  });

  // Body
  var bodyGeo = new THREE.BoxGeometry(1.4, 1.0, 2.2);
  var body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.7, 0);
  body.castShadow = true;
  body.userData.visibilityCategory = 'forklifts';
  group.add(body);

  // Cab/roof
  var cabGeo = new THREE.BoxGeometry(1.2, 0.6, 1.0);
  var cabMat = new THREE.MeshStandardMaterial({ color: 0x888866, roughness: 0.7, metalness: 0.2 });
  var cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(0, 1.5, -0.3);
  cab.castShadow = true;
  cab.userData.visibilityCategory = 'forklifts';
  group.add(cab);

  // Mast (vertical rails in front)
  var mastMat = new THREE.MeshStandardMaterial({ color: 0x666655, roughness: 0.5, metalness: 0.5 });
  var mastGeo = new THREE.BoxGeometry(0.1, 2.5, 0.1);
  var leftMast = new THREE.Mesh(mastGeo, mastMat);
  leftMast.position.set(-0.4, 1.45, 1.0);
  leftMast.userData.visibilityCategory = 'forklifts';
  group.add(leftMast);

  var rightMast = new THREE.Mesh(mastGeo, mastMat);
  rightMast.position.set(0.4, 1.45, 1.0);
  rightMast.userData.visibilityCategory = 'forklifts';
  group.add(rightMast);

  // Fork tines
  var forkMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 });
  var forkGeo = new THREE.BoxGeometry(0.15, 0.08, 1.2);
  var leftFork = new THREE.Mesh(forkGeo, forkMat);
  leftFork.position.set(-0.35, 0.2, 1.5);
  leftFork.userData.visibilityCategory = 'forklifts';
  leftFork.userData.isFork = true;
  group.add(leftFork);

  var rightFork = new THREE.Mesh(forkGeo, forkMat);
  rightFork.position.set(0.35, 0.2, 1.5);
  rightFork.userData.visibilityCategory = 'forklifts';
  rightFork.userData.isFork = true;
  group.add(rightFork);

  // Wheels (simple cylinders)
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  var wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8);
  var wheelPositions = [
    [-0.7, 0.25, -0.7], [0.7, 0.25, -0.7],
    [-0.7, 0.25, 0.7],  [0.7, 0.25, 0.7],
  ];
  for (var w = 0; w < wheelPositions.length; w++) {
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wheelPositions[w][0], wheelPositions[w][1], wheelPositions[w][2]);
    wheel.userData.visibilityCategory = 'forklifts';
    group.add(wheel);
  }

  group.userData.visibilityCategory = 'forklifts';
  group.userData.registryId = registryId;
  group.userData.registryType = 'forklift';

  return group;
}

function updateForkHeight(mesh, height) {
  mesh.traverse(function(child) {
    if (child.userData && child.userData.isFork) {
      child.position.y = 0.2 + height;
    }
  });
}