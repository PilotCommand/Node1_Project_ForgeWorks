// ============================================================================
// mainlogic.js — System Orchestrator
// Forgeworks Infrastructure Tier 7
// ============================================================================
// The central coordinator of the entire application. Initializes all
// subsystems on startup, runs the main update loop (driven by worldclock
// ticks), manages mode switching, and routes events between systems.
//
// Contains high-level control flow — not complex math or rendering code.
// Think of it as the conductor of an orchestra: it tells each section
// when to play, but it does not play the instruments.
//
// This is the ONLY file that imports broadly across all categories.
// It sits at the top of the dependency tree.
//
// Imports: Everything.
// Exports: init(), main loop, mode state, dispatch, order submission
// ============================================================================

// --- Infrastructure ---
import * as worldclock from './worldclock.js';
import * as measurementunits from './measurementunits.js';
import * as controls from './controls.js';
import * as visualhud from './visualhud.js';
import * as floorplan from './floorplan.js';
import * as powerutilities from './powerutilities.js';
import * as randnumerics from './randnumerics.js';

// --- Registries ---
import * as staticRegistry from '../static_equipment/static_registry.js';
import * as mobileRegistry from '../mobile_equipment/mobile_registry.js';
import * as productRegistry from '../production_entities/product_registry.js';

// --- Static Equipment ---
import * as furnace from '../static_equipment/static_furnace.js';
import * as press from '../static_equipment/static_press.js';
import * as hammer from '../static_equipment/static_hammer.js';
import * as quench from '../static_equipment/static_quench.js';
import * as racks from '../static_equipment/static_racks.js';

// --- Mobile Equipment ---
import * as forklift from '../mobile_equipment/mobile_forklift.js';
import * as manipulator from '../mobile_equipment/mobile_manipulator.js';
import * as trucks from '../mobile_equipment/mobile_trucks.js';
import * as tools from '../mobile_equipment/mobile_tools.js';

// --- Products ---
import * as metalpart from '../production_entities/product_metalpart.js';

// ---------------------------------------------------------------------------
// Application State
// ---------------------------------------------------------------------------

let currentMode = 'sandbox';   // sandbox, prediction, operating
let isInitialized = false;
let isPredictionRunning = false;

// Dispatch cooldowns — prevent spamming assignments every frame
let dispatchCooldown = 0;
const DISPATCH_INTERVAL = 0.5; // check dispatch every 0.5 sim seconds

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the entire Forgeworks application.
 *
 * @param {HTMLElement} container - DOM element to mount the 3D canvas
 * @param {object} [options] - Configuration options:
 *   - layout: 'coulter' or 'empty' (default 'coulter')
 *   - seed: random seed (default 42)
 *   - displaySystem: 'si' or 'imperial' (default 'si')
 */
export function init(container, options) {
  var opts = options || {};

  // 1. Configure infrastructure
  randnumerics.setSeed(opts.seed || 42);
  measurementunits.setDisplaySystem(opts.displaySystem || 'si');

  // 2. Load layout
  var layoutConfig;
  if (opts.layout === 'empty') {
    layoutConfig = floorplan.getEmptyLayout();
  } else {
    layoutConfig = floorplan.getDefaultCoulterLayout();
  }
  floorplan.loadLayout(layoutConfig);

  // 3. Load utilities
  powerutilities.loadUtilities(powerutilities.getDefaultCoulterUtilities());

  // 4. Initialize renderer and HUD
  var gridW = floorplan.getGridWidth();
  var gridD = floorplan.getGridDepth();
  visualhud.initRenderer(container, gridW, gridD);

  // 5. Build and add floor meshes to scene
  var floorMeshes = floorplan.buildAllMeshes();
  for (var i = 0; i < floorMeshes.length; i++) {
    visualhud.addToScene(floorMeshes[i]);
  }

  // 6. Build and add utility meshes
  var utilMeshes = powerutilities.buildUtilityMeshes();
  visualhud.addToScene(utilMeshes);

  // 7. Apply zone painting to the Coulter layout
  if (opts.layout !== 'empty') {
    applyCoulterZones();
  }

  // 8. Place default equipment (Coulter layout)
  if (opts.layout !== 'empty') {
    placeDefaultEquipment();
  }

  // 9. Register event handlers
  setupEventHandlers();

  // 10. Set initial mode
  setMode('sandbox');

  // 11. Start the render loop
  visualhud.startRenderLoop(mainUpdate);

  isInitialized = true;
  console.log('Forgeworks initialized. Grid: ' + gridW + 'x' + gridD + ', Layout: ' + layoutConfig.name);
}

// ---------------------------------------------------------------------------
// Default Coulter Forge Setup
// ---------------------------------------------------------------------------

function applyCoulterZones() {
  // Staging areas near doors
  floorplan.setCellBlock(13, 1, 22, 6, 'zone:staging_inbound');
  floorplan.setCellBlock(38, 1, 47, 6, 'zone:staging_outbound');

  // Heat treatment zone (furnaces and quench tanks)
  floorplan.setCellBlock(2, 10, 20, 35, 'zone:heat_treatment');

  // Heavy machinery zone (presses and hammers)
  floorplan.setCellBlock(25, 10, 45, 35, 'zone:heavy_machinery');

  // Raw material storage
  floorplan.setCellBlock(2, 40, 15, 55, 'zone:storage_raw');

  // Finished goods storage
  floorplan.setCellBlock(40, 40, 57, 55, 'zone:storage_finished');

  // Scrap area
  floorplan.setCellBlock(2, 60, 10, 68, 'zone:storage_scrap');

  // Maintenance
  floorplan.setCellBlock(48, 60, 57, 72, 'zone:maintenance');

  // Office
  floorplan.setCellBlock(48, 73, 57, 77, 'zone:office');

  // Parking
  floorplan.setCellBlock(2, 72, 12, 77, 'zone:parking');

  // Main forklift aisles
  floorplan.setCellBlock(20, 1, 24, 77, 'zone:pathway_forklift');
  floorplan.setCellBlock(1, 36, 58, 39, 'zone:pathway_forklift');
  floorplan.setCellBlock(35, 1, 37, 77, 'zone:pathway_forklift');

  // Personnel walkways
  floorplan.setCellBlock(46, 40, 47, 77, 'zone:pathway_personnel');

  // Rebuild zone overlay meshes after painting
  var oldOverlay = floorplan.getZoneOverlayMeshes();
  for (var i = 0; i < oldOverlay.length; i++) {
    visualhud.removeFromScene(oldOverlay[i]);
  }
  var newOverlay = floorplan.buildZoneOverlayMeshes();
  visualhud.addToScene(newOverlay);
}

function placeDefaultEquipment() {
  // --- Furnaces ---
  var fn1 = furnace.createFurnace('Main Gas Furnace', 4, 12, {
    maxTemp: 1300, heatingRate: 5, fuelType: 'gas', maxContents: 6,
  });
  visualhud.addToScene(fn1.mesh);

  var fn2 = furnace.createFurnace('Electric Box Furnace', 4, 20, {
    maxTemp: 1200, heatingRate: 3, fuelType: 'electric', maxContents: 4,
  });
  visualhud.addToScene(fn2.mesh);

  var fn3 = furnace.createFurnace('Preheat Furnace', 12, 12, {
    maxTemp: 900, heatingRate: 8, fuelType: 'gas', maxContents: 8,
  });
  visualhud.addToScene(fn3.mesh);

  // --- Presses ---
  var pr1 = press.createPress('2000T Hydraulic Press', 27, 12, {
    tonnage: 2000, cycleTime: 8, pressType: 'hydraulic',
  });
  visualhud.addToScene(pr1.mesh);

  var pr2 = press.createPress('800T Mechanical Press', 27, 22, {
    tonnage: 800, cycleTime: 5, pressType: 'mechanical',
  });
  visualhud.addToScene(pr2.mesh);

  // --- Hammers ---
  var hm1 = hammer.createHammer('5kJ Power Hammer', 35, 14, {
    strikeEnergy: 5000, blowRate: 60,
  });
  visualhud.addToScene(hm1.mesh);

  // --- Quench Tanks ---
  var qt1 = quench.createQuenchTank('Oil Quench Tank 1', 12, 28, {
    quenchantType: 'oil', tankVolume: 5000, capacity: 4,
  });
  visualhud.addToScene(qt1.mesh);

  var qt2 = quench.createQuenchTank('Water Quench Tank', 4, 28, {
    quenchantType: 'water', tankVolume: 3000, capacity: 3,
  });
  visualhud.addToScene(qt2.mesh);

  // --- Racks ---
  var rk1 = racks.createRack('Raw Stock Rack A', 4, 42, {
    rackType: 'raw_material', capacityCount: 30, capacityWeight: 8000,
  });
  visualhud.addToScene(rk1.mesh);

  var rk2 = racks.createRack('Raw Stock Rack B', 8, 42, {
    rackType: 'raw_material', capacityCount: 30, capacityWeight: 8000,
  });
  visualhud.addToScene(rk2.mesh);

  var rk3 = racks.createRack('Finished Rack A', 42, 42, {
    rackType: 'finished_goods', capacityCount: 40, capacityWeight: 10000,
  });
  visualhud.addToScene(rk3.mesh);

  var rk4 = racks.createRack('Finished Rack B', 48, 42, {
    rackType: 'finished_goods', capacityCount: 40, capacityWeight: 10000,
  });
  visualhud.addToScene(rk4.mesh);

  var rk5 = racks.createRack('Die Storage', 50, 60, {
    rackType: 'die_storage', capacityCount: 20, capacityWeight: 3000,
  });
  visualhud.addToScene(rk5.mesh);

  var rk6 = racks.createRack('Scrap Bin', 4, 62, {
    rackType: 'scrap', capacityCount: 50, capacityWeight: 15000,
  });
  visualhud.addToScene(rk6.mesh);

  // --- Mobile Equipment ---
  var fk1 = forklift.createForklift('Bay 1 Forklift', 21, 38, { speed: 3 });
  visualhud.addToScene(fk1.mesh);

  var fk2 = forklift.createForklift('Bay 2 Forklift', 23, 38, { speed: 3 });
  visualhud.addToScene(fk2.mesh);

  var mn1 = manipulator.createManipulator('Hot Handler 1', 20, 15, { speed: 2, thermalTolerance: 1200 });
  visualhud.addToScene(mn1.mesh);

  var mn2 = manipulator.createManipulator('Hot Handler 2', 20, 25, { speed: 2, thermalTolerance: 1200 });
  visualhud.addToScene(mn2.mesh);

  // --- Trucks (start absent, will arrive when orders are submitted) ---
  trucks.createTruck('Inbound Truck 1', 'flatbed', 'inbound');
  trucks.createTruck('Outbound Truck 1', 'flatbed', 'outbound');

  // --- Tools ---
  tools.createTool('Shaft Die Set', 'die', 51, 61, {
    weight: 200, compatibleEquipment: ['press', 'hammer'],
  });
  tools.createTool('Flange Die Set', 'die', 52, 61, {
    weight: 180, compatibleEquipment: ['press'],
  });

  // Set furnaces to preheat
  furnace.setTarget(fn1.id, 1100);
  furnace.setTarget(fn3.id, 850);

  console.log('Default equipment placed: ' +
    staticRegistry.count() + ' static, ' +
    mobileRegistry.count() + ' mobile');
}

// ---------------------------------------------------------------------------
// Main Update Loop (called each frame by the render loop)
// ---------------------------------------------------------------------------

function mainUpdate(delta) {
  if (currentMode === 'sandbox') {
    // In sandbox mode, only furnaces update (they preheat)
    updateStaticEquipment(delta);
    updateStatusBar();
    return;
  }

  // --- Prediction and Operating modes: full simulation ---

  // 1. Update static equipment (changes product temps, advances cycles)
  updateStaticEquipment(delta);

  // 2. Update products (ambient cooling, mesh color)
  updateProducts(delta);

  // 3. Update mobile equipment (movement along paths)
  updateMobileEquipment(delta);

  // 4. Handle products inside equipment (heat transfer, forging, quenching)
  processProductsInEquipment(delta);

  // 5. Dispatch (assign tasks to idle vehicles)
  dispatchCooldown -= delta;
  if (dispatchCooldown <= 0) {
    dispatchCooldown = DISPATCH_INTERVAL;
    runDispatch();
  }

  // 6. Update HUD
  updateStatusBar();
  visualhud.showProductTracker(productRegistry.getActive());
}

// ---------------------------------------------------------------------------
// Equipment Updates
// ---------------------------------------------------------------------------

function updateStaticEquipment(delta) {
  var allStatic = staticRegistry.getAll();
  for (var i = 0; i < allStatic.length; i++) {
    var entry = allStatic[i];
    switch (entry.type) {
      case 'furnace':  furnace.updateFurnace(entry.id, delta); break;
      case 'press':    press.updatePress(entry.id, delta); break;
      case 'hammer':   hammer.updateHammer(entry.id, delta); break;
      case 'quench':   quench.updateQuenchTank(entry.id, delta); break;
      // racks don't need per-tick updates
    }
  }
}

function updateProducts(delta) {
  var allProducts = productRegistry.getAll();
  for (var i = 0; i < allProducts.length; i++) {
    metalpart.updateMetalPart(allProducts[i].id, delta);
  }
}

function updateMobileEquipment(delta) {
  var allMobile = mobileRegistry.getAll();
  for (var i = 0; i < allMobile.length; i++) {
    var entry = allMobile[i];
    switch (entry.type) {
      case 'forklift':     forklift.updateForklift(entry.id, delta); break;
      case 'manipulator':  manipulator.updateManipulator(entry.id, delta); break;
      case 'truck':        trucks.updateTruck(entry.id, delta); break;
      case 'tool':         tools.updateTool(entry.id, delta); break;
    }
  }
}

// ---------------------------------------------------------------------------
// Process Products Inside Equipment
// ---------------------------------------------------------------------------

function processProductsInEquipment(delta) {
  // --- Furnaces: heat products inside ---
  var allFurnaces = staticRegistry.getByType('furnace');
  for (var f = 0; f < allFurnaces.length; f++) {
    var fn = allFurnaces[f];
    var contents = furnace.getContents(fn.id);
    var fnTemp = furnace.getCurrentTemp(fn.id);
    for (var p = 0; p < contents.length; p++) {
      var productId = contents[p];
      var product = productRegistry.get(productId);
      if (!product) continue;

      metalpart.applyHeat(productId, fnTemp, delta);

      // Check if product reached target temperature for its process
      // (For Phase 1, target is the furnace target temp minus tolerance)
      if (product.state === 'heating' && metalpart.hasReachedTemp(productId, fn.specs.targetTemp, 20)) {
        // Product is ready to move to forging
        // Don't change state here — dispatch will handle it
      }
    }
  }

  // --- Quench Tanks: cool products inside ---
  var allQuench = staticRegistry.getByType('quench');
  for (var q = 0; q < allQuench.length; q++) {
    var qt = allQuench[q];
    var qContents = quench.getContents(qt.id);
    var qTemp = quench.getCurrentTemp(qt.id);
    for (var p = 0; p < qContents.length; p++) {
      var qProductId = qContents[p];
      var qProduct = productRegistry.get(qProductId);
      if (!qProduct) continue;

      metalpart.applyQuench(qProductId, qTemp, qt.specs.coolingCoefficient, delta);
      quench.coolProduct(qt.id, qProduct.temperature, delta);

      // Check if product is cool enough to remove (below 200C)
      if (qProduct.state === 'quenching' && metalpart.isCooledBelow(qProductId, 200)) {
        productRegistry.updateState(qProductId, 'cooling', worldclock.getTime());
      }
    }
  }

  // --- Presses: check cycle completion ---
  var allPresses = staticRegistry.getByType('press');
  for (var pr = 0; pr < allPresses.length; pr++) {
    var prEntry = allPresses[pr];
    if (press.getState(prEntry.id) === 'complete') {
      var forgedProductId = press.getCurrentProduct(prEntry.id);
      if (forgedProductId) {
        // Apply forging deformation
        metalpart.applyForging(forgedProductId, 0.3);
        press.completeCycle(prEntry.id);
        // Product transitions to transport_quench (dispatch handles vehicle assignment)
        productRegistry.updateState(forgedProductId, 'transport_quench', worldclock.getTime());
        productRegistry.updateLocation(forgedProductId, 'in_transit');
      }
    }
  }

  // --- Hammers: check strike completion ---
  var allHammers = staticRegistry.getByType('hammer');
  for (var h = 0; h < allHammers.length; h++) {
    var hmEntry = allHammers[h];
    if (hammer.getState(hmEntry.id) === 'complete') {
      var struckProductId = hammer.getCurrentProduct(hmEntry.id);
      if (struckProductId) {
        metalpart.applyForging(struckProductId, 0.2);
        hammer.completeStriking(hmEntry.id);
        productRegistry.updateState(struckProductId, 'transport_quench', worldclock.getTime());
        productRegistry.updateLocation(struckProductId, 'in_transit');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch Logic — The Product Lifecycle Brain
// ---------------------------------------------------------------------------
// Scans all products and assigns idle vehicles to move them through their
// lifecycle. Each step: find products needing transport -> find idle vehicle
// -> find path -> assign route.
//
// Phase 1 hardcoded sequence:
//   truck -> raw_stored -> heating -> forging -> quenching -> finished_stored -> truck
//
// Phase 2 will replace this with process route reading from production orders.
// ---------------------------------------------------------------------------

function runDispatch() {
  // 1. Unload inbound trucks
  dispatchTruckUnloading();

  // 2. Move raw_stored products to furnaces
  dispatchToFurnace();

  // 3. Move heated products to presses
  dispatchToPress();

  // 4. Move quench-ready products to quench tanks
  dispatchToQuench();

  // 5. Move cooled products to finished storage
  dispatchToFinishedStorage();

  // 6. Load outbound trucks
  dispatchToOutboundTruck();
}

// --- Step 1: Unload inbound trucks ---
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

    // Assign task: go to truck, pick up, go to rack
    var truckPos = { x: tk.gridX, z: tk.gridZ + 2 }; // approach from front
    var path = floorplan.findPath(fk.gridX, fk.gridZ, truckPos.x, truckPos.z, 'forklift');
    if (!path) continue;

    mobileRegistry.assignTask(fk.id, { action: 'pickup', fromId: tk.id, toId: rackId, productId: null });
    forklift.assignRoute(fk.id, path);
    return; // one assignment per dispatch cycle
  }
}

// --- Step 2: Move queued/raw_stored products to furnace ---
function dispatchToFurnace() {
  var rawProducts = productRegistry.getByState('raw_stored');
  var queuedProducts = productRegistry.getByState('queued');
  var candidates = rawProducts.concat(queuedProducts);
  if (candidates.length === 0) return;

  // Find a furnace with room that is at target temp
  var fnId = findFurnaceWithRoom();
  if (!fnId) return;
  var fnEntry = staticRegistry.get(fnId);
  if (!fnEntry) return;

  // Find a manipulator (for hot-side operations) or forklift (for cold parts)
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

  // Find path from vehicle to product location, then to furnace
  var productLoc = getLocationGridPos(product.location);
  if (!productLoc) return;

  var path = floorplan.findPath(vehicle.gridX, vehicle.gridZ, productLoc.x, productLoc.z, vehicleType);
  if (!path) return;

  productRegistry.updateState(product.id, 'transport_heat', worldclock.getTime());
  productRegistry.updateLocation(product.id, 'in_transit');

  mobileRegistry.assignTask(vehicle.id, {
    action: 'pickup', fromId: product.location, toId: fnId, productId: product.id,
  });

  if (vehicleType === 'forklift') {
    forklift.assignRoute(vehicle.id, path);
  } else {
    manipulator.assignRoute(vehicle.id, path);
  }
}

// --- Step 3: Move heated products to press ---
function dispatchToPress() {
  // Find products in furnaces that have reached target temp
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

  // Find idle press
  var prId = findIdlePress();
  if (!prId) return;

  // Find idle manipulator (must use manipulator for hot parts)
  var mn = findIdleManipulator();
  if (!mn) return;

  var fnPos = getLocationGridPos(readyProduct.location);
  if (!fnPos) return;

  var path = floorplan.findPath(mn.gridX, mn.gridZ, fnPos.x, fnPos.z, 'manipulator');
  if (!path) return;

  // Unload from furnace
  furnace.unloadProduct(readyProduct.location, readyProduct.id);
  productRegistry.updateState(readyProduct.id, 'transport_forge', worldclock.getTime());
  productRegistry.updateLocation(readyProduct.id, 'in_transit');

  mobileRegistry.assignTask(mn.id, {
    action: 'pickup', fromId: readyProduct.location, toId: prId, productId: readyProduct.id,
  });
  manipulator.assignRoute(mn.id, path);
}

// --- Step 4: Move forged products to quench tank ---
function dispatchToQuench() {
  var transportQuench = productRegistry.getByState('transport_quench');
  if (transportQuench.length === 0) return;

  var product = transportQuench[0];

  // Find quench tank with room
  var qtId = findQuenchWithRoom();
  if (!qtId) return;

  // Find idle manipulator
  var mn = findIdleManipulator();
  if (!mn) return;

  var qtEntry = staticRegistry.get(qtId);
  if (!qtEntry) return;

  var path = floorplan.findPath(mn.gridX, mn.gridZ, qtEntry.gridX, qtEntry.gridZ, 'manipulator');
  if (!path) return;

  mobileRegistry.assignTask(mn.id, {
    action: 'deliver', fromId: null, toId: qtId, productId: product.id,
  });
  manipulator.assignRoute(mn.id, path);
}

// --- Step 5: Move cooled products to finished storage ---
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

  var path = floorplan.findPath(fk.gridX, fk.gridZ, productPos.x, productPos.z, 'forklift');
  if (!path) return;

  productRegistry.updateState(product.id, 'transport_store', worldclock.getTime());
  productRegistry.updateLocation(product.id, 'in_transit');

  mobileRegistry.assignTask(fk.id, {
    action: 'pickup', fromId: product.location, toId: rackId, productId: product.id,
  });
  forklift.assignRoute(fk.id, path);
}

// --- Step 6: Load outbound truck ---
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

  var path = floorplan.findPath(fk.gridX, fk.gridZ, productPos.x, productPos.z, 'forklift');
  if (!path) return;

  productRegistry.updateState(product.id, 'loading', worldclock.getTime());
  productRegistry.updateLocation(product.id, 'in_transit');

  mobileRegistry.assignTask(fk.id, {
    action: 'pickup', fromId: product.location, toId: outTruck.id, productId: product.id,
  });
  forklift.assignRoute(fk.id, path);
}

// ---------------------------------------------------------------------------
// Dispatch Helpers
// ---------------------------------------------------------------------------

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
  for (var i = 0; i < furnaces.length; i++) {
    var fn = furnaces[i];
    if (furnace.hasRoom(fn.id) && furnace.isAtTarget(fn.id)) {
      return fn.id;
    }
  }
  // Also check furnaces that are heating but have room
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

/**
 * Get the grid position of a location (equipment, rack, truck, etc.)
 */
function getLocationGridPos(locationId) {
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

// ---------------------------------------------------------------------------
// Task Completion Handling
// ---------------------------------------------------------------------------

/**
 * Called when a vehicle arrives at its destination and needs to complete
 * its task (load/unload product). This bridges the gap between vehicle
 * arrival and product state transitions.
 *
 * This should be called from the vehicle update functions when they
 * reach 'loading' or 'unloading' state, or can be polled each dispatch cycle.
 */
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
          var path = floorplan.findPath(vehicle.gridX, vehicle.gridZ, destPos.x, destPos.z, 'forklift');
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
        var path = floorplan.findPath(vehicle.gridX, vehicle.gridZ, destPos.x, destPos.z, 'manipulator');
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

/**
 * Place a product at its destination and update state accordingly.
 */
function deliverProduct(productId, destId, destEntry) {
  productRegistry.updateLocation(productId, destId);

  if (destEntry.type === 'furnace') {
    furnace.loadProduct(destId, productId);
    productRegistry.updateState(productId, 'heating', worldclock.getTime());
  } else if (destEntry.type === 'press') {
    press.startCycle(destId, productId);
    productRegistry.updateState(productId, 'forging', worldclock.getTime());
  } else if (destEntry.type === 'hammer') {
    hammer.startStriking(destId, productId, 30);
    productRegistry.updateState(productId, 'forging', worldclock.getTime());
  } else if (destEntry.type === 'quench') {
    quench.quenchProduct(destId, productId);
    productRegistry.updateState(productId, 'quenching', worldclock.getTime());
  } else if (destEntry.type === 'rack') {
    var product = productRegistry.get(productId);
    racks.storeItem(destId, productId, product ? product.weight : 0);
    var rackType = racks.getRackType(destId);
    if (rackType === 'raw_material') {
      productRegistry.updateState(productId, 'raw_stored', worldclock.getTime());
    } else if (rackType === 'finished_goods') {
      productRegistry.updateState(productId, 'finished_stored', worldclock.getTime());
    }
  } else if (destEntry.type === 'truck') {
    var product = productRegistry.get(productId);
    trucks.loadItem(destId, productId, product ? product.weight : 0);
    productRegistry.updateState(productId, 'loading', worldclock.getTime());
  }
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function setupEventHandlers() {
  // 3D object click -> show info panel
  visualhud.onObjectClick(function(hit) {
    if (hit.type === 'product') {
      var product = productRegistry.get(hit.id);
      if (product) {
        visualhud.showInfoPanel({
          id: product.id,
          name: product.materialGrade + ' Part',
          type: 'Metal Part',
          state: product.state,
          temperature: Math.round(product.temperature) + ' C',
          location: product.location,
          dimensions: Math.round(product.dimensions.length * 100) / 100 + ' x ' +
                      Math.round(product.dimensions.width * 100) / 100 + ' x ' +
                      Math.round(product.dimensions.height * 100) / 100 + ' m',
          weight: product.weight + ' kg',
          materialGrade: product.materialGrade,
          orderID: product.orderID || 'None',
        });
        // Fly camera to product
        var pos = getLocationGridPos(product.location);
        if (pos) controls.flyTo(pos.x, 2, pos.z, 15);
      }
    } else if (hit.type === 'utility') {
      visualhud.showInfoPanel({
        id: hit.id,
        type: 'Utility Connection',
        utilityType: hit.utilityType,
      });
    } else {
      // Equipment
      var entry = staticRegistry.get(hit.id) || mobileRegistry.get(hit.id);
      if (entry) {
        var info = {
          id: entry.id,
          name: entry.name,
          type: entry.type,
          status: entry.status,
          gridPosition: entry.gridX + ', ' + entry.gridZ,
        };
        // Add type-specific info
        if (entry.type === 'furnace') {
          info.temperature = Math.round(entry.specs.currentTemp) + ' / ' + entry.specs.targetTemp + ' C';
          info.state = entry.specs.state;
          info.contents = entry.specs.contents.length + ' / ' + entry.specs.maxContents;
        } else if (entry.type === 'press') {
          info.tonnage = entry.specs.tonnage + ' tons';
          info.state = entry.specs.state;
          info.cycleProgress = Math.round(entry.specs.cycleProgress * 100) + '%';
        } else if (entry.type === 'quench') {
          info.quenchantType = entry.specs.quenchantType;
          info.temperature = Math.round(entry.specs.currentTemp) + ' C';
          info.contents = entry.specs.contents.length + ' / ' + entry.specs.capacity;
        } else if (entry.type === 'rack') {
          info.rackType = entry.specs.rackType;
          info.occupancy = entry.specs.currentContents.length + ' / ' + entry.specs.capacityCount;
          info.weight = Math.round(entry.specs.currentWeight) + ' / ' + entry.specs.capacityWeight + ' kg';
        }
        visualhud.showInfoPanel(info);
        controls.flyTo(entry.gridX + entry.gridWidth / 2, 2, entry.gridZ + entry.gridDepth / 2, 15);
      }
    }
  });

  // Grid cell click -> show cell info (sandbox mode)
  visualhud.onGridClick(function(hit) {
    if (currentMode === 'sandbox') {
      var cellState = floorplan.getCell(hit.gridX, hit.gridZ);
      visualhud.showInfoPanel({
        type: 'Grid Cell',
        position: hit.gridX + ', ' + hit.gridZ,
        state: cellState,
        worldPosition: Math.round(hit.point.x * 10) / 10 + ', ' + Math.round(hit.point.z * 10) / 10,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Mode Management
// ---------------------------------------------------------------------------

export function setMode(mode) {
  currentMode = mode;
  visualhud.setMode(mode);

  if (mode === 'sandbox') {
    worldclock.pause();
  } else if (mode === 'prediction') {
    worldclock.setSpeed(1);
    worldclock.resume();
  } else if (mode === 'operating') {
    worldclock.setSpeed(1);
    worldclock.resume();
  }
}

export function getMode() {
  return currentMode;
}

// ---------------------------------------------------------------------------
// Status Bar Updates
// ---------------------------------------------------------------------------

function updateStatusBar() {
  visualhud.updateStatusBar({
    equipmentCount: staticRegistry.count(),
    productCount: productRegistry.countActive(),
    mobileCount: mobileRegistry.count(),
  });
}

// ---------------------------------------------------------------------------
// Order Submission (Phase 1 simple version)
// ---------------------------------------------------------------------------

/**
 * Submit a simple production order. Creates products, triggers truck arrival,
 * and starts simulation.
 *
 * @param {object} orderConfig - Simple order:
 *   - materialGrade: string
 *   - quantity: number
 *   - weight: number (per piece, kg)
 *   - dimensions: { length, width, height }
 * @returns {Array<string>} Product IDs created
 */
export function submitOrder(orderConfig) {
  var productIds = [];

  // Create products
  for (var i = 0; i < orderConfig.quantity; i++) {
    var part = metalpart.createMetalPart(
      orderConfig.materialGrade,
      orderConfig.dimensions || { length: 0.5, width: 0.15, height: 0.15 },
      orderConfig.weight || 45,
      { state: 'arriving' }
    );
    productIds.push(part.id);
    visualhud.addToScene(part.mesh);
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
    visualhud.addToScene(inTruck.mesh);

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
    visualhud.addToScene(outTruck.mesh);
  }

  // Switch to prediction mode and start simulation
  setMode('prediction');
  worldclock.setSpeed(2);

  console.log('Order submitted: ' + orderConfig.quantity + 'x ' +
    orderConfig.materialGrade + ' (' + productIds.length + ' products created)');

  return productIds;
}

/**
 * Get simulation results (Phase 1 stub, Phase 2 will fully implement).
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

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------

export function takeSnapshot() {
  return {
    worldclock: worldclock.takeSnapshot(),
    randnumerics: randnumerics.takeSnapshot(),
    floorplan: floorplan.takeSnapshot(),
    powerutilities: powerutilities.takeSnapshot(),
    staticRegistry: staticRegistry.takeSnapshot(),
    mobileRegistry: mobileRegistry.takeSnapshot(),
    productRegistry: productRegistry.takeSnapshot(),
  };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  worldclock.restoreSnapshot(snapshot.worldclock);
  randnumerics.restoreSnapshot(snapshot.randnumerics);
  floorplan.restoreSnapshot(snapshot.floorplan);
  powerutilities.restoreSnapshot(snapshot.powerutilities);
  staticRegistry.restoreSnapshot(snapshot.staticRegistry);
  mobileRegistry.restoreSnapshot(snapshot.mobileRegistry);
  productRegistry.restoreSnapshot(snapshot.productRegistry);
}

// ---------------------------------------------------------------------------
// Public API — Access to subsystems for external use
// ---------------------------------------------------------------------------

export {
  worldclock,
  measurementunits,
  controls,
  visualhud,
  floorplan,
  powerutilities,
  randnumerics,
  staticRegistry,
  mobileRegistry,
  productRegistry,
  furnace,
  press,
  hammer,
  quench,
  racks,
  forklift,
  manipulator,
  trucks,
  tools,
  metalpart,
};