// ============================================================================
// static_press.js — Press Behavior and Rendering
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines an industrial forging press. Handles cycle timing, product
// deformation (volume conservation), and animated ram stroke.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Press creation, update, cycle control, mesh building
// ============================================================================

import * as THREE from 'three';
import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

// ---------------------------------------------------------------------------
// Default Press Specs
// ---------------------------------------------------------------------------

const DEFAULT_SPECS = {
  tonnage: 2000,             // metric tons force capacity
  strokeLength: 0.5,         // meters
  cycleTime: 8,              // seconds per full cycle
  pressType: 'hydraulic',    // hydraulic, mechanical, screw
  dieSet: null,              // tool ID currently installed
  powerDraw: 150000,         // watts
  state: 'idle',             // idle, cycling, complete
  cycleProgress: 0,          // 0.0 to 1.0
  currentProduct: null,      // product ID being forged
  forceApplied: 0,           // current force in Newtons
};

// ---------------------------------------------------------------------------
// Press Creation
// ---------------------------------------------------------------------------

export function createPress(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);

  var gridWidth = 3;
  var gridDepth = 4;

  var entry = registry.register('press', name, gridX, gridZ, gridWidth, gridDepth, specs);

  var mesh = buildPressMesh(specs, entry.id);
  mesh.position.set(gridX + gridWidth / 2, 0, gridZ + gridDepth / 2);
  entry.mesh = mesh;

  return entry;
}

// ---------------------------------------------------------------------------
// Press Update
// ---------------------------------------------------------------------------

export function updatePress(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return;

  var specs = entry.specs;

  if (specs.state === 'cycling') {
    specs.cycleProgress += delta / specs.cycleTime;

    // Calculate force: peaks at mid-stroke (progress 0.5)
    var strokePhase = Math.sin(specs.cycleProgress * Math.PI);
    specs.forceApplied = specs.tonnage * 9810 * strokePhase; // convert tons to Newtons

    if (specs.cycleProgress >= 1.0) {
      specs.cycleProgress = 1.0;
      specs.state = 'complete';
      specs.forceApplied = 0;
      registry.updateStatus(id, 'idle');
    }

    // Animate ram
    updatePressRam(entry);
  }
}

// ---------------------------------------------------------------------------
// Cycle Control
// ---------------------------------------------------------------------------

/**
 * Start a press cycle with a product.
 * @param {string} id - Press ID
 * @param {string} productId - Product ID being forged
 * @returns {boolean}
 */
export function startCycle(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return false;

  if (entry.specs.state === 'cycling') {
    console.warn('static_press: press ' + id + ' already cycling');
    return false;
  }

  entry.specs.currentProduct = productId;
  entry.specs.cycleProgress = 0;
  entry.specs.state = 'cycling';
  registry.updateStatus(id, 'active');
  return true;
}

/**
 * Complete the cycle and release the product.
 * @returns {string|null} The product ID that was forged
 */
export function completeCycle(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return null;

  var productId = entry.specs.currentProduct;
  entry.specs.currentProduct = null;
  entry.specs.cycleProgress = 0;
  entry.specs.state = 'idle';
  entry.specs.forceApplied = 0;
  registry.updateStatus(id, 'idle');

  // Reset ram position
  updatePressRam(entry);

  return productId;
}

/**
 * Install a die set on the press.
 */
export function installDie(id, toolId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'press') return false;
  entry.specs.dieSet = toolId;
  return true;
}

export function getState(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return entry.specs.state;
}

export function getCurrentProduct(id) {
  var entry = registry.get(id);
  if (!entry) return null;
  return entry.specs.currentProduct;
}

export function getCycleProgress(id) {
  var entry = registry.get(id);
  if (!entry) return 0;
  return entry.specs.cycleProgress;
}

export function isIdle(id) {
  var entry = registry.get(id);
  if (!entry) return false;
  return entry.specs.state === 'idle';
}

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

export function buildPressMesh(specs, registryId) {
  var group = new THREE.Group();

  var baseW = 3;
  var baseD = 4;
  var frameH = 4;

  var frameMat = new THREE.MeshStandardMaterial({
    color: 0x556677,
    roughness: 0.6,
    metalness: 0.5,
  });

  // Base plate
  var baseGeo = new THREE.BoxGeometry(baseW, 0.4, baseD);
  var base = new THREE.Mesh(baseGeo, frameMat);
  base.position.y = 0.2;
  base.castShadow = true;
  base.receiveShadow = true;
  base.userData.visibilityCategory = 'presses';
  group.add(base);

  // Left column
  var colGeo = new THREE.BoxGeometry(0.4, frameH, 0.5);
  var leftCol = new THREE.Mesh(colGeo, frameMat);
  leftCol.position.set(-baseW / 2 + 0.3, frameH / 2 + 0.4, 0);
  leftCol.castShadow = true;
  leftCol.userData.visibilityCategory = 'presses';
  group.add(leftCol);

  // Right column
  var rightCol = new THREE.Mesh(colGeo, frameMat);
  rightCol.position.set(baseW / 2 - 0.3, frameH / 2 + 0.4, 0);
  rightCol.castShadow = true;
  rightCol.userData.visibilityCategory = 'presses';
  group.add(rightCol);

  // Crown (top beam)
  var crownGeo = new THREE.BoxGeometry(baseW, 0.5, 1.2);
  var crown = new THREE.Mesh(crownGeo, frameMat);
  crown.position.set(0, frameH + 0.15, 0);
  crown.castShadow = true;
  crown.userData.visibilityCategory = 'presses';
  group.add(crown);

  // Ram (moving part)
  var ramMat = new THREE.MeshStandardMaterial({
    color: 0x778899,
    roughness: 0.4,
    metalness: 0.6,
  });
  var ramGeo = new THREE.BoxGeometry(baseW * 0.7, 0.6, 1.0);
  var ram = new THREE.Mesh(ramGeo, ramMat);
  ram.position.set(0, frameH - 0.3, 0);
  ram.castShadow = true;
  ram.userData.visibilityCategory = 'presses';
  ram.userData.isRam = true;
  group.add(ram);

  group.userData.visibilityCategory = 'presses';
  group.userData.registryId = registryId;
  group.userData.registryType = 'press';
  group.userData.frameHeight = frameH;
  group.userData.strokeLength = specs.strokeLength || 0.5;

  return group;
}

function updatePressRam(entry) {
  if (!entry.mesh) return;
  var frameH = entry.mesh.userData.frameHeight || 4;
  var strokeLen = entry.mesh.userData.strokeLength || 0.5;

  // Ram at top = 0, ram at bottom = 0.5 progress, back up = 1.0
  var progress = entry.specs.cycleProgress;
  var phase = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
  var ramY = frameH - 0.3 - (phase * strokeLen * 2);

  entry.mesh.traverse(function(child) {
    if (child.userData && child.userData.isRam) {
      child.position.y = ramY;
    }
  });
}