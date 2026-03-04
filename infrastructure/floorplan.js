// ============================================================================
// floorplan.js — Zone Registry & Spatial Re-exports
// Forgeworks Infrastructure
// ============================================================================
// Authoritative registry for all placed zones on the forge floor.
// Each zone has a unique ID (ZN-001, ZN-002, ...), a type, and a bounding
// rectangle in grid coordinates.
//
// Also re-exports spatial utilities from gridsquare.js for convenience.
//
// Imports: gridsquare.js
// Exports: Zone CRUD, queries, snapshot/restore, gridsquare re-exports
// ============================================================================

import {
  getGridWidth,
  getGridDepth,
  getCellSize,
  getWallHeight,
  getCell,
  setCell,
  setCellBlock,
  getCellBlockStates,
  isCellPassable,
  isCellAvailable,
  getCellsOfType,
  getZoneCells,
  gridToWorld,
  worldToGrid,
  loadLayout,
  saveLayout,
  getLayout,
  getLayoutName,
  setLayoutName,
  getDefaultCoulterLayout,
  getEmptyLayout,
  addWall,
  removeWall,
  getWalls,
  addDoor,
  removeDoor,
  getDoors,
  addPathway,
  removePathway,
  getPathways,
  findPath,
  takeSnapshot as takeGridSnapshot,
  restoreSnapshot as restoreGridSnapshot,
} from './gridsquare.js';

// Re-export everything from gridsquare
export {
  getGridWidth,
  getGridDepth,
  getCellSize,
  getWallHeight,
  getCell,
  setCell,
  setCellBlock,
  getCellBlockStates,
  isCellPassable,
  isCellAvailable,
  getCellsOfType,
  getZoneCells,
  gridToWorld,
  worldToGrid,
  loadLayout,
  saveLayout,
  getLayout,
  getLayoutName,
  setLayoutName,
  getDefaultCoulterLayout,
  getEmptyLayout,
  addWall,
  removeWall,
  getWalls,
  addDoor,
  removeDoor,
  getDoors,
  addPathway,
  removePathway,
  getPathways,
  findPath,
};


// ============================================================================
// ZONE TYPE DEFINITIONS — Single source of truth
// ============================================================================
// To add a new zone: add an entry here. Everything else derives from this.
// To remove a zone: delete its entry. Menu, colors, labels all update.
//
// Fields:
//   label    — human-readable name shown in labels and menus
//   color    — hex color string for fill, outline, and label
//   category — groups zones in the right-click menu
//              (storage, staging, operations, pathways, facilities)

export var ZONE_TYPES = {
  // --- Storage ---
  'zone:storage_raw':         { label: 'Storage Raw',       color: '#4499dd', category: 'storage' },
  'zone:storage_finished':    { label: 'Storage Finished',  color: '#2266aa', category: 'storage' },
  'zone:storage_scrap':       { label: 'Storage Scrap',     color: '#1a4477', category: 'storage' },

  // --- Staging ---
  'zone:staging_inbound':     { label: 'Staging In',        color: '#dd8833', category: 'staging' },
  'zone:staging_outbound':    { label: 'Staging Out',       color: '#ccaa22', category: 'staging' },

  // --- Operations ---
  'zone:heavy_machinery':     { label: 'Heavy Machinery',   color: '#cc3344', category: 'operations' },
  'zone:heat_treatment':      { label: 'Heat Treatment',    color: '#ee5522', category: 'operations' },
  'zone:maintenance':         { label: 'Maintenance',       color: '#9966cc', category: 'operations' },

  // --- Pathways ---
  'zone:pathway_forklift':    { label: 'Path Forklift',     color: '#44bb66', category: 'pathways' },
  'zone:pathway_manipulator': { label: 'Path Manipulator',  color: '#2d8a4e', category: 'pathways' },
  'zone:pathway_personnel':   { label: 'Path Personnel',    color: '#88cc44', category: 'pathways' },

  // --- Facilities ---
  'zone:office':              { label: 'Office',            color: '#44aaaa', category: 'facilities' },
  'zone:parking':             { label: 'Parking',           color: '#778899', category: 'facilities' },
  'zone:road':                { label: 'Road',              color: '#556677', category: 'facilities' },
  'zone:wall':                { label: 'Wall',              color: '#445566', category: 'facilities' },
};

// Derived: backward-compatible ZONE_COLORS map
export var ZONE_COLORS = {};
var _ztKeys = Object.keys(ZONE_TYPES);
for (var _i = 0; _i < _ztKeys.length; _i++) {
  ZONE_COLORS[_ztKeys[_i]] = ZONE_TYPES[_ztKeys[_i]].color;
}

/**
 * Get the readable label for a zone type.
 * @param {string} type - e.g. 'zone:heavy_machinery'
 * @returns {string}
 */
export function getZoneLabel(type) {
  return ZONE_TYPES[type] ? ZONE_TYPES[type].label : type;
}

/**
 * Get the color for a zone type.
 * @param {string} type
 * @returns {string} hex color
 */
export function getZoneColor(type) {
  return ZONE_TYPES[type] ? ZONE_TYPES[type].color : '#888888';
}

/**
 * Build a menu-ready array of zone items grouped by category.
 * Returns items with dividers between categories.
 * @returns {object[]} Array of { id, label } and { id: 'divider' }
 */
export function getZoneMenuItems() {
  var categories = ['storage', 'staging', 'operations', 'pathways', 'facilities'];
  var items = [];

  for (var c = 0; c < categories.length; c++) {
    if (c > 0) items.push({ id: 'divider' });

    var keys = Object.keys(ZONE_TYPES);
    for (var k = 0; k < keys.length; k++) {
      if (ZONE_TYPES[keys[k]].category === categories[c]) {
        items.push({ id: keys[k], label: ZONE_TYPES[keys[k]].label });
      }
    }
  }

  items.push({ id: 'divider' });
  items.push({ id: 'zone:clear', label: 'Clear Zone' });

  return items;
}


// ============================================================================
// ZONE REGISTRY
// ============================================================================

// Internal storage
var zones = {};          // keyed by zone ID
var nextZoneNum = 1;     // auto-increment counter

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

function generateZoneId() {
  var id = 'ZN-' + String(nextZoneNum).padStart(3, '0');
  nextZoneNum++;
  return id;
}

// ---------------------------------------------------------------------------
// Register / Unregister
// ---------------------------------------------------------------------------

/**
 * Register a new zone.
 *
 * @param {string} type - Zone type (e.g. 'zone:heavy_machinery')
 * @param {object} rect - Bounding rectangle { minX, minZ, maxX, maxZ } in grid coords
 * @param {object} [meta] - Optional metadata (mesh ref, notes, etc.)
 * @returns {object} The created zone entry with its assigned ID
 */
export function registerZone(type, rect, meta) {
  var id = generateZoneId();

  var entry = {
    id: id,
    type: type,
    rect: {
      minX: rect.minX,
      minZ: rect.minZ,
      maxX: rect.maxX,
      maxZ: rect.maxZ,
    },
    area: (rect.maxX - rect.minX + 1) * (rect.maxZ - rect.minZ + 1),
    createdAt: Date.now(),
    meta: meta || {},
  };

  zones[id] = entry;
  return entry;
}

/**
 * Unregister a zone by ID.
 *
 * @param {string} id - Zone ID (e.g. 'ZN-003')
 * @returns {object|null} The removed entry, or null if not found
 */
export function unregisterZone(id) {
  var entry = zones[id] || null;
  if (entry) {
    delete zones[id];
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Lookup / Query
// ---------------------------------------------------------------------------

/**
 * Get a zone by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getZone(id) {
  return zones[id] || null;
}

/**
 * Get all zones as an array.
 * @returns {object[]}
 */
export function getAllZones() {
  return Object.values(zones);
}

/**
 * Get all zones of a specific type.
 * @param {string} type - e.g. 'zone:heavy_machinery'
 * @returns {object[]}
 */
export function getZonesByType(type) {
  var result = [];
  var ids = Object.keys(zones);
  for (var i = 0; i < ids.length; i++) {
    if (zones[ids[i]].type === type) {
      result.push(zones[ids[i]]);
    }
  }
  return result;
}

/**
 * Get all zones whose rect overlaps a given rect.
 * @param {object} rect - { minX, minZ, maxX, maxZ }
 * @returns {object[]}
 */
export function getZonesInRect(rect) {
  var result = [];
  var ids = Object.keys(zones);
  for (var i = 0; i < ids.length; i++) {
    var z = zones[ids[i]];
    if (rectsOverlap(z.rect, rect)) {
      result.push(z);
    }
  }
  return result;
}

/**
 * Get the zone at a specific grid cell, or null.
 * If multiple zones overlap the cell, returns all of them.
 * @param {number} x - Grid X
 * @param {number} z - Grid Z
 * @returns {object[]}
 */
export function getZonesAtCell(x, z) {
  var result = [];
  var ids = Object.keys(zones);
  for (var i = 0; i < ids.length; i++) {
    var r = zones[ids[i]].rect;
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      result.push(zones[ids[i]]);
    }
  }
  return result;
}

/**
 * Get the total number of registered zones.
 * @returns {number}
 */
export function getZoneCount() {
  return Object.keys(zones).length;
}

/**
 * Get total area covered by all zones (may count overlaps twice).
 * @returns {number}
 */
export function getTotalZoneArea() {
  var total = 0;
  var ids = Object.keys(zones);
  for (var i = 0; i < ids.length; i++) {
    total += zones[ids[i]].area;
  }
  return total;
}

/**
 * Get a summary of zone counts by type.
 * @returns {object} e.g. { 'zone:heavy_machinery': 3, 'zone:storage_raw': 1 }
 */
export function getZoneSummary() {
  var summary = {};
  var ids = Object.keys(zones);
  for (var i = 0; i < ids.length; i++) {
    var t = zones[ids[i]].type;
    summary[t] = (summary[t] || 0) + 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update a zone's rect (e.g. after splitting).
 * @param {string} id
 * @param {object} newRect - { minX, minZ, maxX, maxZ }
 */
export function updateZoneRect(id, newRect) {
  var entry = zones[id];
  if (!entry) return;
  entry.rect = {
    minX: newRect.minX,
    minZ: newRect.minZ,
    maxX: newRect.maxX,
    maxZ: newRect.maxZ,
  };
  entry.area = (newRect.maxX - newRect.minX + 1) * (newRect.maxZ - newRect.minZ + 1);
}

/**
 * Update a zone's metadata.
 * @param {string} id
 * @param {object} meta - Merged into existing meta
 */
export function updateZoneMeta(id, meta) {
  var entry = zones[id];
  if (!entry) return;
  Object.assign(entry.meta, meta);
}

// ---------------------------------------------------------------------------
// Snapshot / Restore
// ---------------------------------------------------------------------------

/**
 * Take a snapshot of the entire zone registry + grid state.
 * @returns {object} Snapshot object
 */
export function takeSnapshot() {
  var gridSnap = takeGridSnapshot();

  // Deep copy zones
  var zonesCopy = {};
  var ids = Object.keys(zones);
  for (var i = 0; i < ids.length; i++) {
    var z = zones[ids[i]];
    zonesCopy[ids[i]] = {
      id: z.id,
      type: z.type,
      rect: { minX: z.rect.minX, minZ: z.rect.minZ, maxX: z.rect.maxX, maxZ: z.rect.maxZ },
      area: z.area,
      createdAt: z.createdAt,
      meta: JSON.parse(JSON.stringify(z.meta)),
    };
  }

  return {
    grid: gridSnap,
    zones: zonesCopy,
    nextZoneNum: nextZoneNum,
  };
}

/**
 * Restore from a snapshot.
 * @param {object} snapshot
 */
export function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.grid) restoreGridSnapshot(snapshot.grid);
  if (snapshot.zones) {
    zones = snapshot.zones;
  }
  if (snapshot.nextZoneNum) {
    nextZoneNum = snapshot.nextZoneNum;
  }
}

/**
 * Clear all zones.
 */
export function clearAllZones() {
  zones = {};
}

/**
 * Reset the zone registry (clear zones and reset ID counter).
 */
export function resetZoneRegistry() {
  zones = {};
  nextZoneNum = 1;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function rectsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}