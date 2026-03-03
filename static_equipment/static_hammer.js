// ============================================================================
// static_hammer.js — Power Hammer Behavior and Rendering
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines an industrial power hammer. Rapid reciprocating strikes at a
// configured blow rate. Tup (striking head) oscillates with sine-wave motion.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Hammer creation, update, strike control, mesh building
// ============================================================================

import * as THREE from 'three';
import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

const DEFAULT_SPECS = {
  strikeEnergy: 5000,      // Joules per blow
  blowRate: 60,            // strikes per minute
  dieSet: null,            // tool ID installed
  powerDraw: 50000,        // watts
  state: 'idle',           // idle, striking, complete
  strikesRemaining: 0,
  strikesDelivered: 0,
  totalStrikesRequested: 0,
  currentProduct: null,
  strikePhase: 0,          // 0-1 animation phase within a single blow
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createHammer(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);

  var gridWidth = 2;
  var gridDepth = 3;

  var entry = registry.register('hammer', name, gridX, gridZ, gridWidth, gridDepth, specs);

  var mesh = buildHammerMesh(specs, entry.id);
  mesh.position.set(gridX + gridWidth / 2, 0, gridZ + gridDepth / 2);
  entry.mesh = mesh;

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateHammer(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return;

  var specs = entry.specs;
  if (specs.state !== 'striking') return;

  // Calculate strikes this tick
  var strikesPerSecond = specs.blowRate / 60;
  var strikesThisTick = strikesPerSecond * delta;

  specs.strikesDelivered += strikesThisTick;
  specs.strikesRemaining -= strikesThisTick;

  // Animation phase: oscillate within each blow
  specs.strikePhase += strikesPerSecond * delta * Math.PI * 2;

  if (specs.strikesRemaining <= 0) {
    specs.strikesRemaining = 0;
    specs.strikesDelivered = specs.totalStrikesRequested;
    specs.state = 'complete';
    specs.strikePhase = 0;
    registry.updateStatus(id, 'idle');
  }

  // Update tup animation
  updateHammerTup(entry);
}

// ---------------------------------------------------------------------------
// Strike Control
// ---------------------------------------------------------------------------

export function startStriking(id, productId, totalStrikes) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return false;

  if (entry.specs.state === 'striking') {
    console.warn('static_hammer: hammer ' + id + ' already striking');
    return false;
  }

  entry.specs.currentProduct = productId;
  entry.specs.totalStrikesRequested = totalStrikes;
  entry.specs.strikesRemaining = totalStrikes;
  entry.specs.strikesDelivered = 0;
  entry.specs.state = 'striking';
  entry.specs.strikePhase = 0;
  registry.updateStatus(id, 'active');
  return true;
}

export function completeStriking(id) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return null;

  var productId = entry.specs.currentProduct;
  entry.specs.currentProduct = null;
  entry.specs.strikesRemaining = 0;
  entry.specs.strikesDelivered = 0;
  entry.specs.state = 'idle';
  entry.specs.strikePhase = 0;
  registry.updateStatus(id, 'idle');
  updateHammerTup(entry);
  return productId;
}

export function installDie(id, toolId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'hammer') return false;
  entry.specs.dieSet = toolId;
  return true;
}

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}

export function getCurrentProduct(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentProduct : null;
}

export function isIdle(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state === 'idle' : false;
}

export function getProgress(id) {
  var entry = registry.get(id);
  if (!entry || entry.specs.totalStrikesRequested === 0) return 0;
  return entry.specs.strikesDelivered / entry.specs.totalStrikesRequested;
}

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

export function buildHammerMesh(specs, registryId) {
  var group = new THREE.Group();

  var frameMat = new THREE.MeshStandardMaterial({
    color: 0x665544,
    roughness: 0.7,
    metalness: 0.4,
  });

  // Anvil block (base)
  var anvilGeo = new THREE.BoxGeometry(1.8, 0.8, 2.0);
  var anvil = new THREE.Mesh(anvilGeo, frameMat);
  anvil.position.y = 0.4;
  anvil.castShadow = true;
  anvil.receiveShadow = true;
  anvil.userData.visibilityCategory = 'hammers';
  group.add(anvil);

  // Frame uprights
  var uprightGeo = new THREE.BoxGeometry(0.3, 3.0, 0.3);
  var leftUpright = new THREE.Mesh(uprightGeo, frameMat);
  leftUpright.position.set(-0.7, 2.3, 0);
  leftUpright.castShadow = true;
  leftUpright.userData.visibilityCategory = 'hammers';
  group.add(leftUpright);

  var rightUpright = new THREE.Mesh(uprightGeo, frameMat);
  rightUpright.position.set(0.7, 2.3, 0);
  rightUpright.castShadow = true;
  rightUpright.userData.visibilityCategory = 'hammers';
  group.add(rightUpright);

  // Top crossbeam
  var crossGeo = new THREE.BoxGeometry(1.8, 0.3, 0.5);
  var cross = new THREE.Mesh(crossGeo, frameMat);
  cross.position.set(0, 3.65, 0);
  cross.castShadow = true;
  cross.userData.visibilityCategory = 'hammers';
  group.add(cross);

  // Tup (striking head) - the moving part
  var tupMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    roughness: 0.3,
    metalness: 0.7,
  });
  var tupGeo = new THREE.BoxGeometry(0.8, 0.5, 0.8);
  var tup = new THREE.Mesh(tupGeo, tupMat);
  tup.position.set(0, 2.5, 0);
  tup.castShadow = true;
  tup.userData.visibilityCategory = 'hammers';
  tup.userData.isTup = true;
  group.add(tup);

  group.userData.visibilityCategory = 'hammers';
  group.userData.registryId = registryId;
  group.userData.registryType = 'hammer';

  return group;
}

function updateHammerTup(entry) {
  if (!entry.mesh) return;

  var specs = entry.specs;
  // Tup oscillates between 2.5 (top) and 1.0 (bottom of stroke)
  var baseY = 2.5;
  var strokeDist = 1.2;
  var offset = 0;

  if (specs.state === 'striking') {
    // Sine wave oscillation
    offset = Math.abs(Math.sin(specs.strikePhase)) * strokeDist;
  }

  entry.mesh.traverse(function(child) {
    if (child.userData && child.userData.isTup) {
      child.position.y = baseY - offset;
    }
  });
}