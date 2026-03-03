// ============================================================================
// static_racks.js — Storage Rack and Bin Behavior and Rendering
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines storage infrastructure: material racks, finished part racks, scrap
// bins, die storage shelves, and tool cribs. Primarily inventory tracking.
//
// Imports: measurementunits.js, static_registry.js
// Exports: Rack creation, inventory management, mesh building
// ============================================================================

import * as THREE from 'three';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

const DEFAULT_SPECS = {
  rackType: 'raw_material',    // raw_material, finished_goods, scrap, die_storage, tool_crib
  capacityCount: 20,
  capacityWeight: 5000,        // kg
  currentContents: [],         // item IDs
  currentWeight: 0,            // kg
};

// Rack type colors for visual distinction
const RACK_COLORS = {
  raw_material:   0x3366aa,
  finished_goods: 0x33aa66,
  scrap:          0x886633,
  die_storage:    0x996699,
  tool_crib:      0x669999,
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

  var mesh = buildRackMesh(specs, entry.id);
  mesh.position.set(gridX + gridWidth / 2, 0, gridZ + gridDepth / 2);
  entry.mesh = mesh;

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

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

export function buildRackMesh(specs, registryId) {
  var group = new THREE.Group();

  var w = 2;
  var d = 3;
  var h = 2.5;
  var shelfCount = 3;

  var color = RACK_COLORS[specs.rackType] || 0x888888;

  var frameMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,
    metalness: 0.3,
  });

  // 4 vertical posts
  var postGeo = new THREE.BoxGeometry(0.08, h, 0.08);
  var positions = [
    [-w / 2 + 0.04, h / 2, -d / 2 + 0.04],
    [w / 2 - 0.04,  h / 2, -d / 2 + 0.04],
    [-w / 2 + 0.04, h / 2, d / 2 - 0.04],
    [w / 2 - 0.04,  h / 2, d / 2 - 0.04],
  ];
  for (var p = 0; p < positions.length; p++) {
    var post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(positions[p][0], positions[p][1], positions[p][2]);
    post.castShadow = true;
    post.userData.visibilityCategory = 'racks';
    group.add(post);
  }

  // Shelves
  var shelfGeo = new THREE.BoxGeometry(w - 0.1, 0.05, d - 0.1);
  var shelfMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.8,
    metalness: 0.2,
  });
  for (var s = 0; s <= shelfCount; s++) {
    var shelfY = (s / shelfCount) * (h - 0.1) + 0.05;
    var shelf = new THREE.Mesh(shelfGeo, shelfMat);
    shelf.position.set(0, shelfY, 0);
    shelf.receiveShadow = true;
    shelf.userData.visibilityCategory = 'racks';
    group.add(shelf);
  }

  group.userData.visibilityCategory = 'racks';
  group.userData.registryId = registryId;
  group.userData.registryType = 'rack';

  return group;
}