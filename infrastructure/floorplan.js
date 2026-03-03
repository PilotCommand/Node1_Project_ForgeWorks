// ============================================================================
// floorplan.js — Spatial Layout and Zone Management
// Forgeworks · Infrastructure · Tier 3
// ============================================================================
// Defines and renders the physical layout of the forge house as a grid-based
// world. The grid is a 2D array on the XZ plane, each cell 1m x 1m.
// Each cell has exactly one state (wall, zone type, equipment, etc.).
//
// Handles: grid management, zone painting, wall/door placement, pathway
// definition, A* pathfinding for mobile equipment, and 3D mesh generation
// for the floor, walls, zones, and grid overlay.
//
// Imports: worldclock.js, measurementunits.js
// Exports: Layout loading, cell manipulation, pathfinding, mesh generation
// ============================================================================

import * as THREE from 'three';
import { getTime } from './worldclock.js';
import { getDisplaySystem } from './measurementunits.js';

// ---------------------------------------------------------------------------
// Zone Color Definitions
// ---------------------------------------------------------------------------

export const ZONE_COLORS = {
  'zone:storage_raw':         '#3399ff',
  'zone:storage_finished':    '#33cc33',
  'zone:storage_scrap':       '#996633',
  'zone:staging_inbound':     '#ff9900',
  'zone:staging_outbound':    '#ffcc00',
  'zone:heavy_machinery':     '#cc3333',
  'zone:heat_treatment':      '#ff6600',
  'zone:maintenance':         '#9966cc',
  'zone:office':              '#66cccc',
  'zone:parking':             '#999999',
  'zone:pathway_forklift':    '#cccccc',
  'zone:pathway_manipulator': '#cccccc',
  'zone:pathway_personnel':   '#ffffcc',
};

// Passability rules per vehicle type
const PASSABLE_STATES = {
  forklift: new Set([
    'empty', 'door',
    'zone:storage_raw', 'zone:storage_finished', 'zone:storage_scrap',
    'zone:staging_inbound', 'zone:staging_outbound',
    'zone:heavy_machinery', 'zone:heat_treatment',
    'zone:parking',
    'zone:pathway_forklift',
  ]),
  manipulator: new Set([
    'empty', 'door',
    'zone:storage_raw', 'zone:storage_finished', 'zone:storage_scrap',
    'zone:staging_inbound', 'zone:staging_outbound',
    'zone:heavy_machinery', 'zone:heat_treatment',
    'zone:parking',
    'zone:pathway_manipulator', 'zone:pathway_forklift',
  ]),
  personnel: new Set([
    'empty', 'door',
    'zone:storage_raw', 'zone:storage_finished', 'zone:storage_scrap',
    'zone:staging_inbound', 'zone:staging_outbound',
    'zone:heavy_machinery', 'zone:heat_treatment',
    'zone:maintenance', 'zone:office', 'zone:parking',
    'zone:pathway_forklift', 'zone:pathway_manipulator', 'zone:pathway_personnel',
  ]),
};

// ---------------------------------------------------------------------------
// Grid State
// ---------------------------------------------------------------------------

let gridWidth = 60;
let gridDepth = 80;
let cellSize = 1;
let wallHeight = 8;
let layoutName = 'untitled';

// 2D array: grid[z][x] — each cell is a string state
let grid = [];

// Structural elements (tracked separately for serialization)
let walls = [];   // { id, startX, startZ, endX, endZ, height }
let doors = [];   // { id, gridX, gridZ, width, type }
let pathways = []; // { id, name, type, waypoints: [{x,z}] }

// ID counters for walls, doors, pathways
let nextWallId = 1;
let nextDoorId = 1;
let nextPathwayId = 1;

// 3D meshes (rebuilt when layout changes)
let floorMesh = null;
let zoneOverlayMeshes = [];
let wallMeshes = [];
let gridOverlayMesh = null;
let pathwayMeshes = [];

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize an empty grid of the given dimensions.
 */
function initGrid(width, depth) {
  gridWidth = width;
  gridDepth = depth;
  grid = [];
  for (let z = 0; z < depth; z++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push('empty');
    }
    grid.push(row);
  }
}

// ---------------------------------------------------------------------------
// Layout Loading / Saving
// ---------------------------------------------------------------------------

/**
 * Load a layout configuration. Replaces the entire grid and all structures.
 *
 * @param {object} config - Layout configuration object:
 *   { name, gridWidth, gridDepth, cellSize, wallHeight, grid (optional 2D array),
 *     walls, doors, pathways }
 */
export function loadLayout(config) {
  layoutName = config.name || 'untitled';
  cellSize = config.cellSize || 1;
  wallHeight = config.wallHeight || 8;

  initGrid(config.gridWidth || 60, config.gridDepth || 80);

  // Load cell states if provided
  if (config.grid && config.grid.cells) {
    for (let z = 0; z < gridDepth && z < config.grid.cells.length; z++) {
      for (let x = 0; x < gridWidth && x < config.grid.cells[z].length; x++) {
        grid[z][x] = config.grid.cells[z][x];
      }
    }
  }

  // Load walls
  walls = [];
  nextWallId = 1;
  if (config.walls) {
    for (const w of config.walls) {
      walls.push({ ...w });
      const num = parseInt(String(w.id).replace('W-', ''), 10);
      if (!isNaN(num) && num >= nextWallId) nextWallId = num + 1;
    }
  }

  // Load doors
  doors = [];
  nextDoorId = 1;
  if (config.doors) {
    for (const d of config.doors) {
      doors.push({ ...d });
      const num = parseInt(String(d.id).replace('D-', ''), 10);
      if (!isNaN(num) && num >= nextDoorId) nextDoorId = num + 1;
    }
  }

  // Load pathways
  pathways = [];
  nextPathwayId = 1;
  if (config.pathways) {
    for (const p of config.pathways) {
      pathways.push({
        ...p,
        waypoints: p.waypoints ? p.waypoints.map(function(wp) { return { ...wp }; }) : [],
      });
      const num = parseInt(String(p.id).replace('R-', ''), 10);
      if (!isNaN(num) && num >= nextPathwayId) nextPathwayId = num + 1;
    }
  }
}

/**
 * Serialize the current layout to a configuration object.
 * @returns {object} Layout configuration (JSON-serializable)
 */
export function saveLayout() {
  const cellsCopy = [];
  for (let z = 0; z < gridDepth; z++) {
    cellsCopy.push([...grid[z]]);
  }

  return {
    name: layoutName,
    gridWidth: gridWidth,
    gridDepth: gridDepth,
    cellSize: cellSize,
    wallHeight: wallHeight,
    grid: {
      width: gridWidth,
      depth: gridDepth,
      cellSize: cellSize,
      wallHeight: wallHeight,
      cells: cellsCopy,
    },
    walls: walls.map(function(w) { return { ...w }; }),
    doors: doors.map(function(d) { return { ...d }; }),
    pathways: pathways.map(function(p) {
      return {
        ...p,
        waypoints: p.waypoints.map(function(wp) { return { ...wp }; }),
      };
    }),
  };
}

/**
 * Get the current layout configuration (same as saveLayout).
 */
export function getLayout() {
  return saveLayout();
}

export function getLayoutName() {
  return layoutName;
}

export function setLayoutName(name) {
  layoutName = name;
}

// ---------------------------------------------------------------------------
// Grid Dimensions
// ---------------------------------------------------------------------------

export function getGridWidth() { return gridWidth; }
export function getGridDepth() { return gridDepth; }
export function getCellSize() { return cellSize; }
export function getWallHeight() { return wallHeight; }

// ---------------------------------------------------------------------------
// Cell Access
// ---------------------------------------------------------------------------

/**
 * Get the state of a single cell.
 * @param {number} x - Grid X
 * @param {number} z - Grid Z
 * @returns {string|null} Cell state or null if out of bounds
 */
export function getCell(x, z) {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridDepth) return null;
  return grid[z][x];
}

/**
 * Set the state of a single cell.
 * @param {number} x
 * @param {number} z
 * @param {string} state
 * @returns {boolean} True if set successfully
 */
export function setCell(x, z, state) {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridDepth) return false;
  grid[z][x] = state;
  return true;
}

/**
 * Set a rectangular block of cells to the same state.
 * @param {number} x1 - Left X (inclusive)
 * @param {number} z1 - Top Z (inclusive)
 * @param {number} x2 - Right X (inclusive)
 * @param {number} z2 - Bottom Z (inclusive)
 * @param {string} state
 * @returns {number} Number of cells changed
 */
export function setCellBlock(x1, z1, x2, z2, state) {
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(gridWidth - 1, Math.max(x1, x2));
  const minZ = Math.max(0, Math.min(z1, z2));
  const maxZ = Math.min(gridDepth - 1, Math.max(z1, z2));

  let count = 0;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      grid[z][x] = state;
      count++;
    }
  }
  return count;
}

/**
 * Get the previous state of cells in a block (for undo).
 */
export function getCellBlockStates(x1, z1, x2, z2) {
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(gridWidth - 1, Math.max(x1, x2));
  const minZ = Math.max(0, Math.min(z1, z2));
  const maxZ = Math.min(gridDepth - 1, Math.max(z1, z2));

  const states = [];
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      states.push({ x: x, z: z, state: grid[z][x] });
    }
  }
  return states;
}

// ---------------------------------------------------------------------------
// Cell Queries
// ---------------------------------------------------------------------------

/**
 * Check if a cell is passable by a given vehicle type.
 */
export function isCellPassable(x, z, vehicleType) {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridDepth) return false;
  const state = grid[z][x];
  const allowed = PASSABLE_STATES[vehicleType || 'personnel'];
  if (!allowed) return false;
  return allowed.has(state);
}

/**
 * Check if a rectangular area of cells is available for equipment placement.
 * All cells must be non-wall, non-equipment.
 *
 * @param {number} x - Left X
 * @param {number} z - Top Z
 * @param {number} width - Width in cells
 * @param {number} depth - Depth in cells
 * @returns {boolean}
 */
export function isCellAvailable(x, z, width, depth) {
  if (x < 0 || z < 0 || x + width > gridWidth || z + depth > gridDepth) return false;

  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      const state = grid[z + dz][x + dx];
      if (state === 'wall' || state === 'equipment') return false;
    }
  }
  return true;
}

/**
 * Get all cells matching a specific state.
 * @param {string} state
 * @returns {Array<{x: number, z: number}>}
 */
export function getCellsOfType(state) {
  const results = [];
  for (let z = 0; z < gridDepth; z++) {
    for (let x = 0; x < gridWidth; x++) {
      if (grid[z][x] === state) results.push({ x: x, z: z });
    }
  }
  return results;
}

/**
 * Get all cells belonging to a zone type (prefix match).
 * @param {string} zonePrefix - e.g., 'zone:storage' matches storage_raw, storage_finished, etc.
 * @returns {Array<{x: number, z: number, state: string}>}
 */
export function getZoneCells(zonePrefix) {
  const results = [];
  for (let z = 0; z < gridDepth; z++) {
    for (let x = 0; x < gridWidth; x++) {
      if (grid[z][x].startsWith(zonePrefix)) {
        results.push({ x: x, z: z, state: grid[z][x] });
      }
    }
  }
  return results;
}

/**
 * Convert grid coordinates to world coordinates (center of cell).
 */
export function gridToWorld(gridX, gridZ) {
  return {
    x: gridX * cellSize + cellSize / 2,
    y: 0,
    z: gridZ * cellSize + cellSize / 2,
  };
}

/**
 * Convert world coordinates to grid coordinates.
 */
export function worldToGrid(worldX, worldZ) {
  return {
    x: Math.floor(worldX / cellSize),
    z: Math.floor(worldZ / cellSize),
  };
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/**
 * Add a wall segment. Updates both the walls array and the grid cells.
 */
export function addWall(startX, startZ, endX, endZ, height) {
  const id = 'W-' + String(nextWallId).padStart(3, '0');
  nextWallId++;

  const wall = {
    id: id,
    startX: startX,
    startZ: startZ,
    endX: endX,
    endZ: endZ,
    height: height || wallHeight,
  };
  walls.push(wall);

  // Mark grid cells as wall
  if (startX === endX) {
    // Vertical wall
    const minZ = Math.min(startZ, endZ);
    const maxZ = Math.max(startZ, endZ);
    for (let z = minZ; z <= maxZ; z++) {
      if (startX >= 0 && startX < gridWidth && z >= 0 && z < gridDepth) {
        grid[z][startX] = 'wall';
      }
    }
  } else if (startZ === endZ) {
    // Horizontal wall
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    for (let x = minX; x <= maxX; x++) {
      if (x >= 0 && x < gridWidth && startZ >= 0 && startZ < gridDepth) {
        grid[startZ][x] = 'wall';
      }
    }
  }

  return wall;
}

/**
 * Remove a wall by ID.
 */
export function removeWall(id) {
  const idx = walls.findIndex(function(w) { return w.id === id; });
  if (idx === -1) return false;

  const wall = walls[idx];

  // Clear grid cells that were part of this wall
  if (wall.startX === wall.endX) {
    const minZ = Math.min(wall.startZ, wall.endZ);
    const maxZ = Math.max(wall.startZ, wall.endZ);
    for (let z = minZ; z <= maxZ; z++) {
      if (wall.startX >= 0 && wall.startX < gridWidth && z >= 0 && z < gridDepth) {
        grid[z][wall.startX] = 'empty';
      }
    }
  } else if (wall.startZ === wall.endZ) {
    const minX = Math.min(wall.startX, wall.endX);
    const maxX = Math.max(wall.startX, wall.endX);
    for (let x = minX; x <= maxX; x++) {
      if (x >= 0 && x < gridWidth && wall.startZ >= 0 && wall.startZ < gridDepth) {
        grid[wall.startZ][x] = 'empty';
      }
    }
  }

  walls.splice(idx, 1);
  return true;
}

export function getWalls() {
  return walls;
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

/**
 * Add a door (gap in wall).
 */
export function addDoor(gridX, gridZ, width, type) {
  const id = 'D-' + String(nextDoorId).padStart(3, '0');
  nextDoorId++;

  const door = {
    id: id,
    gridX: gridX,
    gridZ: gridZ,
    width: width || 4,
    type: type || 'rollup',
  };
  doors.push(door);

  // Mark grid cells as door (passable)
  for (let dx = 0; dx < door.width; dx++) {
    const cx = gridX + dx;
    if (cx >= 0 && cx < gridWidth && gridZ >= 0 && gridZ < gridDepth) {
      grid[gridZ][cx] = 'door';
    }
  }

  return door;
}

/**
 * Remove a door by ID.
 */
export function removeDoor(id) {
  const idx = doors.findIndex(function(d) { return d.id === id; });
  if (idx === -1) return false;

  const door = doors[idx];
  // Revert door cells to wall
  for (let dx = 0; dx < door.width; dx++) {
    const cx = door.gridX + dx;
    if (cx >= 0 && cx < gridWidth && door.gridZ >= 0 && door.gridZ < gridDepth) {
      grid[door.gridZ][cx] = 'wall';
    }
  }

  doors.splice(idx, 1);
  return true;
}

export function getDoors() {
  return doors;
}

// ---------------------------------------------------------------------------
// Pathways
// ---------------------------------------------------------------------------

/**
 * Add a named pathway (route for mobile equipment).
 */
export function addPathway(name, type, waypoints) {
  const id = 'R-' + String(nextPathwayId).padStart(3, '0');
  nextPathwayId++;

  const pathway = {
    id: id,
    name: name,
    type: type,
    waypoints: waypoints.map(function(wp) { return { x: wp.x, z: wp.z }; }),
  };
  pathways.push(pathway);

  // Mark pathway cells on the grid
  var zoneType = 'zone:pathway_' + type;
  for (var i = 0; i < waypoints.length; i++) {
    var wp = waypoints[i];
    if (wp.x >= 0 && wp.x < gridWidth && wp.z >= 0 && wp.z < gridDepth) {
      var current = grid[wp.z][wp.x];
      if (current === 'empty' || current.startsWith('zone:pathway')) {
        grid[wp.z][wp.x] = zoneType;
      }
    }
  }

  return pathway;
}

/**
 * Remove a pathway by ID.
 */
export function removePathway(id) {
  const idx = pathways.findIndex(function(p) { return p.id === id; });
  if (idx === -1) return false;

  const pathway = pathways[idx];
  for (var i = 0; i < pathway.waypoints.length; i++) {
    var wp = pathway.waypoints[i];
    if (wp.x >= 0 && wp.x < gridWidth && wp.z >= 0 && wp.z < gridDepth) {
      grid[wp.z][wp.x] = 'empty';
    }
  }

  pathways.splice(idx, 1);
  return true;
}

export function getPathways() {
  return pathways;
}

// ---------------------------------------------------------------------------
// A* Pathfinding
// ---------------------------------------------------------------------------

/**
 * Find the shortest path between two grid cells for a given vehicle type.
 * Uses A* algorithm on the grid.
 *
 * @param {number} fromX - Start grid X
 * @param {number} fromZ - Start grid Z
 * @param {number} toX - End grid X
 * @param {number} toZ - End grid Z
 * @param {string} vehicleType - 'forklift', 'manipulator', 'personnel'
 * @returns {Array<{x: number, z: number}>|null} Path as waypoints, or null if no path
 */
export function findPath(fromX, fromZ, toX, toZ, vehicleType) {
  // Bounds check
  if (fromX < 0 || fromX >= gridWidth || fromZ < 0 || fromZ >= gridDepth) return null;
  if (toX < 0 || toX >= gridWidth || toZ < 0 || toZ >= gridDepth) return null;

  // Same cell
  if (fromX === toX && fromZ === toZ) return [{ x: fromX, z: fromZ }];

  var vType = vehicleType || 'personnel';

  // A* open set as a simple sorted array (adequate for grid sizes up to ~100x100)
  var openSet = [];
  var closedSet = new Set();

  // Node: { x, z, g, h, f, parent }
  var startNode = {
    x: fromX,
    z: fromZ,
    g: 0,
    h: heuristic(fromX, fromZ, toX, toZ),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  openSet.push(startNode);

  // gScore map: "x,z" -> best known g score
  var gScores = {};
  gScores[fromX + ',' + fromZ] = 0;

  var iterations = 0;
  var maxIterations = gridWidth * gridDepth * 2; // safety limit

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Get node with lowest f score
    var currentIdx = 0;
    for (var i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[currentIdx].f) {
        currentIdx = i;
      }
    }
    var current = openSet[currentIdx];

    // Reached the goal
    if (current.x === toX && current.z === toZ) {
      return reconstructPath(current);
    }

    // Move current from open to closed
    openSet.splice(currentIdx, 1);
    var currentKey = current.x + ',' + current.z;
    closedSet.add(currentKey);

    // Check 4 neighbors (no diagonal movement for vehicles)
    var neighbors = [
      { x: current.x,     z: current.z - 1 }, // north
      { x: current.x,     z: current.z + 1 }, // south
      { x: current.x - 1, z: current.z     }, // west
      { x: current.x + 1, z: current.z     }, // east
    ];

    for (var n = 0; n < neighbors.length; n++) {
      var nb = neighbors[n];
      var nbKey = nb.x + ',' + nb.z;

      // Skip if in closed set
      if (closedSet.has(nbKey)) continue;

      // Skip if not passable (but always allow the destination cell)
      var isDestination = (nb.x === toX && nb.z === toZ);
      if (!isDestination && !isCellPassable(nb.x, nb.z, vType)) continue;

      // Also allow destination even if it has equipment on it
      // (vehicle needs to reach the station)
      if (isDestination) {
        if (nb.x < 0 || nb.x >= gridWidth || nb.z < 0 || nb.z >= gridDepth) continue;
      }

      var tentativeG = current.g + 1; // uniform cost = 1 per cell

      var existingG = gScores[nbKey];
      if (existingG !== undefined && tentativeG >= existingG) continue;

      gScores[nbKey] = tentativeG;

      var nbNode = {
        x: nb.x,
        z: nb.z,
        g: tentativeG,
        h: heuristic(nb.x, nb.z, toX, toZ),
        f: 0,
        parent: current,
      };
      nbNode.f = nbNode.g + nbNode.h;

      // Remove existing entry in open set if present (we found a better path)
      for (var oi = openSet.length - 1; oi >= 0; oi--) {
        if (openSet[oi].x === nb.x && openSet[oi].z === nb.z) {
          openSet.splice(oi, 1);
          break;
        }
      }

      openSet.push(nbNode);
    }
  }

  // No path found
  return null;
}

function heuristic(ax, az, bx, bz) {
  // Manhattan distance
  return Math.abs(ax - bx) + Math.abs(az - bz);
}

function reconstructPath(node) {
  var path = [];
  var current = node;
  while (current !== null) {
    path.push({ x: current.x, z: current.z });
    current = current.parent;
  }
  path.reverse();
  return path;
}

// ---------------------------------------------------------------------------
// 3D Mesh Generation
// ---------------------------------------------------------------------------

/**
 * Build the floor plane mesh.
 * @returns {THREE.Mesh}
 */
export function buildFloorMesh() {
  var geometry = new THREE.PlaneGeometry(gridWidth * cellSize, gridDepth * cellSize);
  var material = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.9,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  floorMesh = new THREE.Mesh(geometry, material);
  floorMesh.rotation.x = -Math.PI / 2; // lay flat on XZ plane
  floorMesh.position.set(
    (gridWidth * cellSize) / 2,
    0,
    (gridDepth * cellSize) / 2
  );
  floorMesh.receiveShadow = true;
  floorMesh.userData.visibilityCategory = 'zones';

  return floorMesh;
}

/**
 * Build zone overlay meshes (colored floor tiles for each zone).
 * PERF: Merges all tiles of each zone type into a single BufferGeometry.
 * Result: ~12 draw calls instead of ~2900.
 * @returns {THREE.Group}
 */
export function buildZoneOverlayMeshes() {
  var group = new THREE.Group();
  group.userData.visibilityCategory = 'zones';

  // Collect cells by zone type
  var zoneBuckets = {};

  for (var z = 0; z < gridDepth; z++) {
    for (var x = 0; x < gridWidth; x++) {
      var state = grid[z][x];
      if (ZONE_COLORS[state]) {
        if (!zoneBuckets[state]) zoneBuckets[state] = [];
        zoneBuckets[state].push({ x: x, z: z });
      }
    }
  }

  var half = cellSize * 0.475; // 0.95 / 2

  var zoneTypes = Object.keys(zoneBuckets);
  for (var i = 0; i < zoneTypes.length; i++) {
    var zoneType = zoneTypes[i];
    var cells = zoneBuckets[zoneType];
    var colorHex = ZONE_COLORS[zoneType];

    // Build merged geometry: 2 triangles per cell = 6 vertices = 18 floats
    var vertCount = cells.length * 6;
    var positions = new Float32Array(vertCount * 3);
    var idx = 0;

    for (var c = 0; c < cells.length; c++) {
      var cx = cells[c].x * cellSize + cellSize / 2;
      var cz = cells[c].z * cellSize + cellSize / 2;

      // Quad as 2 triangles (CCW winding, facing up)
      // Triangle 1: BL, TR, BR
      positions[idx++] = cx - half; positions[idx++] = 0.01; positions[idx++] = cz + half;
      positions[idx++] = cx + half; positions[idx++] = 0.01; positions[idx++] = cz - half;
      positions[idx++] = cx + half; positions[idx++] = 0.01; positions[idx++] = cz + half;
      // Triangle 2: BL, BR, TR  (note: BL, BR_bottom, TR)
      positions[idx++] = cx - half; positions[idx++] = 0.01; positions[idx++] = cz + half;
      positions[idx++] = cx - half; positions[idx++] = 0.01; positions[idx++] = cz - half;
      positions[idx++] = cx + half; positions[idx++] = 0.01; positions[idx++] = cz - half;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    var mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.35,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData.visibilityCategory = 'zones';
    group.add(mesh);
  }

  zoneOverlayMeshes = [group];
  return group;
}

/**
 * Build wall meshes (extruded boxes from wall cells).
 * PERF: Uses InstancedMesh — one geometry, one material, one draw call
 * for all wall blocks instead of one per cell (~400 → 1).
 * @returns {THREE.Group}
 */
export function buildWallMeshes() {
  var group = new THREE.Group();
  group.userData.visibilityCategory = 'walls';

  // First pass: count wall cells
  var wallCells = [];
  for (var z = 0; z < gridDepth; z++) {
    for (var x = 0; x < gridWidth; x++) {
      if (grid[z][x] === 'wall') {
        wallCells.push({ x: x, z: z });
      }
    }
  }

  if (wallCells.length === 0) {
    wallMeshes = [group];
    return group;
  }

  // Create single geometry and material
  var wallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
  var wallMat = new THREE.MeshStandardMaterial({
    color: 0x606060,
    roughness: 0.7,
    metalness: 0.2,
  });

  // Create InstancedMesh
  var instancedWall = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
  instancedWall.castShadow = true;
  instancedWall.receiveShadow = true;
  instancedWall.userData.visibilityCategory = 'walls';

  // Set transform for each instance
  var matrix = new THREE.Matrix4();
  for (var i = 0; i < wallCells.length; i++) {
    var cell = wallCells[i];
    matrix.identity();
    matrix.setPosition(
      cell.x * cellSize + cellSize / 2,
      wallHeight / 2,
      cell.z * cellSize + cellSize / 2
    );
    instancedWall.setMatrixAt(i, matrix);
  }
  instancedWall.instanceMatrix.needsUpdate = true;

  group.add(instancedWall);

  wallMeshes = [group];
  return group;
}

/**
 * Build the grid overlay wireframe.
 * @returns {THREE.LineSegments}
 */
export function buildGridOverlay() {
  var points = [];

  // Horizontal lines (along X axis)
  for (var z = 0; z <= gridDepth; z++) {
    points.push(0, 0.02, z * cellSize);
    points.push(gridWidth * cellSize, 0.02, z * cellSize);
  }

  // Vertical lines (along Z axis)
  for (var x = 0; x <= gridWidth; x++) {
    points.push(x * cellSize, 0.02, 0);
    points.push(x * cellSize, 0.02, gridDepth * cellSize);
  }

  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

  var material = new THREE.LineBasicMaterial({
    color: 0x555555,
    transparent: true,
    opacity: 0.5,
  });

  gridOverlayMesh = new THREE.LineSegments(geometry, material);
  gridOverlayMesh.userData.visibilityCategory = 'zones';

  return gridOverlayMesh;
}

/**
 * Build pathway visualization meshes.
 * @returns {THREE.Group}
 */
export function buildPathwayMeshes() {
  var group = new THREE.Group();
  group.userData.visibilityCategory = 'pathways';

  for (var p = 0; p < pathways.length; p++) {
    var pathway = pathways[p];
    if (pathway.waypoints.length < 2) continue;

    var linePoints = [];
    for (var w = 0; w < pathway.waypoints.length; w++) {
      var wp = pathway.waypoints[w];
      linePoints.push(
        wp.x * cellSize + cellSize / 2,
        0.03,
        wp.z * cellSize + cellSize / 2
      );
    }

    var lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));

    var lineColor = pathway.type === 'forklift' ? 0x66aaff :
                    pathway.type === 'manipulator' ? 0xffaa33 : 0xaaffaa;

    var lineMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });

    var line = new THREE.Line(lineGeo, lineMat);
    line.userData.visibilityCategory = 'pathways';
    line.userData.pathwayId = pathway.id;
    group.add(line);
  }

  pathwayMeshes = [group];
  return group;
}

/**
 * Build all floor-related meshes and return them as an array.
 * Convenience function for initial scene setup.
 * @returns {Array<THREE.Object3D>}
 */
export function buildAllMeshes() {
  return [
    buildFloorMesh(),
    buildZoneOverlayMeshes(),
    buildWallMeshes(),
    buildGridOverlay(),
    buildPathwayMeshes(),
  ];
}

/**
 * Get references to existing meshes (for removal from scene before rebuild).
 */
export function getFloorMesh() { return floorMesh; }
export function getGridOverlayMesh() { return gridOverlayMesh; }
export function getZoneOverlayMeshes() { return zoneOverlayMeshes; }
export function getWallMeshes() { return wallMeshes; }
export function getPathwayMeshes() { return pathwayMeshes; }

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------

export function takeSnapshot() {
  var cellsCopy = [];
  for (var z = 0; z < gridDepth; z++) {
    cellsCopy.push([...grid[z]]);
  }

  return {
    gridWidth: gridWidth,
    gridDepth: gridDepth,
    cellSize: cellSize,
    wallHeight: wallHeight,
    layoutName: layoutName,
    grid: cellsCopy,
    walls: walls.map(function(w) { return { ...w }; }),
    doors: doors.map(function(d) { return { ...d }; }),
    pathways: pathways.map(function(p) {
      return { ...p, waypoints: p.waypoints.map(function(wp) { return { ...wp }; }) };
    }),
    nextWallId: nextWallId,
    nextDoorId: nextDoorId,
    nextPathwayId: nextPathwayId,
  };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot || !snapshot.grid) {
    console.warn('floorplan: invalid snapshot');
    return;
  }

  gridWidth = snapshot.gridWidth;
  gridDepth = snapshot.gridDepth;
  cellSize = snapshot.cellSize;
  wallHeight = snapshot.wallHeight;
  layoutName = snapshot.layoutName;

  grid = [];
  for (var z = 0; z < gridDepth; z++) {
    grid.push([...snapshot.grid[z]]);
  }

  walls = snapshot.walls.map(function(w) { return { ...w }; });
  doors = snapshot.doors.map(function(d) { return { ...d }; });
  pathways = snapshot.pathways.map(function(p) {
    return { ...p, waypoints: p.waypoints.map(function(wp) { return { ...wp }; }) };
  });

  nextWallId = snapshot.nextWallId;
  nextDoorId = snapshot.nextDoorId;
  nextPathwayId = snapshot.nextPathwayId;
}

// ---------------------------------------------------------------------------
// Default Layout — Coulter Forge Approximation
// ---------------------------------------------------------------------------

/**
 * Generate the default Coulter Forge layout configuration.
 * @returns {object} Layout config ready for loadLayout()
 */
export function getDefaultCoulterLayout() {
  return {
    name: 'coulter_current',
    gridWidth: 60,
    gridDepth: 80,
    cellSize: 1,
    wallHeight: 8,
    grid: null, // will use empty grid then apply walls/zones
    walls: [
      // Exterior walls
      { id: 'W-001', startX: 0,  startZ: 0,  endX: 59, endZ: 0,  height: 8 },
      { id: 'W-002', startX: 0,  startZ: 79, endX: 59, endZ: 79, height: 8 },
      { id: 'W-003', startX: 0,  startZ: 0,  endX: 0,  endZ: 79, height: 8 },
      { id: 'W-004', startX: 59, startZ: 0,  endX: 59, endZ: 79, height: 8 },
    ],
    doors: [
      { id: 'D-001', gridX: 15, gridZ: 0,  width: 6, type: 'rollup' },
      { id: 'D-002', gridX: 40, gridZ: 0,  width: 6, type: 'rollup' },
      { id: 'D-003', gridX: 15, gridZ: 79, width: 6, type: 'rollup' },
    ],
    pathways: [],
  };
}

/**
 * Generate a blank empty layout.
 * @returns {object} Layout config
 */
export function getEmptyLayout() {
  return {
    name: 'empty_60x80',
    gridWidth: 60,
    gridDepth: 80,
    cellSize: 1,
    wallHeight: 8,
    grid: null,
    walls: [
      { id: 'W-001', startX: 0,  startZ: 0,  endX: 59, endZ: 0,  height: 8 },
      { id: 'W-002', startX: 0,  startZ: 79, endX: 59, endZ: 79, height: 8 },
      { id: 'W-003', startX: 0,  startZ: 0,  endX: 0,  endZ: 79, height: 8 },
      { id: 'W-004', startX: 59, startZ: 0,  endX: 59, endZ: 79, height: 8 },
    ],
    doors: [],
    pathways: [],
  };
}