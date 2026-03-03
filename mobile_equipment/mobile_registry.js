// ============================================================================
// mobile_registry.js — Mobile Equipment Registry
// Forgeworks · Mobile Equipment · Tier 2 Registry
// ============================================================================
// The authoritative catalog of all moving equipment: forklifts, manipulators,
// trucks, and mobile tooling. Same role as static_registry.js but for mobile
// assets. Each entry tracks current position (which changes over time),
// assigned home position, operational status, and current task assignment.
//
// No other file may create mobile equipment IDs — this registry is the
// single source of truth for mobile equipment identity and existence.
//
// Imports: measurementunits.js (for spec normalization)
// Exports: Register/unregister, lookup, task assignment, ID generation
// ============================================================================

import { getDisplaySystem } from '../infrastructure/measurementunits.js';

// ---------------------------------------------------------------------------
// ID Prefix Mapping
// ---------------------------------------------------------------------------

const TYPE_PREFIXES = {
  forklift:     'FK',
  manipulator:  'MN',
  truck:        'TK',
  tool:         'TL',
};

const PREFIX_TYPES = {};
for (const [type, prefix] of Object.entries(TYPE_PREFIXES)) {
  PREFIX_TYPES[prefix] = type;
}

// ---------------------------------------------------------------------------
// Registry Storage
// ---------------------------------------------------------------------------

const registry = new Map();

const nextNumber = {
  forklift:    1,
  manipulator: 1,
  truck:       1,
  tool:        1,
};

// ---------------------------------------------------------------------------
// ID Generation — Internal
// ---------------------------------------------------------------------------

function generateId(type) {
  const prefix = TYPE_PREFIXES[type];
  if (!prefix) {
    console.warn(`mobile_registry: unknown equipment type "${type}"`);
    return null;
  }
  const num = nextNumber[type];
  const id = `${prefix}-${String(num).padStart(3, '0')}`;
  nextNumber[type] = num + 1;
  return id;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a new piece of mobile equipment.
 * Auto-generates a unique ID. Returns the full registry entry.
 *
 * @param {string} type - 'forklift', 'manipulator', 'truck', 'tool'
 * @param {string} name - Human-readable name
 * @param {number} gridX - Current grid X position
 * @param {number} gridZ - Current grid Z position
 * @param {number} gridWidth - Footprint width in grid cells
 * @param {number} gridDepth - Footprint depth in grid cells
 * @param {object} [specs={}] - Type-specific configuration
 * @returns {object|null} The registry entry, or null if type is invalid
 */
export function register(type, name, gridX, gridZ, gridWidth, gridDepth, specs = {}) {
  const id = generateId(type);
  if (!id) return null;

  const entry = {
    id,
    type,
    name,
    gridX,
    gridZ,
    gridWidth,
    gridDepth,
    rotation: 0,

    // Precise position for smooth rendering (sub-cell movement)
    preciseX: gridX + gridWidth / 2,
    preciseZ: gridZ + gridDepth / 2,

    // Home position (where it parks when idle)
    homeGridX: gridX,
    homeGridZ: gridZ,

    // Operational state
    status: 'idle',
    currentTask: null,

    // Pathfinding state
    currentPath: [],
    pathIndex: 0,

    // Type-specific specs
    specs: { ...specs },

    // Three.js mesh (set by equipment file)
    mesh: null,

    createdAt: Date.now(),
  };

  registry.set(id, entry);
  return entry;
}

/**
 * Register mobile equipment with a specific ID (for loading saved state).
 */
export function registerWithId(id, type, name, gridX, gridZ, gridWidth, gridDepth, specs = {}) {
  if (registry.has(id)) {
    console.warn(`mobile_registry: ID "${id}" already registered`);
    return null;
  }

  const prefix = TYPE_PREFIXES[type];
  if (prefix) {
    const numStr = id.replace(`${prefix}-`, '');
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num >= nextNumber[type]) {
      nextNumber[type] = num + 1;
    }
  }

  const entry = {
    id, type, name, gridX, gridZ, gridWidth, gridDepth,
    rotation: 0,
    preciseX: gridX + gridWidth / 2,
    preciseZ: gridZ + gridDepth / 2,
    homeGridX: gridX,
    homeGridZ: gridZ,
    status: 'idle',
    currentTask: null,
    currentPath: [],
    pathIndex: 0,
    specs: { ...specs },
    mesh: null,
    createdAt: Date.now(),
  };

  registry.set(id, entry);
  return entry;
}

/**
 * Remove mobile equipment from the registry.
 */
export function unregister(id) {
  if (!registry.has(id)) {
    console.warn(`mobile_registry: cannot unregister unknown ID "${id}"`);
    return false;
  }
  registry.delete(id);
  return true;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function get(id) {
  return registry.get(id) || null;
}

export function getByType(type) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.type === type) results.push(entry);
  }
  return results;
}

export function getAll() {
  return Array.from(registry.values());
}

export function has(id) {
  return registry.has(id);
}

/**
 * Find mobile equipment at a specific grid position.
 */
export function getAtPosition(gridX, gridZ) {
  for (const entry of registry.values()) {
    if (
      gridX >= entry.gridX &&
      gridX < entry.gridX + entry.gridWidth &&
      gridZ >= entry.gridZ &&
      gridZ < entry.gridZ + entry.gridDepth
    ) {
      return entry;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Idle Equipment Query (for Dispatching)
// ---------------------------------------------------------------------------

/**
 * Get all idle equipment of a specific type.
 * Used by the dispatch system to find available vehicles.
 */
export function getIdle(type) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.type === type && entry.status === 'idle') {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Get the nearest idle equipment of a type to a grid position.
 * Uses Manhattan distance for quick estimation.
 */
export function getNearestIdle(type, gridX, gridZ) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const entry of registry.values()) {
    if (entry.type === type && entry.status === 'idle') {
      const dist = Math.abs(entry.gridX - gridX) + Math.abs(entry.gridZ - gridZ);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = entry;
      }
    }
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Task Assignment
// ---------------------------------------------------------------------------

/**
 * Assign a task to mobile equipment. Sets status to 'traveling'.
 * @param {string} id - Equipment ID
 * @param {object} task - { action, fromId, toId, productId }
 */
export function assignTask(id, task) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn(`mobile_registry: cannot assign task to unknown ID "${id}"`);
    return false;
  }
  entry.currentTask = { ...task };
  entry.status = 'traveling';
  return true;
}

/**
 * Clear the current task and return to idle.
 */
export function clearTask(id) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn(`mobile_registry: cannot clear task of unknown ID "${id}"`);
    return false;
  }
  entry.currentTask = null;
  entry.status = 'idle';
  entry.currentPath = [];
  entry.pathIndex = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Position Updates
// ---------------------------------------------------------------------------

export function updateGridPosition(id, newGridX, newGridZ) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.gridX = newGridX;
  entry.gridZ = newGridZ;
  return true;
}

/**
 * Update precise position (for smooth rendering between cells).
 * Also updates grid position when crossing cell boundaries.
 */
export function updatePrecisePosition(id, preciseX, preciseZ) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.preciseX = preciseX;
  entry.preciseZ = preciseZ;

  const newGridX = Math.floor(preciseX - entry.gridWidth / 2);
  const newGridZ = Math.floor(preciseZ - entry.gridDepth / 2);
  entry.gridX = newGridX;
  entry.gridZ = newGridZ;

  return true;
}

/**
 * Set the current path (waypoints from pathfinding).
 */
export function setPath(id, path) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.currentPath = path || [];
  entry.pathIndex = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Status Updates
// ---------------------------------------------------------------------------

export function updateStatus(id, newStatus) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.status = newStatus;
  return true;
}

export function updateRotation(id, rotation) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.rotation = rotation;
  return true;
}

export function updateSpecs(id, specUpdates) {
  const entry = registry.get(id);
  if (!entry) return false;
  Object.assign(entry.specs, specUpdates);
  return true;
}

export function setMesh(id, mesh) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.mesh = mesh;
  return true;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

export function count() {
  return registry.size;
}

export function countByType(type) {
  let n = 0;
  for (const entry of registry.values()) {
    if (entry.type === type) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Iteration
// ---------------------------------------------------------------------------

export function values() {
  return registry.values();
}

export function forEach(callback) {
  for (const entry of registry.values()) {
    callback(entry);
  }
}

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------

export function takeSnapshot() {
  const entries = [];
  for (const entry of registry.values()) {
    entries.push({
      ...entry,
      specs: { ...entry.specs },
      currentTask: entry.currentTask ? { ...entry.currentTask } : null,
      currentPath: [...entry.currentPath],
      mesh: null,
    });
  }
  return {
    entries,
    nextNumber: { ...nextNumber },
  };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot || !snapshot.entries) {
    console.warn('mobile_registry: invalid snapshot');
    return;
  }

  registry.clear();
  for (const entry of snapshot.entries) {
    registry.set(entry.id, {
      ...entry,
      specs: { ...entry.specs },
      currentTask: entry.currentTask ? { ...entry.currentTask } : null,
      currentPath: [...entry.currentPath],
    });
  }

  Object.assign(nextNumber, snapshot.nextNumber);
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export function clear() {
  registry.clear();
  nextNumber.forklift = 1;
  nextNumber.manipulator = 1;
  nextNumber.truck = 1;
  nextNumber.tool = 1;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function getTypePrefixes() {
  return { ...TYPE_PREFIXES };
}

export function getTypeFromId(id) {
  if (!id || typeof id !== 'string') return null;
  const prefix = id.split('-')[0];
  return PREFIX_TYPES[prefix] || null;
}