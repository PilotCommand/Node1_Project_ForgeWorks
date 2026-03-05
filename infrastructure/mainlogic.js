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
import * as gridsquare from './gridsquare.js';
import * as builder from './forgehousebuilder.js';
import * as changer from './forgehousechanger.js';
import * as dispatcher from './dispatcher.js';
import * as mainmenu from './mainmenu.js';
import * as purchaseorders from './purchaseorders.js';
import * as generalinventory from './generalinventory.js';
import * as maintenanceschedule from './maintenanceschedule.js';
import * as documentprotocols from './documentprotocols.js';
import * as manufacturingreview from './manufacturingreview.js';

// --- Modes ---
import * as modeBuild from './mode_build.js';
import * as modeSelect from './mode_select.js';
import * as modeSpectate from './mode_spectate.js';

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

let currentMode = 'spectate';   // build, select, spectate
let MODES = ['spectate', 'select', 'build'];
let MODE_MODULES = {
  build: modeBuild,
  select: modeSelect,
  spectate: modeSpectate,
};
let isInitialized = false;
let isPredictionRunning = false;
let forgeStarted = false;
let storedContainer = null;
let storedOptions = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the Forgeworks application.
 * Shows the main menu landing page. The 3D forge world is not loaded until
 * the user clicks "Monitor Forge".
 *
 * @param {HTMLElement} container - DOM element to mount the 3D canvas
 * @param {object} [options] - Configuration options:
 *   - layout: 'coulter' or 'empty' (default 'coulter')
 *   - seed: random seed (default 42)
 *   - displaySystem: 'si' or 'imperial' (default 'si')
 */
export function init(container, options) {
  storedContainer = container;
  storedOptions = options || {};

  // Hide the 3D container until forge is started
  container.style.display = 'none';

  // Wire main menu navigation
  mainmenu.onNavigate(handleNavigation);

  // Wire sub-page back buttons
  purchaseorders.onBack(returnToMenu);
  generalinventory.onBack(returnToMenu);
  maintenanceschedule.onBack(returnToMenu);
  documentprotocols.onBack(returnToMenu);
  manufacturingreview.onBack(returnToMenu);

  // Show the main menu
  mainmenu.show();

  isInitialized = true;
  console.log('Forgeworks initialized — main menu displayed.');
}

/**
 * Start the 3D forge world. Called when user selects "Monitor Forge".
 * This does the heavy lifting that the old init() used to do immediately.
 */
function startForge() {
  if (forgeStarted) {
    // Already initialized — just show the container
    storedContainer.style.display = '';
    return;
  }

  var opts = storedOptions;

  // 1. Configure infrastructure
  randnumerics.setSeed(opts.seed || 42);
  measurementunits.setDisplaySystem(opts.displaySystem || 'si');

  // 2. Load layout via gridsquare (pure spatial data)
  var layoutConfig;
  if (opts.layout === 'empty') {
    layoutConfig = gridsquare.getEmptyLayout();
  } else {
    layoutConfig = gridsquare.getDefaultCoulterLayout();
  }
  gridsquare.loadLayout(layoutConfig);

  // 3. Show container and initialize renderer + HUD
  storedContainer.style.display = '';
  var gridW = gridsquare.getGridWidth();
  var gridD = gridsquare.getGridDepth();
  visualhud.initRenderer(storedContainer, gridW, gridD);

  // 4. Initialize builder with scene reference
  builder.initBuilder(visualhud.getScene());

  // 5. Build only the grid overlay (no floor, no walls)
  builder.buildGridOnly();

  // 6. Start the render loop
  visualhud.startRenderLoop(function() {
    var target = controls.getTarget();
    var dist = controls.getDistance();
    if (target && dist !== undefined) {
      builder.updateGridFocus(target.x, target.z, dist);
    }

    var dt = worldclock.getDelta();
    MODE_MODULES[currentMode].update(dt);
  });

  // 7. Set up mode cycling (spacebar)
  window.addEventListener('keydown', function(e) {
    if (e.code === 'Space' && !e.repeat) {
      if (mainmenu.isVisible() || purchaseorders.isVisible() || generalinventory.isVisible() || maintenanceschedule.isVisible() || documentprotocols.isVisible() || manufacturingreview.isVisible()) return;
      e.preventDefault();
      cycleMode();
    }
  });

  // 8. Wire the HUD menu panel click to navigate back
  visualhud.onMenuClick(handleMenuClick);

  // 9. Activate starting mode
  MODE_MODULES[currentMode].activate();
  visualhud.showModeIndicator(currentMode);

  forgeStarted = true;
  console.log('Forge started. Grid: ' + gridW + 'x' + gridD + ', Layout: ' + layoutConfig.name);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Handle navigation from the main menu landing page.
 * @param {string} key - Navigation item key
 */
function handleNavigation(key) {
  console.log('Navigate:', key);

  // Hide all pages first
  hideAllPages();

  if (key === 'monitor_forge') {
    startForge();
    return;
  }

  if (key === 'purchase_orders') {
    mainmenu.hide();
    purchaseorders.show();
    return;
  }

  if (key === 'general_inventory') {
    mainmenu.hide();
    generalinventory.show();
    return;
  }

  if (key === 'maintenance_schedule') {
    mainmenu.hide();
    maintenanceschedule.show();
    return;
  }

  if (key === 'document_protocols') {
    mainmenu.hide();
    documentprotocols.show();
    return;
  }

  if (key === 'manufacturing_review') {
    mainmenu.hide();
    manufacturingreview.show();
    return;
  }

  // Other pages — for now just log
  console.log('Page not yet implemented:', key);
}

/**
 * Handle clicks on the HUD menu panel (inside the 3D view).
 * @param {string} key - Menu item key
 */
function handleMenuClick(key) {
  if (key === 'main_menu') {
    returnToMenu();
    return;
  }

  // Navigating to a sub-page from the forge — hide the 3D container
  storedContainer.style.display = 'none';
  handleNavigation(key);
}

/**
 * Return to the main menu from any page.
 */
function returnToMenu() {
  // Hide forge if active
  storedContainer.style.display = 'none';

  // Hide all sub-pages
  hideAllPages();

  // Show the main menu
  mainmenu.show();
}

/**
 * Hide all sub-page overlays.
 */
function hideAllPages() {
  purchaseorders.hide();
  generalinventory.hide();
  maintenanceschedule.hide();
  documentprotocols.hide();
  manufacturingreview.hide();
}

// ---------------------------------------------------------------------------
// Mode Cycling
// ---------------------------------------------------------------------------

function cycleMode() {
  MODE_MODULES[currentMode].deactivate();
  var idx = MODES.indexOf(currentMode);
  idx = (idx + 1) % MODES.length;
  currentMode = MODES[idx];
  MODE_MODULES[currentMode].activate();
  visualhud.showModeIndicator(currentMode);
  console.log('Mode: ' + currentMode);
}

export function getMode() {
  return currentMode;
}

// ---------------------------------------------------------------------------
// Default Coulter Forge Setup
// ---------------------------------------------------------------------------

function placeDefaultEquipment() {
  // --- Furnaces ---
  var fn1 = furnace.createFurnace('Main Gas Furnace', 4, 12, {
    maxTemp: 1300, heatingRate: 5, fuelType: 'gas', maxContents: 6,
  });
  fn1.mesh = builder.spawnFurnace(fn1.id, 4, 12, fn1.specs);

  var fn2 = furnace.createFurnace('Electric Box Furnace', 4, 20, {
    maxTemp: 1200, heatingRate: 3, fuelType: 'electric', maxContents: 4,
  });
  fn2.mesh = builder.spawnFurnace(fn2.id, 4, 20, fn2.specs);

  var fn3 = furnace.createFurnace('Preheat Furnace', 12, 12, {
    maxTemp: 900, heatingRate: 8, fuelType: 'gas', maxContents: 8,
  });
  fn3.mesh = builder.spawnFurnace(fn3.id, 12, 12, fn3.specs);

  // --- Presses ---
  var pr1 = press.createPress('2000T Hydraulic Press', 27, 12, {
    tonnage: 2000, cycleTime: 8, pressType: 'hydraulic',
  });
  pr1.mesh = builder.spawnPress(pr1.id, 27, 12, pr1.specs);

  var pr2 = press.createPress('800T Mechanical Press', 27, 22, {
    tonnage: 800, cycleTime: 5, pressType: 'mechanical',
  });
  pr2.mesh = builder.spawnPress(pr2.id, 27, 22, pr2.specs);

  // --- Hammers ---
  var hm1 = hammer.createHammer('5kJ Power Hammer', 35, 14, {
    strikeEnergy: 5000, blowRate: 60,
  });
  hm1.mesh = builder.spawnHammer(hm1.id, 35, 14, hm1.specs);

  // --- Quench Tanks ---
  var qt1 = quench.createQuenchTank('Oil Quench Tank 1', 12, 28, {
    quenchantType: 'oil', tankVolume: 5000, capacity: 4,
  });
  qt1.mesh = builder.spawnQuenchTank(qt1.id, 12, 28, qt1.specs);

  var qt2 = quench.createQuenchTank('Water Quench Tank', 4, 28, {
    quenchantType: 'water', tankVolume: 3000, capacity: 3,
  });
  qt2.mesh = builder.spawnQuenchTank(qt2.id, 4, 28, qt2.specs);

  // --- Racks ---
  var rk1 = racks.createRack('Raw Stock Rack A', 4, 42, {
    rackType: 'raw_material', capacityCount: 30, capacityWeight: 8000,
  });
  rk1.mesh = builder.spawnRack(rk1.id, 4, 42, rk1.specs);

  var rk2 = racks.createRack('Raw Stock Rack B', 8, 42, {
    rackType: 'raw_material', capacityCount: 30, capacityWeight: 8000,
  });
  rk2.mesh = builder.spawnRack(rk2.id, 8, 42, rk2.specs);

  var rk3 = racks.createRack('Finished Rack A', 42, 42, {
    rackType: 'finished_goods', capacityCount: 40, capacityWeight: 10000,
  });
  rk3.mesh = builder.spawnRack(rk3.id, 42, 42, rk3.specs);

  var rk4 = racks.createRack('Finished Rack B', 48, 42, {
    rackType: 'finished_goods', capacityCount: 40, capacityWeight: 10000,
  });
  rk4.mesh = builder.spawnRack(rk4.id, 48, 42, rk4.specs);

  var rk5 = racks.createRack('Die Storage', 50, 60, {
    rackType: 'die_storage', capacityCount: 20, capacityWeight: 3000,
  });
  rk5.mesh = builder.spawnRack(rk5.id, 50, 60, rk5.specs);

  var rk6 = racks.createRack('Scrap Bin', 4, 62, {
    rackType: 'scrap', capacityCount: 50, capacityWeight: 15000,
  });
  rk6.mesh = builder.spawnRack(rk6.id, 4, 62, rk6.specs);

  // --- Mobile Equipment ---
  var fk1 = forklift.createForklift('Bay 1 Forklift', 21, 38, { speed: 3 });
  fk1.mesh = builder.spawnForklift(fk1.id, 21, 38, fk1.specs);

  var fk2 = forklift.createForklift('Bay 2 Forklift', 23, 38, { speed: 3 });
  fk2.mesh = builder.spawnForklift(fk2.id, 23, 38, fk2.specs);

  var mn1 = manipulator.createManipulator('Hot Handler 1', 20, 15, { speed: 2, thermalTolerance: 1200 });
  mn1.mesh = builder.spawnManipulator(mn1.id, 20, 15, mn1.specs);

  var mn2 = manipulator.createManipulator('Hot Handler 2', 20, 25, { speed: 2, thermalTolerance: 1200 });
  mn2.mesh = builder.spawnManipulator(mn2.id, 20, 25, mn2.specs);

  // --- Trucks (start absent, will arrive when orders are submitted) ---
  var tk1 = trucks.createTruck('Inbound Truck 1', 'flatbed', 'inbound');
  tk1.mesh = builder.spawnTruck(tk1.id, 0, 0, tk1.specs);
  tk1.mesh.visible = false;

  var tk2 = trucks.createTruck('Outbound Truck 1', 'flatbed', 'outbound');
  tk2.mesh = builder.spawnTruck(tk2.id, 0, 0, tk2.specs);
  tk2.mesh.visible = false;

  // --- Tools ---
  var tl1 = tools.createTool('Shaft Die Set', 'die', 51, 61, {
    weight: 200, compatibleEquipment: ['press', 'hammer'],
  });
  tl1.mesh = builder.spawnTool(tl1.id, 51, 61, tl1.specs);

  var tl2 = tools.createTool('Flange Die Set', 'die', 52, 61, {
    weight: 180, compatibleEquipment: ['press'],
  });
  tl2.mesh = builder.spawnTool(tl2.id, 52, 61, tl2.specs);

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
  // Changer handles ALL per-frame state + visual updates
  changer.update(delta, currentMode);

  // Dispatcher handles task completion + dispatch scans
  if (currentMode !== 'sandbox') {
    dispatcher.update(delta);
  }

  // HUD updates stay in mainlogic
  updateStatusBar();
  if (currentMode !== 'sandbox') {
    visualhud.showProductTracker(productRegistry.getActive());
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
        var pos = dispatcher.getLocationGridPos(product.location);
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
      var cellState = gridsquare.getCell(hit.gridX, hit.gridZ);
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
  var productIds = dispatcher.submitOrder(orderConfig);

  // Switch to prediction mode and start simulation
  setMode('prediction');
  worldclock.setSpeed(2);

  return productIds;
}

/**
 * Get simulation results (Phase 1 stub, Phase 2 will fully implement).
 */
export function getSimulationResults() {
  return dispatcher.getSimulationResults();
}

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------

export function takeSnapshot() {
  return {
    worldclock: worldclock.takeSnapshot(),
    randnumerics: randnumerics.takeSnapshot(),
    gridsquare: gridsquare.takeSnapshot(),
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
  gridsquare.restoreSnapshot(snapshot.gridsquare);
  powerutilities.restoreSnapshot(snapshot.powerutilities);
  staticRegistry.restoreSnapshot(snapshot.staticRegistry);
  mobileRegistry.restoreSnapshot(snapshot.mobileRegistry);
  productRegistry.restoreSnapshot(snapshot.productRegistry);
  dispatcher.reset();
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
  gridsquare,
  builder,
  changer,
  dispatcher,
  powerutilities,
  randnumerics,
  mainmenu,
  purchaseorders,
  generalinventory,
  maintenanceschedule,
  documentprotocols,
  manufacturingreview,
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