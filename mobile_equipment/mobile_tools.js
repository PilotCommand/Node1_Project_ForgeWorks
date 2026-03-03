// ============================================================================
// mobile_tools.js — Mobile Tooling and Dies
// Forgeworks Mobile Equipment Tier 5
// ============================================================================
// Defines tooling that moves between storage racks and equipment: forging
// dies, disc tools, cutting tools, fixtures. Stored on racks, transported
// by manipulators or forklifts to presses and hammers.
//
// Tracks tool type, dimensions, material compatibility, wear state, and
// current location. Important for production scheduling.
//
// Mesh building handled by forgehousebuilder.js.
//
// Imports: worldclock.js, measurementunits.js, mobile_registry.js
// Exports: Tool creation, update, install/remove, wear tracking
// ============================================================================

import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './mobile_registry.js';

const DEFAULT_SPECS = {
  toolType: 'die',             // die, disc, cutter, fixture
  dimensions: { width: 0.3, depth: 0.3, height: 0.2 },
  weight: 150,                 // kg
  material: 'H13',            // tool steel grade
  compatibleEquipment: ['press', 'hammer'],
  wearState: 1.0,             // 1.0 = new, 0.0 = worn out
  wearRate: 0.001,            // wear per use
  wornOutThreshold: 0.1,      // below this = needs replacement
  location: null,              // rack ID, equipment ID, or 'in_transit'
  installedOn: null,           // equipment ID if installed
  state: 'stored',            // stored, in_transit, installed, worn_out
  useCount: 0,
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createTool(name, toolType, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  specs.toolType = toolType || 'die';
  if (specOverrides) {
    Object.assign(specs, specOverrides);
    if (specOverrides.dimensions) {
      specs.dimensions = Object.assign({}, DEFAULT_SPECS.dimensions, specOverrides.dimensions);
    }
    if (specOverrides.compatibleEquipment) {
      specs.compatibleEquipment = specOverrides.compatibleEquipment.slice();
    }
  }

  var entry = registry.register('tool', name, gridX, gridZ, 1, 1, specs);

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateTool(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'tool') return;

  // Check if worn out
  if (entry.specs.wearState <= entry.specs.wornOutThreshold && entry.specs.state !== 'worn_out') {
    entry.specs.state = 'worn_out';
    registry.updateStatus(id, 'maintenance');
  }
}

// ---------------------------------------------------------------------------
// Install / Remove
// ---------------------------------------------------------------------------

/**
 * Install this tool on a piece of equipment (press or hammer).
 */
export function installOnEquipment(id, equipmentId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'tool') return false;

  if (entry.specs.state === 'worn_out') {
    console.warn('mobile_tools: tool ' + id + ' is worn out');
    return false;
  }

  entry.specs.installedOn = equipmentId;
  entry.specs.location = equipmentId;
  entry.specs.state = 'installed';
  registry.updateStatus(id, 'active');
  return true;
}

/**
 * Remove this tool from equipment.
 */
export function removeFromEquipment(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'tool') return false;

  entry.specs.installedOn = null;
  entry.specs.state = 'in_transit';
  return true;
}

/**
 * Record a use of this tool (called when press/hammer completes a cycle).
 * Decreases wear state.
 */
export function recordUse(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'tool') return false;

  entry.specs.useCount++;
  entry.specs.wearState -= entry.specs.wearRate;
  if (entry.specs.wearState < 0) entry.specs.wearState = 0;

  if (entry.specs.wearState <= entry.specs.wornOutThreshold) {
    entry.specs.state = 'worn_out';
    registry.updateStatus(id, 'maintenance');
  }

  return true;
}

/**
 * Refurbish/replace a tool (reset wear).
 */
export function refurbish(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'tool') return false;

  entry.specs.wearState = 1.0;
  entry.specs.useCount = 0;
  entry.specs.state = 'stored';
  registry.updateStatus(id, 'idle');
  return true;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}

export function getWearState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.wearState : 0;
}

export function isWornOut(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.wearState <= entry.specs.wornOutThreshold : true;
}

export function isInstalled(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state === 'installed' : false;
}

export function getInstalledOn(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.installedOn : null;
}

export function isCompatibleWith(id, equipmentType) {
  var entry = registry.get(id);
  if (!entry) return false;
  return entry.specs.compatibleEquipment.indexOf(equipmentType) !== -1;
}

export function setLocation(id, locationId) {
  var entry = registry.get(id);
  if (!entry) return false;
  entry.specs.location = locationId;
  return true;
}