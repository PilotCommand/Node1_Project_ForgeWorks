// ============================================================================
// static_registry.js — Static Equipment Registry
// Forgeworks · Static Equipment · Tier 2 Registry
// ============================================================================
// The authoritative catalog of all non-moving equipment in the forge. Every
// furnace, press, hammer, quench tank, and rack that exists in the current
// layout is registered here with a unique ID (e.g., FN-001, PR-002).
//
// No other file may create static equipment IDs — this registry is the
// single source of truth for static equipment identity and existence.
//
// Imports: measurementunits.js (for spec normalization)
// Exports: Register/unregister, lookup, iteration, ID generation
// ============================================================================

import { getDisplaySystem } from '../infrastructure/measurementunits.js';

// ---------------------------------------------------------------------------
// ID Prefix Mapping
// ---------------------------------------------------------------------------

const TYPE_PREFIXES = {
  furnace: 'FN',
  press:   'PR',
  hammer:  'HM',
  quench:  'QT',
  rack:    'RK',
};

// Reverse lookup: prefix → type
const PREFIX_TYPES = {};
for (const [type, prefix] of Object.entries(TYPE_PREFIXES)) {
  PREFIX_TYPES[prefix] = type;
}

// ---------------------------------------------------------------------------
// Registry Storage
// ---------------------------------------------------------------------------

// Main registry: Map of id → entry
const registry = new Map();

// Next available number per type (for auto-incrementing IDs)
const nextNumber = {
  furnace: 1,
  press:   1,
  hammer:  1,
  quench:  1,
  rack:    1,
};

// ---------------------------------------------------------------------------
// ID Generation — Internal
// ---------------------------------------------------------------------------

/**
 * Generate the next unique ID for a given equipment type.
 * Format: PREFIX-NNN (e.g., FN-001, PR-012)
 *
 * @param {string} type - Equipment type (furnace, press, hammer, quench, rack)
 * @returns {string} Unique ID
 */
function generateId(type) {
  const prefix = TYPE_PREFIXES[type];
  if (!prefix) {
    console.warn(`static_registry: unknown equipment type "${type}"`);
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
 * Register a new piece of static equipment.
 * Auto-generates a unique ID based on type. Returns the full registry entry.
 *
 * @param {string} type - Equipment type: 'furnace', 'press', 'hammer', 'quench', 'rack'
 * @param {string} name - Human-readable name (e.g., "Main Gas Furnace")
 * @param {number} gridX - Grid X position (left edge of footprint)
 * @param {number} gridZ - Grid Z position (top edge of footprint)
 * @param {number} gridWidth - Footprint width in grid cells (X axis)
 * @param {number} gridDepth - Footprint depth in grid cells (Z axis)
 * @param {object} [specs={}] - Type-specific configuration (set by equipment file)
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
    rotation: 0,               // 0, 90, 180, 270 degrees
    status: 'idle',            // idle, active, maintenance, offline
    specs: { ...specs },       // type-specific (defined by equipment file)
    mesh: null,                // Three.js mesh (set by equipment file after building geometry)
    createdAt: Date.now(),
  };

  registry.set(id, entry);
  return entry;
}

/**
 * Register equipment with a specific ID (used when loading saved layouts).
 * Skips auto-generation. Updates the next-number counter if needed.
 *
 * @param {string} id - The specific ID to register (e.g., "FN-003")
 * @param {string} type - Equipment type
 * @param {string} name - Human-readable name
 * @param {number} gridX - Grid X position
 * @param {number} gridZ - Grid Z position
 * @param {number} gridWidth - Footprint width
 * @param {number} gridDepth - Footprint depth
 * @param {object} [specs={}] - Type-specific configuration
 * @returns {object|null} The registry entry, or null if ID already exists
 */
export function registerWithId(id, type, name, gridX, gridZ, gridWidth, gridDepth, specs = {}) {
  if (registry.has(id)) {
    console.warn(`static_registry: ID "${id}" already registered`);
    return null;
  }

  // Update next-number counter so future auto-generated IDs don't collide
  const prefix = TYPE_PREFIXES[type];
  if (prefix) {
    const numStr = id.replace(`${prefix}-`, '');
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num >= nextNumber[type]) {
      nextNumber[type] = num + 1;
    }
  }

  const entry = {
    id,
    type,
    name,
    gridX,
    gridZ,
    gridWidth,
    gridDepth,
    rotation: 0,
    status: 'idle',
    specs: { ...specs },
    mesh: null,
    createdAt: Date.now(),
  };

  registry.set(id, entry);
  return entry;
}

/**
 * Remove a piece of equipment from the registry.
 *
 * @param {string} id - Equipment ID to remove
 * @returns {boolean} True if removed, false if ID not found
 */
export function unregister(id) {
  if (!registry.has(id)) {
    console.warn(`static_registry: cannot unregister unknown ID "${id}"`);
    return false;
  }
  registry.delete(id);
  return true;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Get a single equipment entry by ID.
 * @param {string} id
 * @returns {object|null} Registry entry or null
 */
export function get(id) {
  return registry.get(id) || null;
}

/**
 * Get all equipment of a specific type.
 * @param {string} type - 'furnace', 'press', 'hammer', 'quench', 'rack'
 * @returns {Array<object>} Array of registry entries
 */
export function getByType(type) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.type === type) {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Get all registered static equipment.
 * @returns {Array<object>} Array of all registry entries
 */
export function getAll() {
  return Array.from(registry.values());
}

/**
 * Check if an ID exists in the registry.
 * @param {string} id
 * @returns {boolean}
 */
export function has(id) {
  return registry.has(id);
}

/**
 * Find equipment at a specific grid position.
 * Checks if the given cell falls within any equipment's footprint.
 *
 * @param {number} gridX - Cell X
 * @param {number} gridZ - Cell Z
 * @returns {object|null} The equipment entry occupying that cell, or null
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
// State Updates
// ---------------------------------------------------------------------------

/**
 * Update equipment operational status.
 * @param {string} id - Equipment ID
 * @param {string} newStatus - 'idle', 'active', 'maintenance', 'offline'
 * @returns {boolean} True if updated
 */
export function updateStatus(id, newStatus) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn(`static_registry: cannot update status of unknown ID "${id}"`);
    return false;
  }
  entry.status = newStatus;
  return true;
}

/**
 * Update equipment grid position (used when moving equipment in sandbox).
 * @param {string} id - Equipment ID
 * @param {number} newGridX - New grid X
 * @param {number} newGridZ - New grid Z
 * @returns {boolean} True if updated
 */
export function updateGridPosition(id, newGridX, newGridZ) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn(`static_registry: cannot update position of unknown ID "${id}"`);
    return false;
  }
  entry.gridX = newGridX;
  entry.gridZ = newGridZ;
  return true;
}

/**
 * Update equipment rotation.
 * For 90 and 270 degrees, gridWidth and gridDepth swap.
 *
 * @param {string} id - Equipment ID
 * @param {number} rotation - 0, 90, 180, or 270
 * @returns {boolean} True if updated
 */
export function updateRotation(id, rotation) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn(`static_registry: cannot update rotation of unknown ID "${id}"`);
    return false;
  }

  const oldRotation = entry.rotation;
  entry.rotation = rotation;

  // Swap width/depth if transitioning between 0/180 and 90/270
  const wasSwapped = (oldRotation === 90 || oldRotation === 270);
  const needsSwap = (rotation === 90 || rotation === 270);

  if (wasSwapped !== needsSwap) {
    const temp = entry.gridWidth;
    entry.gridWidth = entry.gridDepth;
    entry.gridDepth = temp;
  }

  return true;
}

/**
 * Update equipment specs (partial merge).
 * @param {string} id - Equipment ID
 * @param {object} specUpdates - Partial specs to merge
 * @returns {boolean} True if updated
 */
export function updateSpecs(id, specUpdates) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn(`static_registry: cannot update specs of unknown ID "${id}"`);
    return false;
  }
  Object.assign(entry.specs, specUpdates);
  return true;
}

/**
 * Set the Three.js mesh reference for an equipment entry.
 * Called by equipment files after building geometry.
 *
 * @param {string} id - Equipment ID
 * @param {THREE.Object3D} mesh - The mesh or group
 * @returns {boolean} True if updated
 */
export function setMesh(id, mesh) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.mesh = mesh;
  return true;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/**
 * Total number of registered static equipment.
 * @returns {number}
 */
export function count() {
  return registry.size;
}

/**
 * Count equipment of a specific type.
 * @param {string} type
 * @returns {number}
 */
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

/**
 * Iterate over all entries. Supports for...of.
 * @returns {IterableIterator<object>}
 */
export function values() {
  return registry.values();
}

/**
 * Execute a callback for every registered entry.
 * @param {function} callback - Called with (entry) for each
 */
export function forEach(callback) {
  for (const entry of registry.values()) {
    callback(entry);
  }
}

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------

/**
 * Capture the full registry state as a plain object.
 * @returns {object} Snapshot for restoreSnapshot()
 */
export function takeSnapshot() {
  const entries = [];
  for (const entry of registry.values()) {
    entries.push({
      ...entry,
      specs: { ...entry.specs },
      mesh: null, // meshes are not serializable — will be rebuilt
    });
  }
  return {
    entries,
    nextNumber: { ...nextNumber },
  };
}

/**
 * Restore registry state from a snapshot.
 * Clears the current registry and replaces it entirely.
 *
 * @param {object} snapshot - Object returned by takeSnapshot()
 */
export function restoreSnapshot(snapshot) {
  if (!snapshot || !snapshot.entries) {
    console.warn('static_registry: invalid snapshot');
    return;
  }

  registry.clear();
  for (const entry of snapshot.entries) {
    registry.set(entry.id, { ...entry, specs: { ...entry.specs } });
  }

  // Restore ID counters
  Object.assign(nextNumber, snapshot.nextNumber);
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

/**
 * Remove all entries from the registry and reset ID counters.
 * Used when loading a new layout.
 */
export function clear() {
  registry.clear();
  nextNumber.furnace = 1;
  nextNumber.press = 1;
  nextNumber.hammer = 1;
  nextNumber.quench = 1;
  nextNumber.rack = 1;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get the type prefix mapping (for display/debugging).
 * @returns {object} e.g., { furnace: 'FN', press: 'PR', ... }
 */
export function getTypePrefixes() {
  return { ...TYPE_PREFIXES };
}

/**
 * Determine equipment type from an ID string.
 * @param {string} id - e.g., "FN-001"
 * @returns {string|null} Equipment type or null
 */
export function getTypeFromId(id) {
  if (!id || typeof id !== 'string') return null;
  const prefix = id.split('-')[0];
  return PREFIX_TYPES[prefix] || null;
}

/**
 * Get all grid cells occupied by a piece of equipment.
 * @param {string} id - Equipment ID
 * @returns {Array<{x: number, z: number}>} Array of occupied cell coordinates
 */
export function getOccupiedCells(id) {
  const entry = registry.get(id);
  if (!entry) return [];

  const cells = [];
  for (let x = entry.gridX; x < entry.gridX + entry.gridWidth; x++) {
    for (let z = entry.gridZ; z < entry.gridZ + entry.gridDepth; z++) {
      cells.push({ x, z });
    }
  }
  return cells;
}