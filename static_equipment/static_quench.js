// ============================================================================
// static_quench.js — Quench Tank Behavior and Rendering
// Forgeworks Static Equipment Tier 4
// ============================================================================
// Defines a quench tank. Tracks quenchant temperature (rises as hot parts
// are introduced, cools back to ambient). Newton's law cooling on products.
//
// Imports: worldclock.js, measurementunits.js, static_registry.js
// Exports: Quench tank creation, update, product quenching, mesh building
// ============================================================================

import * as THREE from 'three';
import { getTime, getDelta } from '../infrastructure/worldclock.js';
import { formatValue } from '../infrastructure/measurementunits.js';
import * as registry from './static_registry.js';

const DEFAULT_SPECS = {
  tankVolume: 5000,          // liters
  quenchantType: 'oil',      // oil, water, polymer, brine
  ambientTemp: 25,           // Celsius
  currentTemp: 25,           // current quenchant temperature
  coolingCoefficient: 0.01,  // Newton's law coefficient for product cooling
  tankCoolingRate: 0.5,      // degrees/sec the tank cools back to ambient
  maxTempRise: 80,           // safe operating temp above ambient
  capacity: 4,               // max simultaneous products
  contents: [],              // product IDs submerged
  state: 'ready',            // ready, active, overheated
  powerDraw: 5000,           // watts (pumps, agitation)
  overheatCount: 0,          // track overheat events
};

// Quenchant colors
const QUENCHANT_COLORS = {
  oil: 0x332200,
  water: 0x224466,
  polymer: 0x225533,
  brine: 0x334455,
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createQuenchTank(name, gridX, gridZ, specOverrides) {
  var specs = Object.assign({}, DEFAULT_SPECS);
  if (specOverrides) Object.assign(specs, specOverrides);
  specs.contents = specs.contents ? specs.contents.slice() : [];

  var gridWidth = 3;
  var gridDepth = 3;

  var entry = registry.register('quench', name, gridX, gridZ, gridWidth, gridDepth, specs);

  var mesh = buildQuenchMesh(specs, entry.id);
  mesh.position.set(gridX + gridWidth / 2, 0, gridZ + gridDepth / 2);
  entry.mesh = mesh;

  return entry;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateQuenchTank(id, delta) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'quench') return;

  var specs = entry.specs;

  // Tank cools back toward ambient when no hot products inside
  if (specs.currentTemp > specs.ambientTemp) {
    specs.currentTemp -= specs.tankCoolingRate * delta;
    if (specs.currentTemp < specs.ambientTemp) specs.currentTemp = specs.ambientTemp;
  }

  // Check overheated state
  var overheatedThreshold = specs.ambientTemp + specs.maxTempRise;
  if (specs.currentTemp >= overheatedThreshold) {
    if (specs.state !== 'overheated') {
      specs.state = 'overheated';
      specs.overheatCount++;
    }
  } else if (specs.contents.length > 0) {
    specs.state = 'active';
  } else {
    specs.state = 'ready';
  }

  registry.updateStatus(id, specs.state === 'ready' ? 'idle' : 'active');

  // Update liquid color based on temperature
  updateQuenchLiquid(entry);
}

/**
 * Cool a product submerged in this tank (called by product update or mainlogic).
 * Returns the new product temperature.
 *
 * @param {string} id - Tank ID
 * @param {number} productTemp - Current product temp in Celsius
 * @param {number} delta - Time delta
 * @returns {number} New product temperature
 */
export function coolProduct(id, productTemp, delta) {
  var entry = registry.get(id);
  if (!entry) return productTemp;

  var specs = entry.specs;

  // Newton's law of cooling: dT/dt = -k * (T_product - T_quenchant)
  var dT = specs.coolingCoefficient * (productTemp - specs.currentTemp) * delta;
  var newProductTemp = productTemp - dT;

  // Heat transfer: quenchant absorbs heat from the product
  // Simplified: quenchant temp rises proportional to heat removed
  var heatAbsorbed = dT * 0.1; // scale factor
  specs.currentTemp += heatAbsorbed;

  return Math.max(newProductTemp, specs.currentTemp);
}

// ---------------------------------------------------------------------------
// Product Management
// ---------------------------------------------------------------------------

export function quenchProduct(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'quench') return false;

  if (entry.specs.contents.length >= entry.specs.capacity) {
    console.warn('static_quench: tank ' + id + ' is full');
    return false;
  }

  if (entry.specs.contents.indexOf(productId) !== -1) return false;

  entry.specs.contents.push(productId);
  entry.specs.state = 'active';
  return true;
}

export function removeProduct(id, productId) {
  var entry = registry.get(id);
  if (!entry || entry.type !== 'quench') return false;

  var idx = entry.specs.contents.indexOf(productId);
  if (idx === -1) return false;

  entry.specs.contents.splice(idx, 1);
  if (entry.specs.contents.length === 0) entry.specs.state = 'ready';
  return true;
}

export function getContents(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.contents.slice() : [];
}

export function hasRoom(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.contents.length < entry.specs.capacity : false;
}

export function getState(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state : null;
}

export function getCurrentTemp(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.currentTemp : 0;
}

export function isOverheated(id) {
  var entry = registry.get(id);
  return entry ? entry.specs.state === 'overheated' : false;
}

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

export function buildQuenchMesh(specs, registryId) {
  var group = new THREE.Group();

  var w = 3;
  var d = 3;
  var h = 1.2;
  var wallThickness = 0.15;

  var tankMat = new THREE.MeshStandardMaterial({
    color: 0x445566,
    roughness: 0.6,
    metalness: 0.4,
  });

  // Tank walls (4 sides, open top)
  // Front wall
  var frontGeo = new THREE.BoxGeometry(w, h, wallThickness);
  var front = new THREE.Mesh(frontGeo, tankMat);
  front.position.set(0, h / 2, d / 2 - wallThickness / 2);
  front.castShadow = true;
  front.userData.visibilityCategory = 'quenchTanks';
  group.add(front);

  // Back wall
  var back = new THREE.Mesh(frontGeo, tankMat);
  back.position.set(0, h / 2, -d / 2 + wallThickness / 2);
  back.castShadow = true;
  back.userData.visibilityCategory = 'quenchTanks';
  group.add(back);

  // Left wall
  var sideGeo = new THREE.BoxGeometry(wallThickness, h, d);
  var left = new THREE.Mesh(sideGeo, tankMat);
  left.position.set(-w / 2 + wallThickness / 2, h / 2, 0);
  left.castShadow = true;
  left.userData.visibilityCategory = 'quenchTanks';
  group.add(left);

  // Right wall
  var right = new THREE.Mesh(sideGeo, tankMat);
  right.position.set(w / 2 - wallThickness / 2, h / 2, 0);
  right.castShadow = true;
  right.userData.visibilityCategory = 'quenchTanks';
  group.add(right);

  // Bottom
  var bottomGeo = new THREE.BoxGeometry(w, wallThickness, d);
  var bottom = new THREE.Mesh(bottomGeo, tankMat);
  bottom.position.set(0, wallThickness / 2, 0);
  bottom.receiveShadow = true;
  bottom.userData.visibilityCategory = 'quenchTanks';
  group.add(bottom);

  // Liquid surface (semi-transparent)
  var liquidColor = QUENCHANT_COLORS[specs.quenchantType] || 0x224466;
  var liquidGeo = new THREE.PlaneGeometry(w - wallThickness * 2, d - wallThickness * 2);
  var liquidMat = new THREE.MeshStandardMaterial({
    color: liquidColor,
    transparent: true,
    opacity: 0.6,
    roughness: 0.2,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  var liquid = new THREE.Mesh(liquidGeo, liquidMat);
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.y = h * 0.75;
  liquid.userData.visibilityCategory = 'quenchTanks';
  liquid.userData.isLiquid = true;
  group.add(liquid);

  group.userData.visibilityCategory = 'quenchTanks';
  group.userData.registryId = registryId;
  group.userData.registryType = 'quench';

  return group;
}

// PERF: Pre-allocated Color objects for quench liquid updates
const _quenchBaseColor = new THREE.Color();
const _quenchHotColor = new THREE.Color(0x664422);

function updateQuenchLiquid(entry) {
  if (!entry.mesh) return;

  var specs = entry.specs;

  // Skip if temperature hasn't changed meaningfully
  var lastTemp = entry._lastLiquidTemp;
  if (lastTemp !== undefined && Math.abs(specs.currentTemp - lastTemp) < 1) return;
  entry._lastLiquidTemp = specs.currentTemp;

  var tempRatio = Math.min(1, (specs.currentTemp - specs.ambientTemp) / specs.maxTempRise);

  // Cache the liquid mesh child
  if (!entry._liquidMesh) {
    entry.mesh.traverse(function(child) {
      if (child.userData && child.userData.isLiquid && child.isMesh) {
        entry._liquidMesh = child;
      }
    });
  }
  var liquid = entry._liquidMesh;
  if (!liquid) return;

  _quenchBaseColor.set(QUENCHANT_COLORS[specs.quenchantType] || 0x224466);
  liquid.material.color.copy(_quenchBaseColor).lerp(_quenchHotColor, tempRatio);
}