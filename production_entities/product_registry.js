// ============================================================================
// product_registry.js — Production Product Registry
// Forgeworks · Production Entities · Tier 2 Registry
// ============================================================================
// The authoritative catalog of all workpieces currently in the forge: raw
// stock waiting to be processed, in-progress forgings at a station, or
// finished parts awaiting shipment.
//
// Each entry tracks the product's unique ID (MP-001), material grade, current
// lifecycle state (16 named states), current location, temperature, dimensions,
// and a full audit trail of state transitions (history).
//
// The product is the center of the universe. Everything in the forge exists
// to serve this registry's inhabitants through their lifecycle journey.
//
// No other file may create product IDs — this registry is the single source
// of truth for product identity and existence.
//
// Imports: measurementunits.js (for spec normalization)
// Exports: Register/unregister, lifecycle state tracking, history, lookup
// ============================================================================

import { getDisplaySystem } from '../infrastructure/measurementunits.js';

// ---------------------------------------------------------------------------
// ID Prefix
// ---------------------------------------------------------------------------

const TYPE_PREFIX = 'MP';

// ---------------------------------------------------------------------------
// Lifecycle States (16 named states)
// ---------------------------------------------------------------------------
// The full journey of a product through the forge:
//
//   arriving -> unloading -> raw_stored -> queued ->
//   transport_heat -> heating -> transport_forge -> forging ->
//   transport_quench -> quenching -> cooling -> transport_store ->
//   finished_stored -> loading -> departed
//                                         (or scrapped at any point)
// ---------------------------------------------------------------------------

export const LIFECYCLE_STATES = [
  'arriving',
  'unloading',
  'raw_stored',
  'queued',
  'transport_heat',
  'heating',
  'transport_forge',
  'forging',
  'transport_quench',
  'quenching',
  'cooling',
  'transport_store',
  'finished_stored',
  'loading',
  'departed',
  'scrapped',
];

const VALID_STATES = new Set(LIFECYCLE_STATES);

// ---------------------------------------------------------------------------
// State Display Colors (for product tracker and 3D indicators)
// ---------------------------------------------------------------------------

export const STATE_COLORS = {
  arriving:         '#aaaaaa',
  unloading:        '#aaaaaa',
  raw_stored:       '#3399ff',
  queued:           '#3399ff',
  transport_heat:   '#ff9900',
  heating:          '#ff4400',
  transport_forge:  '#ff6600',
  forging:          '#cc3333',
  transport_quench: '#ff6600',
  quenching:        '#3366cc',
  cooling:          '#6699cc',
  transport_store:  '#66cc66',
  finished_stored:  '#33cc33',
  loading:          '#33cc33',
  departed:         '#999999',
  scrapped:         '#663333',
};

// ---------------------------------------------------------------------------
// Registry Storage
// ---------------------------------------------------------------------------

const registry = new Map();
let nextNumber = 1;

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

function generateId() {
  const id = TYPE_PREFIX + '-' + String(nextNumber).padStart(3, '0');
  nextNumber++;
  return id;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a new product (workpiece) in the forge.
 * Auto-generates a unique MP-XXX ID. Initial state is 'arriving'.
 *
 * @param {string} materialGrade - Material spec (e.g., '4140', '1045', '304SS')
 * @param {object} dimensions - { length, width, height } in meters
 * @param {number} weight - Mass in kilograms
 * @param {object} [options={}] - Optional overrides:
 *   - state: initial lifecycle state (default 'arriving')
 *   - temperature: initial temp in Celsius (default 25)
 *   - location: initial location ID (default null)
 *   - orderID: associated production order ID (default null)
 * @returns {object} The registry entry
 */
export function register(materialGrade, dimensions, weight, options = {}) {
  const id = generateId();

  const entry = {
    id,
    type: 'metalpart',
    materialGrade,
    state: options.state || 'arriving',
    temperature: options.temperature || 25,
    location: options.location || null,

    dimensions: {
      length: dimensions.length || 0,
      width: dimensions.width || 0,
      height: dimensions.height || 0,
    },
    weight,

    // Original dimensions (for tracking deformation during forging)
    originalDimensions: {
      length: dimensions.length || 0,
      width: dimensions.width || 0,
      height: dimensions.height || 0,
    },

    orderID: options.orderID || null,

    // Audit trail — every state transition is logged
    history: [],

    mesh: null,
    createdAt: Date.now(),
  };

  // Log the initial state
  entry.history.push({
    state: entry.state,
    location: entry.location,
    time: 0,
    temp: entry.temperature,
  });

  registry.set(id, entry);
  return entry;
}

/**
 * Register a product with a specific ID (for loading saved state).
 */
export function registerWithId(id, materialGrade, dimensions, weight, options = {}) {
  if (registry.has(id)) {
    console.warn('product_registry: ID "' + id + '" already registered');
    return null;
  }

  const numStr = id.replace(TYPE_PREFIX + '-', '');
  const num = parseInt(numStr, 10);
  if (!isNaN(num) && num >= nextNumber) {
    nextNumber = num + 1;
  }

  const entry = {
    id,
    type: 'metalpart',
    materialGrade,
    state: options.state || 'arriving',
    temperature: options.temperature || 25,
    location: options.location || null,
    dimensions: {
      length: dimensions.length || 0,
      width: dimensions.width || 0,
      height: dimensions.height || 0,
    },
    weight,
    originalDimensions: {
      length: dimensions.length || 0,
      width: dimensions.width || 0,
      height: dimensions.height || 0,
    },
    orderID: options.orderID || null,
    history: options.history || [],
    mesh: null,
    createdAt: Date.now(),
  };

  registry.set(id, entry);
  return entry;
}

/**
 * Remove a product from the registry.
 */
export function unregister(id) {
  if (!registry.has(id)) {
    console.warn('product_registry: cannot unregister unknown ID "' + id + '"');
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

/**
 * Get all products in a specific lifecycle state.
 */
export function getByState(state) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.state === state) results.push(entry);
  }
  return results;
}

/**
 * Get all products at a specific location.
 * @param {string} locationId - Equipment ID, rack ID, truck ID, or 'in_transit'
 */
export function getByLocation(locationId) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.location === locationId) results.push(entry);
  }
  return results;
}

/**
 * Get all products belonging to a production order.
 */
export function getByOrder(orderId) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.orderID === orderId) results.push(entry);
  }
  return results;
}

export function getAll() {
  return Array.from(registry.values());
}

export function has(id) {
  return registry.has(id);
}

// ---------------------------------------------------------------------------
// State Transitions
// ---------------------------------------------------------------------------

/**
 * Transition a product to a new lifecycle state.
 * Logs the transition to history for audit trail.
 *
 * @param {string} id - Product ID
 * @param {string} newState - Target lifecycle state
 * @param {number} timestamp - Simulation time (from worldclock)
 */
export function updateState(id, newState, timestamp) {
  const entry = registry.get(id);
  if (!entry) {
    console.warn('product_registry: cannot update state of unknown ID "' + id + '"');
    return false;
  }

  if (!VALID_STATES.has(newState)) {
    console.warn('product_registry: invalid state "' + newState + '"');
    return false;
  }

  const oldState = entry.state;
  entry.state = newState;

  entry.history.push({
    state: newState,
    from: oldState,
    location: entry.location,
    time: timestamp,
    temp: entry.temperature,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Property Updates
// ---------------------------------------------------------------------------

/**
 * Update the product's current location.
 */
export function updateLocation(id, newLocationId) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.location = newLocationId;
  return true;
}

/**
 * Update the product's temperature (Celsius).
 */
export function updateTemperature(id, newTemp) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.temperature = newTemp;
  return true;
}

/**
 * Update dimensions (after forging deformation).
 */
export function updateDimensions(id, newDimensions) {
  const entry = registry.get(id);
  if (!entry) return false;
  Object.assign(entry.dimensions, newDimensions);
  return true;
}

export function setMesh(id, mesh) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.mesh = mesh;
  return true;
}

export function setOrderID(id, orderId) {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.orderID = orderId;
  return true;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Get the full audit trail for a product.
 */
export function getHistory(id) {
  const entry = registry.get(id);
  if (!entry) return [];
  return entry.history;
}

/**
 * Get the time a product spent in a specific state (from history).
 */
export function getTimeInState(id, state) {
  const entry = registry.get(id);
  if (!entry) return 0;

  let total = 0;
  const hist = entry.history;

  for (let i = 0; i < hist.length; i++) {
    if (hist[i].state === state) {
      const endTime = (i + 1 < hist.length) ? hist[i + 1].time : hist[i].time;
      total += endTime - hist[i].time;
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// Counting and Filtering
// ---------------------------------------------------------------------------

export function count() {
  return registry.size;
}

export function countByState(state) {
  let n = 0;
  for (const entry of registry.values()) {
    if (entry.state === state) n++;
  }
  return n;
}

/**
 * Count active products (not departed and not scrapped).
 */
export function countActive() {
  let n = 0;
  for (const entry of registry.values()) {
    if (entry.state !== 'departed' && entry.state !== 'scrapped') n++;
  }
  return n;
}

/**
 * Get all active products (not departed and not scrapped).
 */
export function getActive() {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.state !== 'departed' && entry.state !== 'scrapped') {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Get products currently at elevated temperature.
 * @param {number} [threshold=100] - Celsius
 */
export function getHot(threshold = 100) {
  const results = [];
  for (const entry of registry.values()) {
    if (entry.temperature > threshold) results.push(entry);
  }
  return results;
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
      dimensions: { ...entry.dimensions },
      originalDimensions: { ...entry.originalDimensions },
      history: entry.history.map(function(h) { return { ...h }; }),
      mesh: null,
    });
  }
  return {
    entries: entries,
    nextNumber: nextNumber,
  };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot || !snapshot.entries) {
    console.warn('product_registry: invalid snapshot');
    return;
  }

  registry.clear();
  for (const entry of snapshot.entries) {
    registry.set(entry.id, {
      ...entry,
      dimensions: { ...entry.dimensions },
      originalDimensions: { ...entry.originalDimensions },
      history: entry.history.map(function(h) { return { ...h }; }),
    });
  }

  nextNumber = snapshot.nextNumber;
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export function clear() {
  registry.clear();
  nextNumber = 1;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function isValidState(state) {
  return VALID_STATES.has(state);
}

export function getStateColor(state) {
  return STATE_COLORS[state] || '#ffffff';
}

export function getTypePrefix() {
  return TYPE_PREFIX;
}