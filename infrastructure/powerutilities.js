// ============================================================================
// powerutilities.js — Electrical and Utility Infrastructure
// Forgeworks Infrastructure Tier 3
// ============================================================================
// Models the forge power distribution and utility systems: electrical
// panels, gas lines, water/coolant lines, and compressed air.
//
// Imports: worldclock.js, measurementunits.js, floorplan.js
// Exports: Utility connection registry, capacity queries, validation
// ============================================================================

import { getTime } from './worldclock.js';
import { formatValue } from './measurementunits.js';
import { getCell, getGridWidth, getGridDepth } from './floorplan.js';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Default Requirements per Equipment Type (SI units)
// ---------------------------------------------------------------------------

const EQUIPMENT_REQUIREMENTS = {
  furnace:  { electrical: 75000,  gas: 500, water: 0,   compressed_air: 0   },
  press:    { electrical: 150000, gas: 0,   water: 50,  compressed_air: 500 },
  hammer:   { electrical: 50000,  gas: 0,   water: 0,   compressed_air: 800 },
  quench:   { electrical: 5000,   gas: 0,   water: 200, compressed_air: 0   },
  rack:     { electrical: 500,    gas: 0,   water: 0,   compressed_air: 0   },
};

const MAX_CONNECTION_DISTANCE = 15;
const UTILITY_TYPES = ['electrical', 'gas', 'water', 'compressed_air'];
const UTILITY_PREFIXES = { electrical: 'E', gas: 'G', water: 'WA', compressed_air: 'CA' };

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let utilities = { electrical: [], gas: [], water: [], compressed_air: [] };
let nextIds = { electrical: 1, gas: 1, water: 1, compressed_air: 1 };

// ---------------------------------------------------------------------------
// Loading / Saving
// ---------------------------------------------------------------------------

export function loadUtilities(config) {
  if (!config) return;
  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var type = UTILITY_TYPES[t];
    utilities[type] = [];
    nextIds[type] = 1;
    if (config[type]) {
      for (var i = 0; i < config[type].length; i++) {
        var conn = config[type][i];
        utilities[type].push({
          id: conn.id, gridX: conn.gridX, gridZ: conn.gridZ,
          capacity: conn.capacity, currentLoad: conn.currentLoad || 0,
          type: conn.type || 'main',
        });
        var prefix = UTILITY_PREFIXES[type];
        var numStr = String(conn.id).replace(prefix + '-', '');
        var num = parseInt(numStr, 10);
        if (!isNaN(num) && num >= nextIds[type]) nextIds[type] = num + 1;
      }
    }
  }
}

export function getUtilities() {
  var result = {};
  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var type = UTILITY_TYPES[t];
    result[type] = utilities[type].map(function(c) {
      return { id: c.id, gridX: c.gridX, gridZ: c.gridZ, capacity: c.capacity, currentLoad: c.currentLoad, type: c.type };
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

export function addConnection(utilityType, gridX, gridZ, capacity, connType) {
  var prefix = UTILITY_PREFIXES[utilityType];
  if (!prefix) { console.warn('powerutilities: unknown type ' + utilityType); return null; }
  var id = prefix + '-' + String(nextIds[utilityType]).padStart(3, '0');
  nextIds[utilityType]++;
  var conn = { id: id, gridX: gridX, gridZ: gridZ, capacity: capacity, currentLoad: 0, type: connType || 'main' };
  utilities[utilityType].push(conn);
  return conn;
}

export function removeConnection(utilityType, id) {
  var list = utilities[utilityType];
  if (!list) return false;
  var idx = list.findIndex(function(c) { return c.id === id; });
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

export function getConnections(utilityType) {
  return utilities[utilityType] || [];
}

// ---------------------------------------------------------------------------
// Nearest Connection Queries
// ---------------------------------------------------------------------------

export function getNearestConnection(utilityType, gridX, gridZ, maxDistance) {
  var maxDist = maxDistance || MAX_CONNECTION_DISTANCE;
  var list = utilities[utilityType];
  if (!list || list.length === 0) return null;
  var nearest = null;
  var nearestDist = Infinity;
  for (var i = 0; i < list.length; i++) {
    var conn = list[i];
    var dist = Math.abs(conn.gridX - gridX) + Math.abs(conn.gridZ - gridZ);
    if (dist <= maxDist && dist < nearestDist) { nearestDist = dist; nearest = conn; }
  }
  if (!nearest) return null;
  return { connection: nearest, distance: nearestDist };
}

export function getNearestAvailableConnection(utilityType, gridX, gridZ, requiredCapacity, maxDistance) {
  var maxDist = maxDistance || MAX_CONNECTION_DISTANCE;
  var list = utilities[utilityType];
  if (!list || list.length === 0) return null;
  var nearest = null;
  var nearestDist = Infinity;
  for (var i = 0; i < list.length; i++) {
    var conn = list[i];
    var available = conn.capacity - conn.currentLoad;
    if (available < requiredCapacity) continue;
    var dist = Math.abs(conn.gridX - gridX) + Math.abs(conn.gridZ - gridZ);
    if (dist <= maxDist && dist < nearestDist) { nearestDist = dist; nearest = conn; }
  }
  if (!nearest) return null;
  return { connection: nearest, distance: nearestDist, available: nearest.capacity - nearest.currentLoad };
}

// ---------------------------------------------------------------------------
// Load Management
// ---------------------------------------------------------------------------

export function updateLoad(connectionId, newLoad) {
  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var list = utilities[UTILITY_TYPES[t]];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === connectionId) { list[i].currentLoad = newLoad; return true; }
    }
  }
  return false;
}

export function calculateTotalLoad(utilityType) {
  var list = utilities[utilityType];
  if (!list) return { totalCapacity: 0, totalLoad: 0, utilization: 0 };
  var totalCapacity = 0, totalLoad = 0;
  for (var i = 0; i < list.length; i++) {
    totalCapacity += list[i].capacity;
    totalLoad += list[i].currentLoad;
  }
  return { totalCapacity: totalCapacity, totalLoad: totalLoad, utilization: totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0 };
}

// ---------------------------------------------------------------------------
// Placement Validation
// ---------------------------------------------------------------------------

export function validatePlacement(equipmentType, gridX, gridZ, specs) {
  var reasons = [];
  var requirements = EQUIPMENT_REQUIREMENTS[equipmentType];
  if (!requirements) return { valid: true, reasons: [] };

  var reqs = {
    electrical: (specs && specs.powerDraw !== undefined) ? specs.powerDraw : requirements.electrical,
    gas: (specs && specs.gasFlow !== undefined) ? specs.gasFlow : requirements.gas,
    water: (specs && specs.waterFlow !== undefined) ? specs.waterFlow : requirements.water,
    compressed_air: (specs && specs.airFlow !== undefined) ? specs.airFlow : requirements.compressed_air,
  };

  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var uType = UTILITY_TYPES[t];
    var required = reqs[uType];
    if (required <= 0) continue;
    var result = getNearestAvailableConnection(uType, gridX, gridZ, required);
    if (!result) {
      var anyNearby = getNearestConnection(uType, gridX, gridZ);
      if (!anyNearby) {
        reasons.push('No ' + uType + ' connection within ' + MAX_CONNECTION_DISTANCE + ' cells');
      } else {
        var available = anyNearby.connection.capacity - anyNearby.connection.currentLoad;
        reasons.push('Insufficient ' + uType + ': needs ' + required + ', nearest (' + anyNearby.connection.id + ') has ' + available + ' available');
      }
    }
  }
  return { valid: reasons.length === 0, reasons: reasons };
}

/**
 * Enhanced validation returning detailed utility info per type.
 */
export function validatePlacementFull(equipmentType, gridX, gridZ, gWidth, gDepth, rotation, specs) {
  var basic = validatePlacement(equipmentType, gridX, gridZ, specs);
  var requirements = EQUIPMENT_REQUIREMENTS[equipmentType] || {};
  var detail = {};
  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var uType = UTILITY_TYPES[t];
    var required = requirements[uType] || 0;
    if (specs && specs.powerDraw !== undefined && uType === 'electrical') required = specs.powerDraw;
    var nearest = getNearestAvailableConnection(uType, gridX, gridZ, required);
    detail[uType] = {
      required: required,
      available: nearest ? (nearest.connection.capacity - nearest.connection.currentLoad) : 0,
      connection: nearest ? nearest.connection.id : null,
    };
  }
  return { valid: basic.valid, errors: basic.reasons, warnings: [], utilityDetail: detail };
}

// ---------------------------------------------------------------------------
// Utility Visualization
// ---------------------------------------------------------------------------

export function buildUtilityMeshes() {
  var group = new THREE.Group();
  group.userData.visibilityCategory = 'utilities';
  var typeColors = { electrical: 0xffff00, gas: 0xff4444, water: 0x4444ff, compressed_air: 0x44ff44 };

  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var uType = UTILITY_TYPES[t];
    var color = typeColors[uType];
    var list = utilities[uType];
    for (var i = 0; i < list.length; i++) {
      var conn = list[i];
      var markerGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8);
      var markerMat = new THREE.MeshStandardMaterial({
        color: color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity: 0.7,
      });
      var marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(conn.gridX + 0.5, 0.05, conn.gridZ + 0.5);
      marker.userData.visibilityCategory = 'utilities';
      marker.userData.utilityId = conn.id;
      marker.userData.utilityType = uType;
      group.add(marker);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// Snapshot / Restore
// ---------------------------------------------------------------------------

export function takeSnapshot() {
  var snap = {};
  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var type = UTILITY_TYPES[t];
    snap[type] = utilities[type].map(function(c) { return Object.assign({}, c); });
  }
  return { utilities: snap, nextIds: Object.assign({}, nextIds) };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot || !snapshot.utilities) { console.warn('powerutilities: invalid snapshot'); return; }
  for (var t = 0; t < UTILITY_TYPES.length; t++) {
    var type = UTILITY_TYPES[t];
    utilities[type] = snapshot.utilities[type].map(function(c) { return Object.assign({}, c); });
  }
  Object.assign(nextIds, snapshot.nextIds);
}

export function clear() {
  utilities = { electrical: [], gas: [], water: [], compressed_air: [] };
  nextIds = { electrical: 1, gas: 1, water: 1, compressed_air: 1 };
}

// ---------------------------------------------------------------------------
// Default Coulter Forge Utilities
// ---------------------------------------------------------------------------

export function getDefaultCoulterUtilities() {
  return {
    electrical: [
      { id: 'E-001', gridX: 5,  gridZ: 10, capacity: 100000, currentLoad: 0, type: 'panel' },
      { id: 'E-002', gridX: 30, gridZ: 10, capacity: 200000, currentLoad: 0, type: 'panel' },
      { id: 'E-003', gridX: 50, gridZ: 10, capacity: 100000, currentLoad: 0, type: 'panel' },
      { id: 'E-004', gridX: 30, gridZ: 50, capacity: 150000, currentLoad: 0, type: 'panel' },
    ],
    gas: [
      { id: 'G-001', gridX: 0, gridZ: 20, capacity: 1000, currentLoad: 0, type: 'main' },
      { id: 'G-002', gridX: 0, gridZ: 50, capacity: 1000, currentLoad: 0, type: 'main' },
    ],
    water: [
      { id: 'WA-001', gridX: 25, gridZ: 0, capacity: 500, currentLoad: 0, type: 'main' },
      { id: 'WA-002', gridX: 45, gridZ: 0, capacity: 500, currentLoad: 0, type: 'main' },
    ],
    compressed_air: [
      { id: 'CA-001', gridX: 55, gridZ: 30, capacity: 2000, currentLoad: 0, type: 'compressor' },
    ],
  };
}