// ============================================================================
// mobile_trucks.js — Truck Behavior and Rendering
// Forgeworks Mobile Equipment Tier 5
// ============================================================================
// Trucks are the interface between the forge and the outside world.
// Inbound trucks arrive with raw material. Outbound trucks depart with
// finished product. They dock, get loaded/unloaded, then depart.
//
// Imports: worldclock.js, measurementunits.js, mobile_registry.js
// Exports: Truck creation, update, load/unload, arrive/depart, mesh
// ============================================================================

import * as THREE from 'three';
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

  var mesh = buildTruckMesh(specs, entry.id);
  entry.mesh = mesh;

  // Start off-screen
  mesh.visible = false;

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateTruck(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'truck') return;

  var specs = entry.specs;

  if (specs.state === 'arriving') {
    specs.arrivalProgress += delta * 0.3; // takes ~3 seconds
    if (specs.arrivalProgress >= 1.0) {
      specs.arrivalProgress = 1.0;
      specs.state = 'docked';
      registry.updateStatus(id, 'idle');
    }
    // Animate sliding into dock position
    if (entry.mesh) {
      var startZ = specs.dockGridZ - 10;
      var endZ = specs.dockGridZ + 3;
      var currentZ = startZ + (endZ - startZ) * easeOutCubic(specs.arrivalProgress);
      entry.mesh.position.set(specs.dockGridX + 1.5, 0, currentZ);
      entry.mesh.visible = true;
    }
  } else if (specs.state === 'departing') {
    specs.departureProgress += delta * 0.3;
    if (specs.departureProgress >= 1.0) {
      specs.departureProgress = 1.0;
      specs.state = 'departed';
      if (entry.mesh) entry.mesh.visible = false;
      registry.updateStatus(id, 'idle');
    }
    // Animate sliding out
    if (entry.mesh) {
      var startZ = specs.dockGridZ + 3;
      var endZ = specs.dockGridZ - 15;
      var currentZ = startZ + (endZ - startZ) * easeInCubic(specs.departureProgress);
      entry.mesh.position.set(specs.dockGridX + 1.5, 0, currentZ);
    }
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
  return t * t * t;
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

// ---------------------------------------------------------------------------
// 3D Mesh
// ---------------------------------------------------------------------------

export function buildTruckMesh(specs, registryId) {
  var group = new THREE.Group();

  var truckColor = specs.direction === 'inbound' ? 0x556677 : 0x667755;

  var bodyMat = new THREE.MeshStandardMaterial({
    color: truckColor,
    roughness: 0.7,
    metalness: 0.3,
  });

  // Cab
  var cabGeo = new THREE.BoxGeometry(2.4, 1.8, 2.0);
  var cab = new THREE.Mesh(cabGeo, bodyMat);
  cab.position.set(0, 1.1, -1.5);
  cab.castShadow = true;
  cab.userData.visibilityCategory = 'trucks';
  group.add(cab);

  // Windshield
  var windGeo = new THREE.PlaneGeometry(2.0, 1.0);
  var windMat = new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  var windshield = new THREE.Mesh(windGeo, windMat);
  windshield.position.set(0, 1.6, -0.5);
  windshield.userData.visibilityCategory = 'trucks';
  group.add(windshield);

  // Bed/trailer
  var bedGeo = new THREE.BoxGeometry(2.6, 0.3, 4.0);
  var bed = new THREE.Mesh(bedGeo, bodyMat);
  bed.position.set(0, 0.65, 1.5);
  bed.castShadow = true;
  bed.receiveShadow = true;
  bed.userData.visibilityCategory = 'trucks';
  group.add(bed);

  // Bed rails
  var railMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.4 });
  var railGeo = new THREE.BoxGeometry(0.08, 0.6, 4.0);
  var leftRail = new THREE.Mesh(railGeo, railMat);
  leftRail.position.set(-1.25, 1.1, 1.5);
  leftRail.userData.visibilityCategory = 'trucks';
  group.add(leftRail);

  var rightRail = new THREE.Mesh(railGeo, railMat);
  rightRail.position.set(1.25, 1.1, 1.5);
  rightRail.userData.visibilityCategory = 'trucks';
  group.add(rightRail);

  // Wheels
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  var wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  var wheelPos = [
    [-1.2, 0.35, -1.8], [1.2, 0.35, -1.8],
    [-1.2, 0.35, 0.5],  [1.2, 0.35, 0.5],
    [-1.2, 0.35, 2.5],  [1.2, 0.35, 2.5],
  ];
  for (var w = 0; w < wheelPos.length; w++) {
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wheelPos[w][0], wheelPos[w][1], wheelPos[w][2]);
    wheel.userData.visibilityCategory = 'trucks';
    group.add(wheel);
  }

  group.userData.visibilityCategory = 'trucks';
  group.userData.registryId = registryId;
  group.userData.registryType = 'truck';

  return group;
}