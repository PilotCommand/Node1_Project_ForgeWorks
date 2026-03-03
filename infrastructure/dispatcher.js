// ============================================================================
// dispatcher.js — Who Goes Where
// Forgeworks · Foundation · Tier 1
// ============================================================================
// The decision brain. Scans product states, finds idle vehicles, picks
// destinations, plans routes via gridsquare's pathfinding, and issues task
// assignments to the registries. forgehousechanger then executes the
// resulting movement each frame.
//
// Owns:
//   - Dispatch cycle: scanning products and assigning transport tasks
//   - Task completion: handling vehicle arrival (pickup/deliver transitions)
//   - Product delivery: loading into furnaces, starting press cycles, etc.
//   - Order submission: creating products, triggering truck arrivals
//   - Finding idle vehicles, available equipment, racks with room
//   - Location resolution: converting registry IDs to grid positions
//
// Does NOT own:
//   - Moving meshes (that's forgehousechanger.js)
//   - Equipment state math (that's the equipment files)
//   - Grid data or pathfinding algorithm (that's gridsquare.js)
//   - Mesh creation (that's forgehousebuilder.js)
//
// Imports: gridsquare (pathfinding), registries, equipment files (load/unload),
//          worldclock (timestamps), builder (spawn products/trucks)
// Exports: run(), processVehicleTasks(), submitOrder()
// ============================================================================

// Spatial — pathfinding
import { findPath } from './gridsquare.js';

// Builder — spawning new products and trucks
import {
  spawnMetalPart,
  spawnTruck,
  showMesh,
} from './forgehousebuilder.js';

// Changer — product positioning after delivery
import {
  positionProductAtEquipment,
} from './forgehousechanger.js';

// Registries
import * as staticRegistry from '../static_equipment/static_registry.js';
import * as mobileRegistry from '../mobile_equipment/mobile_registry.js';
import * as productRegistry from '../production_entities/product_registry.js';

// Equipment files — loading/unloading/state queries only
import * as furnace from '../static_equipment/static_furnace.js';
import * as press from '../static_equipment/static_press.js';
import * as hammer from '../static_equipment/static_hammer.js';
import * as quench from '../static_equipment/static_quench.js';
import * as racks from '../static_equipment/static_racks.js';

// Mobile equipment — route assignment, pickup/putdown
import * as forklift from '../mobile_equipment/mobile_forklift.js';
import * as manipulator from '../mobile_equipment/mobile_manipulator.js';
import * as trucks from '../mobile_equipment/mobile_trucks.js';

// Product behavior — temperature checks
import * as metalpart from '../production_entities/product_metalpart.js';

// World clock — timestamps for state transitions
import * as worldclock from './worldclock.js';


// ---------------------------------------------------------------------------
// Dispatch Configuration
// ---------------------------------------------------------------------------

var DISPATCH_INTERVAL = 0.5;  // seconds between dispatch scans
var dispatchCooldown = 0;


// ============================================================================
// MAIN DISPATCH ENTRY POINT
// ============================================================================

/**
 * Called each frame from mainlogic. Decrements cooldown and runs a dispatch
 * cycle when ready. Also processes vehicle task completions every frame.
 *
 * @param {number} delta - Simulation time delta in seconds
 */
export function update(delta) {
  // Process task completions every frame (vehicle arrived and needs to load/unload)
  processVehicleTasks();

  // Run dispatch on cooldown
  dispatchCooldown -= delta;
  if (dispatchCooldown <= 0) {
    dispatchCooldown = DISPATCH_INTERVAL;
    runDispatch();
  }
}

/**
 * Run a single dispatch cycle. Scans all products and assigns idle vehicles
 * to move them through the production lifecycle.
 *
 * Phase 1 hardcoded sequence:
 *   truck → raw_stored → heating → forging → quenching → finished_stored → truck
 *
 * Phase 2 will replace this with process route reading from production orders.
 */
function runDispatch() {
  // 1. Unload inbound trucks
  dispatchTruckUnloading();

  // 2. Move raw_stored products to furnaces
  dispatchToFurnace();

  // 3. Move heated products to presses
  dispatchToPress();

  // 4. Move forged products to quench tanks
  dispatchToQuench();

  // 5. Move cooled products to finished storage
  dispatchToFinishedStorage();

  // 6. Load outbound trucks
  dispatchToOutboundTruck();
}


// ============================================================================
// DISPATCH STEPS
// ============================================================================

// ---------------------------------------------------------------------------
// Step 1: Unload inbound trucks → raw storage racks
// ---------------------------------------------------------------------------

function dispatchTruckUnloading() {
  var dockedTrucks = mobileRegistry.getByType('truck');
  for (var t = 0; t < dockedTrucks.length; t++) {
    var tk = dockedTrucks[t];
    if (tk.specs.direction !== 'inbound' || tk.specs.state !== 'docked') continue;
    if (trucks.getManifestCount(tk.id) === 0) continue;

    // Find idle forklift
    var fk = findIdleForklift();
    if (!fk) return;

    // Find raw storage rack with room
    var rackId = findRackWithRoom('raw_material');
    if (!rackId) return;

    // Route forklift to truck (approach from front)
    var truckPos = { x: tk.gridX, z: tk.gridZ + 2 };
    var path = findPath(fk.gridX, fk.gridZ, truckPos.x, truckPos.z, 'forklift');
    if (!path) continue;

    mobileRegistry.assignTask(fk.id, {
      action: 'pickup',
      fromId: tk.id,
      toId: rackId,
      productId: null,
    });
    forklift.assignRoute(fk.id, path);
    return; // one assignment per dispatch cycle
  }
}

// ---------------------------------------------------------------------------
// Step 2: Move raw_stored / queued products → furnace
// ---------------------------------------------------------------------------

function dispatchToFurnace() {
  var rawProducts = productRegistry.getByState('raw_stored');
  var queuedProducts = productRegistry.getByState('queued');
  var candidates = rawProducts.concat(queuedProducts);
  if (candidates.length === 0) return;

  // Find a furnace with room (prefer one at target temp)
  var fnId = findFurnaceWithRoom();
  if (!fnId) return;

  var fnEntry = staticRegistry.get(fnId);
  if (!fnEntry) return;

  // Choose vehicle type based on product temperature
  var product = candidates[0];
  var vehicle;
  var vehicleType;

  if (product.temperature > 100) {
    vehicle = findIdleManipulator();
    vehicleType = 'manipulator';
  } else {
    vehicle = findIdleForklift();
    vehicleType = 'forklift';
  }
  if (!vehicle) return;

  // Route vehicle to product location
  var productLoc = getLocationGridPos(product.location);
  if (!productLoc) return;

  var path = findPath(vehicle.gridX, vehicle.gridZ, productLoc.x, productLoc.z, vehicleType);
  if (!path) return;

  productRegistry.updateState(product.id, 'transport_heat', worldclock.getTime());
  productRegistry.updateLocation(product.id, 'in_transit');

  mobileRegistry.assignTask(vehicle.id, {
    action: 'pickup',
    fromId: product.location,
    toId: fnId,
    productId: product.id,
  });

  if (vehicleType === 'forklift') {
    forklift.assignRoute(vehicle.id, path);
  } else {
    manipulator.assignRoute(vehicle.id, path);
  }
}

// ---------------------------------------------------------------------------
// Step 3: Move heated products → press (or hammer)
// ---------------------------------------------------------------------------

function dispatchToPress() {
  // Find products in furnaces that reached target temp
  var heatingProducts = productRegistry.getByState('heating');
  var readyProduct = null;

  for (var i = 0; i < heatingProducts.length; i++) {
    var p = heatingProducts[i];
    var fnEntry = staticRegistry.get(p.location);
    if (!fnEntry || fnEntry.type !== 'furnace') continue;

    if (metalpart.hasReachedTemp(p.id, fnEntry.specs.targetTemp, 20)) {
      readyProduct = p;
      break;
    }
  }
  if (!readyProduct) return;

  // Find idle press (or hammer as fallback)
  var prId = findIdlePress();
  if (!prId) {
    prId = findIdleHammer();
    if (!prId) return;
  }

  // Must use manipulator for hot parts
  var mn = findIdleManipulator();
  if (!mn) return;

  var fnPos = getLocationGridPos(readyProduct.location);
  if (!fnPos) return;

  var path = findPath(mn.gridX, mn.gridZ, fnPos.x, fnPos.z, 'manipulator');
  if (!path) return;

  // Unload from furnace
  furnace.unloadProduct(readyProduct.location, readyProduct.id);
  productRegistry.updateState(readyProduct.id, 'transport_forge', worldclock.getTime());
  productRegistry.updateLocation(readyProduct.id, 'in_transit');

  mobileRegistry.assignTask(mn.id, {
    action: 'pickup',
    fromId: readyProduct.location,
    toId: prId,
    productId: readyProduct.id,
  });
  manipulator.assignRoute(mn.id, path);
}

// ---------------------------------------------------------------------------
// Step 4: Move forged products → quench tank
// ---------------------------------------------------------------------------

function dispatchToQuench() {
  var transportQuench = productRegistry.getByState('transport_quench');
  if (transportQuench.length === 0) return;

  var product = transportQuench[0];

  // Find quench tank with room
  var qtId = findQuenchWithRoom();
  if (!qtId) return;

  var qtEntry = staticRegistry.get(qtId);
  if (!qtEntry) return;

  // Must use manipulator for hot parts
  var mn = findIdleManipulator();
  if (!mn) return;

  var path = findPath(mn.gridX, mn.gridZ, qtEntry.gridX, qtEntry.gridZ, 'manipulator');
  if (!path) return;

  mobileRegistry.assignTask(mn.id, {
    action: 'deliver',
    fromId: null,
    toId: qtId,
    productId: product.id,
  });
  manipulator.assignRoute(mn.id, path);
}

// ---------------------------------------------------------------------------
// Step 5: Move cooled products → finished storage racks
// ---------------------------------------------------------------------------

function dispatchToFinishedStorage() {
  var coolingProducts = productRegistry.getByState('cooling');
  var candidates = [];
  for (var i = 0; i < coolingProducts.length; i++) {
    if (coolingProducts[i].temperature < 80) {
      candidates.push(coolingProducts[i]);
    }
  }
  if (candidates.length === 0) return;

  var product = candidates[0];

  var rackId = findRackWithRoom('finished_goods');
  if (!rackId) return;

  var fk = findIdleForklift();
  if (!fk) return;

  var productPos = getLocationGridPos(product.location);
  if (!productPos) return;

  var path = findPath(fk.gridX, fk.gridZ, productPos.x, productPos.z, 'forklift');
  if (!path) return;

  productRegistry.updateState(product.id, 'transport_store', worldclock.getTime());
  productRegistry.updateLocation(product.id, 'in_transit');

  mobileRegistry.assignTask(fk.id, {
    action: 'pickup',
    fromId: product.location,
    toId: rackId,
    productId: product.id,
  });
  forklift.assignRoute(fk.id, path);
}

// ---------------------------------------------------------------------------
// Step 6: Load finished products → outbound truck
// ---------------------------------------------------------------------------

function dispatchToOutboundTruck() {
  var finishedProducts = productRegistry.getByState('finished_stored');
  if (finishedProducts.length === 0) return;

  // Find docked outbound truck
  var outTrucks = mobileRegistry.getByType('truck');
  var outTruck = null;
  for (var t = 0; t < outTrucks.length; t++) {
    if (outTrucks[t].specs.direction === 'outbound' && outTrucks[t].specs.state === 'docked') {
      outTruck = outTrucks[t];
      break;
    }
  }
  if (!outTruck) return;

  var product = finishedProducts[0];
  var fk = findIdleForklift();
  if (!fk) return;

  var productPos = getLocationGridPos(product.location);
  if (!productPos) return;

  var path = findPath(fk.gridX, fk.gridZ, productPos.x, productPos.z, 'forklift');
  if (!path) return;

  productRegistry.updateState(product.id, 'loading', worldclock.getTime());
  productRegistry.updateLocation(product.id, 'in_transit');

  mobileRegistry.assignTask(fk.id, {
    action: 'pickup',
    fromId: product.location,
    toId: outTruck.id,
    productId: product.id,
  });
  forklift.assignRoute(fk.id, path);
}


// ============================================================================
// TASK COMPLETION — Vehicle arrived, now load/unload
// ============================================================================
// Called every frame. Checks all vehicles for 'loading'/'unloading'/
// 'gripping'/'releasing' states and completes the handoff.

function processVehicleTasks() {
  var allMobile = mobileRegistry.getAll();

  for (var i = 0; i < allMobile.length; i++) {
    var vehicle = allMobile[i];
    var task = vehicle.currentTask;
    if (!task) continue;

    if (vehicle.type === 'forklift') {
      processForkliftTask(vehicle, task);
    } else if (vehicle.type === 'manipulator') {
      processManipulatorTask(vehicle, task);
    }
  }
}


// ---------------------------------------------------------------------------
// Forklift task processing
// ---------------------------------------------------------------------------

function processForkliftTask(vehicle, task) {
  var specs = vehicle.specs;

  if (specs.state === 'loading' && task.action === 'pickup') {
    // At pickup location — pick up the product
    var productId = task.productId;

    // If picking up from truck, unload from truck manifest
    if (task.fromId && trucks.isDocked(task.fromId)) {
      productId = trucks.unloadNext(task.fromId);
      if (productId) {
        task.productId = productId;
      }
    }

    if (productId) {
      var product = productRegistry.get(productId);
      if (product) {
        forklift.pickUp(vehicle.id, productId, product.weight);
        productRegistry.updateLocation(productId, vehicle.id);

        // Now route to destination
        var destPos = getLocationGridPos(task.toId);
        if (destPos) {
          var path = findPath(vehicle.gridX, vehicle.gridZ, destPos.x, destPos.z, 'forklift');
          if (path) {
            task.action = 'deliver';
            forklift.assignRoute(vehicle.id, path);
          }
        }
      }
    }

  } else if (specs.state === 'unloading' && task.action === 'deliver') {
    // At delivery location — put down the product
    var droppedId = forklift.putDown(vehicle.id);
    if (droppedId) {
      var destEntry = staticRegistry.get(task.toId) || mobileRegistry.get(task.toId);
      if (destEntry) {
        deliverProduct(droppedId, task.toId, destEntry);
      }
    }
    mobileRegistry.clearTask(vehicle.id);
  }
}


// ---------------------------------------------------------------------------
// Manipulator task processing
// ---------------------------------------------------------------------------

function processManipulatorTask(vehicle, task) {
  var specs = vehicle.specs;

  if (specs.state === 'gripping' && task.action === 'pickup') {
    var productId = task.productId;
    var product = productRegistry.get(productId);
    if (product) {
      manipulator.grip(vehicle.id, productId, product.weight, product.temperature);
      productRegistry.updateLocation(productId, vehicle.id);

      var destPos = getLocationGridPos(task.toId);
      if (destPos) {
        var path = findPath(vehicle.gridX, vehicle.gridZ, destPos.x, destPos.z, 'manipulator');
        if (path) {
          task.action = 'deliver';
          manipulator.assignRoute(vehicle.id, path);
        }
      }
    }

  } else if (specs.state === 'releasing' && task.action === 'deliver') {
    var releasedId = manipulator.release(vehicle.id);
    if (releasedId) {
      var destEntry = staticRegistry.get(task.toId) || mobileRegistry.get(task.toId);
      if (destEntry) {
        deliverProduct(releasedId, task.toId, destEntry);
      }
    }
    mobileRegistry.clearTask(vehicle.id);
  }
}


// ============================================================================
// PRODUCT DELIVERY — Place product at destination, update state
// ============================================================================

/**
 * Hand off a product to its destination equipment/rack/truck.
 * Updates product state and calls the appropriate equipment load function.
 *
 * @param {string} productId
 * @param {string} destId - Destination equipment/rack/truck registry ID
 * @param {object} destEntry - The registry entry for the destination
 */
function deliverProduct(productId, destId, destEntry) {
  productRegistry.updateLocation(productId, destId);

  if (destEntry.type === 'furnace') {
    furnace.loadProduct(destId, productId);
    productRegistry.updateState(productId, 'heating', worldclock.getTime());

    // Position product inside furnace
    positionProductAtEquipment(productId, destEntry.gridX, destEntry.gridZ,
      destEntry.gridWidth, destEntry.gridDepth, 0.5);

  } else if (destEntry.type === 'press') {
    press.startCycle(destId, productId);
    productRegistry.updateState(productId, 'forging', worldclock.getTime());

    positionProductAtEquipment(productId, destEntry.gridX, destEntry.gridZ,
      destEntry.gridWidth, destEntry.gridDepth, 1.0);

  } else if (destEntry.type === 'hammer') {
    hammer.startStriking(destId, productId, 30);
    productRegistry.updateState(productId, 'forging', worldclock.getTime());

    positionProductAtEquipment(productId, destEntry.gridX, destEntry.gridZ,
      destEntry.gridWidth, destEntry.gridDepth, 1.0);

  } else if (destEntry.type === 'quench') {
    quench.quenchProduct(destId, productId);
    productRegistry.updateState(productId, 'quenching', worldclock.getTime());

    positionProductAtEquipment(productId, destEntry.gridX, destEntry.gridZ,
      destEntry.gridWidth, destEntry.gridDepth, 0.3);

  } else if (destEntry.type === 'rack') {
    var product = productRegistry.get(productId);
    racks.storeItem(destId, productId, product ? product.weight : 0);
    var rackType = racks.getRackType(destId);
    if (rackType === 'raw_material') {
      productRegistry.updateState(productId, 'raw_stored', worldclock.getTime());
    } else if (rackType === 'finished_goods') {
      productRegistry.updateState(productId, 'finished_stored', worldclock.getTime());
    }

    positionProductAtEquipment(productId, destEntry.gridX, destEntry.gridZ,
      destEntry.gridWidth, destEntry.gridDepth, 0.5);

  } else if (destEntry.type === 'truck') {
    var product = productRegistry.get(productId);
    trucks.loadItem(destId, productId, product ? product.weight : 0);
    productRegistry.updateState(productId, 'loading', worldclock.getTime());
  }
}


// ============================================================================
// DISPATCH HELPERS — Find idle vehicles, available equipment, etc.
// ============================================================================

function findIdleForklift() {
  var idle = mobileRegistry.getIdle('forklift');
  return idle.length > 0 ? idle[0] : null;
}

function findIdleManipulator() {
  var idle = mobileRegistry.getIdle('manipulator');
  return idle.length > 0 ? idle[0] : null;
}

function findFurnaceWithRoom() {
  var furnaces = staticRegistry.getByType('furnace');
  // Prefer furnaces at target temp
  for (var i = 0; i < furnaces.length; i++) {
    var fn = furnaces[i];
    if (furnace.hasRoom(fn.id) && furnace.isAtTarget(fn.id)) {
      return fn.id;
    }
  }
  // Fallback: any furnace with room (even if still heating)
  for (var i = 0; i < furnaces.length; i++) {
    if (furnace.hasRoom(furnaces[i].id)) return furnaces[i].id;
  }
  return null;
}

function findIdlePress() {
  var presses = staticRegistry.getByType('press');
  for (var i = 0; i < presses.length; i++) {
    if (press.isIdle(presses[i].id)) return presses[i].id;
  }
  return null;
}

function findIdleHammer() {
  var hammers = staticRegistry.getByType('hammer');
  for (var i = 0; i < hammers.length; i++) {
    if (hammer.isIdle(hammers[i].id)) return hammers[i].id;
  }
  return null;
}

function findQuenchWithRoom() {
  var tanks = staticRegistry.getByType('quench');
  for (var i = 0; i < tanks.length; i++) {
    if (quench.hasRoom(tanks[i].id)) return tanks[i].id;
  }
  return null;
}

function findRackWithRoom(rackType) {
  var allRacks = staticRegistry.getByType('rack');
  for (var i = 0; i < allRacks.length; i++) {
    var rk = allRacks[i];
    if (rk.specs.rackType === rackType && racks.hasRoom(rk.id, 100)) {
      return rk.id;
    }
  }
  return null;
}


// ============================================================================
// LOCATION RESOLUTION — Convert registry IDs to grid positions
// ============================================================================

/**
 * Get the grid position of a location (equipment, rack, truck, or vehicle).
 * Returns the center cell of the item's footprint.
 *
 * @param {string} locationId - Registry ID
 * @returns {{x: number, z: number}|null}
 */
export function getLocationGridPos(locationId) {
  if (!locationId || locationId === 'in_transit') return null;

  var staticEntry = staticRegistry.get(locationId);
  if (staticEntry) {
    return {
      x: staticEntry.gridX + Math.floor(staticEntry.gridWidth / 2),
      z: staticEntry.gridZ + Math.floor(staticEntry.gridDepth / 2),
    };
  }

  var mobileEntry = mobileRegistry.get(locationId);
  if (mobileEntry) {
    return { x: mobileEntry.gridX, z: mobileEntry.gridZ };
  }

  return null;
}


// ============================================================================
// ORDER SUBMISSION
// ============================================================================

/**
 * Submit a production order. Creates products, triggers truck arrivals,
 * and returns the product IDs.
 *
 * Phase 1: simple order config with material grade, quantity, dimensions.
 * Phase 2: will accept full process routes and scheduling.
 *
 * @param {object} orderConfig
 *   - materialGrade: string (e.g. '4140')
 *   - quantity: number
 *   - weight: number (per piece, kg)
 *   - dimensions: { length, width, height } in meters
 * @returns {Array<string>} Product IDs created
 */
export function submitOrder(orderConfig) {
  var productIds = [];

  // Create products
  for (var i = 0; i < orderConfig.quantity; i++) {
    var dims = orderConfig.dimensions || { length: 0.5, width: 0.15, height: 0.15 };
    var wt = orderConfig.weight || 45;

    var part = metalpart.createMetalPart(
      orderConfig.materialGrade,
      dims,
      wt,
      { state: 'arriving' }
    );

    // Spawn the mesh via builder
    var mesh = spawnMetalPart(part.id, part.dimensions, false);
    part.mesh = mesh;

    productIds.push(part.id);
  }

  // Trigger inbound truck arrival
  var inboundTrucks = mobileRegistry.getByType('truck');
  var inTruck = null;
  for (var t = 0; t < inboundTrucks.length; t++) {
    if (inboundTrucks[t].specs.direction === 'inbound') {
      inTruck = inboundTrucks[t];
      break;
    }
  }

  if (inTruck) {
    trucks.arrive(inTruck.id, 16, 1, productIds);

    // Ensure truck mesh is visible
    if (inTruck.mesh) {
      inTruck.mesh.visible = true;
    } else {
      showMesh(inTruck.id);
    }

    // Set product locations to the truck
    for (var i = 0; i < productIds.length; i++) {
      productRegistry.updateLocation(productIds[i], inTruck.id);
    }
  }

  // Trigger outbound truck docking
  var outTruck = null;
  for (var t = 0; t < inboundTrucks.length; t++) {
    if (inboundTrucks[t].specs.direction === 'outbound') {
      outTruck = inboundTrucks[t];
      break;
    }
  }
  if (outTruck) {
    trucks.arrive(outTruck.id, 41, 1);
    if (outTruck.mesh) {
      outTruck.mesh.visible = true;
    } else {
      showMesh(outTruck.id);
    }
  }

  console.log('dispatcher: order submitted — ' + orderConfig.quantity + 'x ' +
    orderConfig.materialGrade + ' (' + productIds.length + ' products created)');

  return productIds;
}


// ============================================================================
// SIMULATION RESULTS (Phase 1 stub)
// ============================================================================

/**
 * Get basic simulation progress statistics.
 * Phase 2 will add timeline, bottleneck analysis, cost estimation.
 *
 * @returns {object}
 */
export function getSimulationResults() {
  var allProducts = productRegistry.getAll();
  var departed = productRegistry.getByState('departed');
  var active = productRegistry.countActive();

  return {
    totalProducts: allProducts.length,
    departedProducts: departed.length,
    activeProducts: active,
    simulationTime: worldclock.getTime(),
    status: active === 0 && departed.length > 0 ? 'completed' : 'in_progress',
  };
}


// ============================================================================
// RESET
// ============================================================================

/**
 * Reset dispatch cooldown (call after mode change or snapshot restore).
 */
export function reset() {
  dispatchCooldown = 0;
}