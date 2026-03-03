// ============================================================================
// mobile_manipulator.js — Manipulator Behavior and Rendering
// Forgeworks Mobile Equipment Tier 5
// ============================================================================
// A specialized mobile machine with a grabbing arm for handling hot
// workpieces. Loads/unloads furnaces, positions parts on press dies.
// Checks thermal tolerance before gripping hot products.
//
// Imports: worldclock.js, measurementunits.js, mobile_registry.js
// Exports: Manipulator creation, update, grip/release, mesh building
// ============================================================================

import * as THREE from 'three';
import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './mobile_registry.js';

const DEFAULT_SPECS = {
  gripCapacity: 500,         // kg max grip weight
  armReach: 4,               // meters
  thermalTolerance: 1200,    // Celsius max product temp it can handle
  currentLoad: null,         // product ID
  currentLoadWeight: 0,
  speed: 2,                  // meters per second (slower than forklift)
  state: 'idle',             // idle, traveling, gripping, releasing
  currentPath: [],
  pathIndex: 0,
  preciseX: 0,
  preciseZ: 0,
  heading: 0,
  armExtended: false,        // visual state
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createManipulator(name, homeGridX, homeGridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);
  specs.preciseX = homeGridX + 0.5;
  specs.preciseZ = homeGridZ + 0.5;
  specs.currentPath = [];

  var entry = registry.register('manipulator', name, homeGridX, homeGridZ, 2, 2, specs);
  entry.homeGridX = homeGridX;
  entry.homeGridZ = homeGridZ;

  var mesh = buildManipulatorMesh(specs, entry.id);
  mesh.position.set(specs.preciseX, 0, specs.preciseZ);
  entry.mesh = mesh;

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateManipulator(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'manipulator') return;

  var specs = entry.specs;
  if (specs.state !== 'traveling' || specs.currentPath.length === 0) return;

  if (specs.pathIndex >= specs.currentPath.length) {
    arriveAtDestination(entry);
    return;
  }

  var target = specs.currentPath[specs.pathIndex];
  var targetX = target.x + 0.5;
  var targetZ = target.z + 0.5;

  var dx = targetX - specs.preciseX;
  var dz = targetZ - specs.preciseZ;
  var dist = Math.sqrt(dx * dx + dz * dz);
  var moveAmount = specs.speed * delta;

  if (dist <= moveAmount) {
    specs.preciseX = targetX;
    specs.preciseZ = targetZ;
    if (dist > 0.01) specs.heading = Math.atan2(dx, dz);
    specs.pathIndex++;
    registry.updatePrecisePosition(id, specs.preciseX, specs.preciseZ);

    if (specs.pathIndex >= specs.currentPath.length) {
      arriveAtDestination(entry);
    }
  } else {
    var ratio = moveAmount / dist;
    specs.preciseX += dx * ratio;
    specs.preciseZ += dz * ratio;
    specs.heading = Math.atan2(dx, dz);
    registry.updatePrecisePosition(id, specs.preciseX, specs.preciseZ);
  }

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
      specs.state = 'gripping';
    } else if (task.action === 'deliver') {
      specs.state = 'releasing';
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

export function assignRoute(id, waypoints) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'manipulator') return false;
  entry.specs.currentPath = waypoints.slice();
  entry.specs.pathIndex = 0;
  entry.specs.state = 'traveling';
  return true;
}

// ---------------------------------------------------------------------------
// Grip / Release
// ---------------------------------------------------------------------------

/**
 * Grip a product. Checks thermal tolerance first.
 */
export function grip(id, productId, weight, productTemp) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'manipulator') return false;

  if (entry.specs.currentLoad !== null) {
    console.warn('mobile_manipulator: ' + id + ' already holding ' + entry.specs.currentLoad);
    return false;
  }

  var temp = productTemp || 0;
  if (temp > entry.specs.thermalTolerance) {
    console.warn('mobile_manipulator: product too hot (' + temp + 'C) for ' + id + ' (max ' + entry.specs.thermalTolerance + 'C)');
    return false;
  }

  var w = weight || 0;
  if (w > entry.specs.gripCapacity) {
    console.warn('mobile_manipulator: product too heavy for ' + id);
    return false;
  }

  entry.specs.currentLoad = productId;
  entry.specs.currentLoadWeight = w;
  entry.specs.armExtended = true;
  entry.specs.state = 'traveling';

  updateArmVisual(entry.mesh, true);
  return true;
}

/**
 * Release the current load.
 * @returns {string|null} Product ID released
 */
export function release(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'manipulator') return null;

  var productId = entry.specs.currentLoad;
  entry.specs.currentLoad = null;
  entry.specs.currentLoadWeight = 0;
  entry.specs.armExtended = false;
  entry.specs.state = 'idle';

  registry.clearTask(id);
  updateArmVisual(entry.mesh, false);
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

export function buildManipulatorMesh(specs, registryId) {
  var group = new THREE.Group();

  var baseMat = new THREE.MeshStandardMaterial({
    color: 0xcc6633,
    roughness: 0.6,
    metalness: 0.3,
  });

  // Mobile base (tracked platform)
  var baseGeo = new THREE.BoxGeometry(1.6, 0.5, 1.8);
  var base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.35, 0);
  base.castShadow = true;
  base.userData.visibilityCategory = 'manipulators';
  group.add(base);

  // Track treads
  var treadMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
  var treadGeo = new THREE.BoxGeometry(0.3, 0.3, 1.8);
  var leftTread = new THREE.Mesh(treadGeo, treadMat);
  leftTread.position.set(-0.8, 0.15, 0);
  leftTread.userData.visibilityCategory = 'manipulators';
  group.add(leftTread);

  var rightTread = new THREE.Mesh(treadGeo, treadMat);
  rightTread.position.set(0.8, 0.15, 0);
  rightTread.userData.visibilityCategory = 'manipulators';
  group.add(rightTread);

  // Turret/pivot
  var turretGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.4, 12);
  var turretMat = new THREE.MeshStandardMaterial({ color: 0xaa5522, roughness: 0.5, metalness: 0.4 });
  var turret = new THREE.Mesh(turretGeo, turretMat);
  turret.position.set(0, 0.8, 0);
  turret.userData.visibilityCategory = 'manipulators';
  group.add(turret);

  // Arm (extends forward)
  var armMat = new THREE.MeshStandardMaterial({ color: 0x888877, roughness: 0.5, metalness: 0.5 });
  var armGeo = new THREE.BoxGeometry(0.2, 0.2, 2.5);
  var arm = new THREE.Mesh(armGeo, armMat);
  arm.position.set(0, 1.1, 1.0);
  arm.castShadow = true;
  arm.userData.visibilityCategory = 'manipulators';
  arm.userData.isArm = true;
  group.add(arm);

  // Gripper (at end of arm)
  var gripMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.6 });
  var gripGeo = new THREE.BoxGeometry(0.5, 0.15, 0.3);
  var gripLeft = new THREE.Mesh(gripGeo, gripMat);
  gripLeft.position.set(-0.2, 1.05, 2.3);
  gripLeft.userData.visibilityCategory = 'manipulators';
  gripLeft.userData.isGripper = true;
  group.add(gripLeft);

  var gripRight = new THREE.Mesh(gripGeo, gripMat);
  gripRight.position.set(0.2, 1.05, 2.3);
  gripRight.userData.visibilityCategory = 'manipulators';
  gripRight.userData.isGripper = true;
  group.add(gripRight);

  group.userData.visibilityCategory = 'manipulators';
  group.userData.registryId = registryId;
  group.userData.registryType = 'manipulator';

  return group;
}

function updateArmVisual(mesh, extended) {
  if (!mesh) return;
  // Could animate arm extension; for now just visual feedback
  mesh.traverse(function(child) {
    if (child.userData && child.userData.isGripper && child.isMesh) {
      child.material.emissive = extended ? new THREE.Color(0x332200) : new THREE.Color(0x000000);
      child.material.emissiveIntensity = extended ? 0.3 : 0;
    }
  });
}