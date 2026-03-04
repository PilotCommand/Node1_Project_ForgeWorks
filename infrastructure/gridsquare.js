// ============================================================================
// gridsquare.js — World Coordinate System and Spatial Authority
// Forgeworks · Foundation · Tier 0
// ============================================================================
// THE foundational file. Every other file that needs to know "where am I",
// "can I go there", or "what occupies that cell" talks to gridsquare.
//
// Owns:
//   - The 2D grid array (XZ plane, each cell 1m × 1m)
//   - Cell states: empty, wall, door, zone:*, equipment:*
//   - Walls, doors, pathways as structural elements
//   - Passability rules per vehicle type
//   - A* pathfinding on the grid
//   - Grid ↔ world coordinate conversion
//   - Layout loading, saving, snapshot/restore
//   - Zone and layout definitions (Coulter default, empty)
//
// Does NOT own:
//   - Three.js, meshes, rendering (that's forgehousebuilder.js)
//   - Equipment specs or behavior (that's the equipment files)
//   - Movement execution (that's forgehousechanger.js)
//
// Imports: Nothing. This is a leaf dependency.
// Exports: Everything spatial.
// ============================================================================


// ---------------------------------------------------------------------------
// Zone Color Definitions (pure data — builder reads these for mesh colors)
// ---------------------------------------------------------------------------

// DEPRECATED — zone type definitions have moved to floorplan.js (ZONE_TYPES).
// This map is kept only for internal passability checks. Import from floorplan.js instead.
export var ZONE_COLORS = {
  'zone:storage_raw':         '#4499dd',
  'zone:storage_finished':    '#2266aa',
  'zone:storage_scrap':       '#1a4477',
  'zone:staging_inbound':     '#dd8833',
  'zone:staging_outbound':    '#ccaa22',
  'zone:heavy_machinery':     '#cc3344',
  'zone:heat_treatment':      '#ee5522',
  'zone:maintenance':         '#9966cc',
  'zone:office':              '#44aaaa',
  'zone:parking':             '#778899',
  'zone:pathway_forklift':    '#44bb66',
  'zone:pathway_manipulator': '#2d8a4e',
  'zone:pathway_personnel':   '#88cc44',
};


// ---------------------------------------------------------------------------
// Passability Rules — which cell states each vehicle type can traverse
// ---------------------------------------------------------------------------

var PASSABLE_STATES = {
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

var gridWidth = 60;
var gridDepth = 80;
var cellSize = 1;       // meters per cell edge
var wallHeight = 8;     // default wall height in meters
var layoutName = 'untitled';

// 2D array: grid[z][x] — each cell holds a string state.
// z = row (depth), x = column (width). Origin is top-left corner (0,0).
var grid = [];

// Structural elements — tracked separately for serialization and removal.
// These also stamp their footprints onto the grid array.
var walls = [];      // { id, startX, startZ, endX, endZ, height }
var doors = [];      // { id, gridX, gridZ, width, type }
var pathways = [];   // { id, name, type, waypoints: [{x,z}] }

// ID counters
var nextWallId = 1;
var nextDoorId = 1;
var nextPathwayId = 1;


// ---------------------------------------------------------------------------
// Grid Initialization
// ---------------------------------------------------------------------------

/**
 * Create an empty grid of the given dimensions.
 * Every cell starts as 'empty'.
 */
function initGrid(width, depth) {
  gridWidth = width;
  gridDepth = depth;
  grid = [];
  for (var z = 0; z < depth; z++) {
    var row = [];
    for (var x = 0; x < width; x++) {
      row.push('empty');
    }
    grid.push(row);
  }
}


// ---------------------------------------------------------------------------
// Dimension Getters
// ---------------------------------------------------------------------------

export function getGridWidth()  { return gridWidth; }
export function getGridDepth()  { return gridDepth; }
export function getCellSize()   { return cellSize; }
export function getWallHeight() { return wallHeight; }
export function getLayoutName() { return layoutName; }

export function setLayoutName(name) { layoutName = name; }


// ---------------------------------------------------------------------------
// Cell Access — Read and Write Individual Cells
// ---------------------------------------------------------------------------

/**
 * Get the state string of a single cell.
 * @param {number} x - Grid column
 * @param {number} z - Grid row
 * @returns {string|null} Cell state, or null if out of bounds
 */
export function getCell(x, z) {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridDepth) return null;
  return grid[z][x];
}

/**
 * Set the state of a single cell.
 * @returns {boolean} True if set successfully
 */
export function setCell(x, z, state) {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridDepth) return false;
  grid[z][x] = state;
  return true;
}

/**
 * Set a rectangular block of cells to the same state.
 * Coordinates are inclusive on all sides.
 * @returns {number} Number of cells changed
 */
export function setCellBlock(x1, z1, x2, z2, state) {
  var minX = Math.max(0, Math.min(x1, x2));
  var maxX = Math.min(gridWidth - 1, Math.max(x1, x2));
  var minZ = Math.max(0, Math.min(z1, z2));
  var maxZ = Math.min(gridDepth - 1, Math.max(z1, z2));

  var count = 0;
  for (var z = minZ; z <= maxZ; z++) {
    for (var x = minX; x <= maxX; x++) {
      grid[z][x] = state;
      count++;
    }
  }
  return count;
}

/**
 * Read the current states of all cells in a rectangular block.
 * Useful for undo: capture before overwriting.
 * @returns {Array<{x, z, state}>}
 */
export function getCellBlockStates(x1, z1, x2, z2) {
  var minX = Math.max(0, Math.min(x1, x2));
  var maxX = Math.min(gridWidth - 1, Math.max(x1, x2));
  var minZ = Math.max(0, Math.min(z1, z2));
  var maxZ = Math.min(gridDepth - 1, Math.max(z1, z2));

  var states = [];
  for (var z = minZ; z <= maxZ; z++) {
    for (var x = minX; x <= maxX; x++) {
      states.push({ x: x, z: z, state: grid[z][x] });
    }
  }
  return states;
}


// ---------------------------------------------------------------------------
// Cell Queries — Ask Questions About Cells
// ---------------------------------------------------------------------------

/**
 * Is a cell passable by a given vehicle type?
 */
export function isCellPassable(x, z, vehicleType) {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridDepth) return false;
  var state = grid[z][x];
  var allowed = PASSABLE_STATES[vehicleType || 'personnel'];
  if (!allowed) return false;
  return allowed.has(state);
}

/**
 * Is a rectangular footprint available for equipment placement?
 * Checks that all cells are non-wall, non-equipment.
 *
 * @param {number} x      - Left column
 * @param {number} z      - Top row
 * @param {number} width  - Footprint width in cells
 * @param {number} depth  - Footprint depth in cells
 * @returns {boolean}
 */
export function isCellAvailable(x, z, width, depth) {
  if (x < 0 || z < 0 || x + width > gridWidth || z + depth > gridDepth) return false;

  for (var dz = 0; dz < depth; dz++) {
    for (var dx = 0; dx < width; dx++) {
      var state = grid[z + dz][x + dx];
      if (state === 'wall' || state.startsWith('equipment:')) return false;
    }
  }
  return true;
}

/**
 * Reserve a rectangular footprint for a piece of equipment.
 * Stamps 'equipment:<id>' into each cell so nothing else can overlap.
 *
 * @param {string} equipmentId - Registry ID (e.g. 'FN-001')
 * @param {number} x
 * @param {number} z
 * @param {number} width
 * @param {number} depth
 * @returns {boolean} True if reservation succeeded
 */
export function reserveCells(equipmentId, x, z, width, depth) {
  if (!isCellAvailable(x, z, width, depth)) return false;
  var stamp = 'equipment:' + equipmentId;
  for (var dz = 0; dz < depth; dz++) {
    for (var dx = 0; dx < width; dx++) {
      grid[z + dz][x + dx] = stamp;
    }
  }
  return true;
}

/**
 * Release a rectangular footprint previously reserved by equipment.
 * Reverts cells back to 'empty'.
 *
 * @param {string} equipmentId - Registry ID to clear
 * @param {number} x
 * @param {number} z
 * @param {number} width
 * @param {number} depth
 */
export function releaseCells(equipmentId, x, z, width, depth) {
  var stamp = 'equipment:' + equipmentId;
  for (var dz = 0; dz < depth; dz++) {
    for (var dx = 0; dx < width; dx++) {
      var cx = x + dx;
      var cz = z + dz;
      if (cx >= 0 && cx < gridWidth && cz >= 0 && cz < gridDepth) {
        if (grid[cz][cx] === stamp) {
          grid[cz][cx] = 'empty';
        }
      }
    }
  }
}

/**
 * Find all cells matching an exact state string.
 * @returns {Array<{x, z}>}
 */
export function getCellsOfType(state) {
  var results = [];
  for (var z = 0; z < gridDepth; z++) {
    for (var x = 0; x < gridWidth; x++) {
      if (grid[z][x] === state) results.push({ x: x, z: z });
    }
  }
  return results;
}

/**
 * Find all cells whose state starts with a given prefix.
 * e.g. getZoneCells('zone:storage') matches storage_raw, storage_finished, etc.
 * @returns {Array<{x, z, state}>}
 */
export function getZoneCells(zonePrefix) {
  var results = [];
  for (var z = 0; z < gridDepth; z++) {
    for (var x = 0; x < gridWidth; x++) {
      if (grid[z][x].startsWith(zonePrefix)) {
        results.push({ x: x, z: z, state: grid[z][x] });
      }
    }
  }
  return results;
}

/**
 * Check if a specific cell is within grid bounds.
 */
export function inBounds(x, z) {
  return x >= 0 && x < gridWidth && z >= 0 && z < gridDepth;
}


// ---------------------------------------------------------------------------
// Coordinate Conversion — Grid ↔ World
// ---------------------------------------------------------------------------
// Grid coordinates are integer cell indices (column x, row z).
// World coordinates are floating-point meters on the XZ plane.
// Grid cell (0,0) occupies world area [0..cellSize, 0..cellSize].
// The center of cell (x,z) is at world (x*cellSize + cellSize/2, z*cellSize + cellSize/2).

/**
 * Convert grid cell to world position (center of cell, y = 0).
 */
export function gridToWorld(gridX, gridZ) {
  return {
    x: gridX * cellSize + cellSize / 2,
    y: 0,
    z: gridZ * cellSize + cellSize / 2,
  };
}

/**
 * Convert world position to grid cell (floor-based).
 */
export function worldToGrid(worldX, worldZ) {
  return {
    x: Math.floor(worldX / cellSize),
    z: Math.floor(worldZ / cellSize),
  };
}

/**
 * Get the world-space center of an equipment footprint.
 */
export function getFootprintCenter(gridX, gridZ, width, depth) {
  return {
    x: gridX * cellSize + (width * cellSize) / 2,
    y: 0,
    z: gridZ * cellSize + (depth * cellSize) / 2,
  };
}


// ---------------------------------------------------------------------------
// Walls — Structural Barriers
// ---------------------------------------------------------------------------

/**
 * Add a wall segment. Marks grid cells as 'wall'.
 * Walls are axis-aligned: either startX === endX (vertical) or startZ === endZ (horizontal).
 *
 * @returns {object} The wall record
 */
export function addWall(startX, startZ, endX, endZ, height) {
  var id = 'W-' + String(nextWallId).padStart(3, '0');
  nextWallId++;

  var wall = {
    id: id,
    startX: startX,
    startZ: startZ,
    endX: endX,
    endZ: endZ,
    height: height || wallHeight,
  };
  walls.push(wall);

  // Stamp wall cells onto grid
  stampWallCells(wall, 'wall');

  return wall;
}

/**
 * Remove a wall by ID. Reverts its grid cells to 'empty'.
 * @returns {boolean}
 */
export function removeWall(id) {
  var idx = -1;
  for (var i = 0; i < walls.length; i++) {
    if (walls[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return false;

  var wall = walls[idx];
  stampWallCells(wall, 'empty');
  walls.splice(idx, 1);
  return true;
}

/**
 * Get all wall records.
 * @returns {Array}
 */
export function getWalls() {
  return walls;
}

/** Internal: stamp a wall's cells to a given state */
function stampWallCells(wall, state) {
  if (wall.startX === wall.endX) {
    // Vertical wall
    var minZ = Math.min(wall.startZ, wall.endZ);
    var maxZ = Math.max(wall.startZ, wall.endZ);
    for (var z = minZ; z <= maxZ; z++) {
      if (inBounds(wall.startX, z)) grid[z][wall.startX] = state;
    }
  } else if (wall.startZ === wall.endZ) {
    // Horizontal wall
    var minX = Math.min(wall.startX, wall.endX);
    var maxX = Math.max(wall.startX, wall.endX);
    for (var x = minX; x <= maxX; x++) {
      if (inBounds(x, wall.startZ)) grid[wall.startZ][x] = state;
    }
  }
}


// ---------------------------------------------------------------------------
// Doors — Passable Gaps in Walls
// ---------------------------------------------------------------------------

/**
 * Add a door. Marks grid cells as 'door' (passable by all vehicle types).
 * @returns {object} The door record
 */
export function addDoor(gridX, gridZ, width, type) {
  var id = 'D-' + String(nextDoorId).padStart(3, '0');
  nextDoorId++;

  var door = {
    id: id,
    gridX: gridX,
    gridZ: gridZ,
    width: width || 4,
    type: type || 'rollup',
  };
  doors.push(door);

  // Stamp door cells (overwrite wall)
  for (var dx = 0; dx < door.width; dx++) {
    var cx = gridX + dx;
    if (inBounds(cx, gridZ)) grid[gridZ][cx] = 'door';
  }

  return door;
}

/**
 * Remove a door by ID. Reverts its cells to 'wall'.
 * @returns {boolean}
 */
export function removeDoor(id) {
  var idx = -1;
  for (var i = 0; i < doors.length; i++) {
    if (doors[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return false;

  var door = doors[idx];
  for (var dx = 0; dx < door.width; dx++) {
    var cx = door.gridX + dx;
    if (inBounds(cx, door.gridZ)) grid[door.gridZ][cx] = 'wall';
  }

  doors.splice(idx, 1);
  return true;
}

/**
 * Get all door records.
 * @returns {Array}
 */
export function getDoors() {
  return doors;
}


// ---------------------------------------------------------------------------
// Pathways — Named Routes for Mobile Equipment
// ---------------------------------------------------------------------------

/**
 * Add a named pathway. Stamps zone:pathway_<type> onto grid cells.
 * @returns {object} The pathway record
 */
export function addPathway(name, type, waypoints) {
  var id = 'R-' + String(nextPathwayId).padStart(3, '0');
  nextPathwayId++;

  var pathway = {
    id: id,
    name: name,
    type: type,
    waypoints: waypoints.map(function(wp) { return { x: wp.x, z: wp.z }; }),
  };
  pathways.push(pathway);

  // Stamp pathway cells
  var zoneType = 'zone:pathway_' + type;
  for (var i = 0; i < waypoints.length; i++) {
    var wp = waypoints[i];
    if (inBounds(wp.x, wp.z)) {
      var current = grid[wp.z][wp.x];
      // Only overwrite empty cells or other pathways
      if (current === 'empty' || current.startsWith('zone:pathway')) {
        grid[wp.z][wp.x] = zoneType;
      }
    }
  }

  return pathway;
}

/**
 * Remove a pathway by ID. Reverts its cells to 'empty'.
 * @returns {boolean}
 */
export function removePathway(id) {
  var idx = -1;
  for (var i = 0; i < pathways.length; i++) {
    if (pathways[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return false;

  var pathway = pathways[idx];
  for (var i = 0; i < pathway.waypoints.length; i++) {
    var wp = pathway.waypoints[i];
    if (inBounds(wp.x, wp.z)) grid[wp.z][wp.x] = 'empty';
  }

  pathways.splice(idx, 1);
  return true;
}

/**
 * Get all pathway records.
 * @returns {Array}
 */
export function getPathways() {
  return pathways;
}


// ---------------------------------------------------------------------------
// A* Pathfinding
// ---------------------------------------------------------------------------
// Finds the shortest grid path between two cells for a given vehicle type.
// 4-directional movement (no diagonals — vehicles drive on axes).
// Manhattan distance heuristic.

/**
 * Find a path from (fromX, fromZ) to (toX, toZ).
 *
 * @param {number} fromX
 * @param {number} fromZ
 * @param {number} toX
 * @param {number} toZ
 * @param {string} vehicleType - 'forklift', 'manipulator', 'personnel'
 * @returns {Array<{x, z}>|null} Ordered waypoints, or null if no path exists
 */
export function findPath(fromX, fromZ, toX, toZ, vehicleType) {
  // Bounds check
  if (!inBounds(fromX, fromZ) || !inBounds(toX, toZ)) return null;

  // Same cell — trivial path
  if (fromX === toX && fromZ === toZ) return [{ x: fromX, z: fromZ }];

  var vType = vehicleType || 'personnel';

  var openSet = [];
  var closedSet = new Set();

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

  var gScores = {};
  gScores[fromX + ',' + fromZ] = 0;

  var iterations = 0;
  var maxIterations = gridWidth * gridDepth * 2; // safety cap

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f score
    var currentIdx = 0;
    for (var i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[currentIdx].f) currentIdx = i;
    }
    var current = openSet[currentIdx];

    // Goal reached — reconstruct and return path
    if (current.x === toX && current.z === toZ) {
      return reconstructPath(current);
    }

    // Move from open to closed
    openSet.splice(currentIdx, 1);
    var currentKey = current.x + ',' + current.z;
    closedSet.add(currentKey);

    // 4 neighbors (N, S, W, E)
    var neighbors = [
      { x: current.x,     z: current.z - 1 },
      { x: current.x,     z: current.z + 1 },
      { x: current.x - 1, z: current.z     },
      { x: current.x + 1, z: current.z     },
    ];

    for (var n = 0; n < neighbors.length; n++) {
      var nb = neighbors[n];
      var nbKey = nb.x + ',' + nb.z;

      if (closedSet.has(nbKey)) continue;

      // Destination cell is always reachable (vehicle needs to reach the station)
      var isDestination = (nb.x === toX && nb.z === toZ);
      if (!isDestination && !isCellPassable(nb.x, nb.z, vType)) continue;
      if (isDestination && !inBounds(nb.x, nb.z)) continue;

      var tentativeG = current.g + 1;

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

      // Remove stale entry in open set if we found a better path
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

/** Manhattan distance heuristic */
function heuristic(ax, az, bx, bz) {
  return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** Walk parent links back to start, reverse to get start→end order */
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
// Layout Loading — Apply a layout configuration to the grid
// ---------------------------------------------------------------------------

/**
 * Load a layout configuration. Replaces the entire grid, walls, doors, pathways.
 *
 * @param {object} config — Layout configuration:
 *   { name, gridWidth, gridDepth, cellSize, wallHeight,
 *     grid: { cells: 2D array } (optional),
 *     walls: [...], doors: [...], pathways: [...] }
 */
export function loadLayout(config) {
  layoutName = config.name || 'untitled';
  cellSize = config.cellSize || 1;
  wallHeight = config.wallHeight || 8;

  // 1. Create blank grid
  initGrid(config.gridWidth || 60, config.gridDepth || 80);

  // 2. Restore cell states if provided (saved layout)
  if (config.grid && config.grid.cells) {
    for (var z = 0; z < gridDepth && z < config.grid.cells.length; z++) {
      for (var x = 0; x < gridWidth && x < config.grid.cells[z].length; x++) {
        grid[z][x] = config.grid.cells[z][x];
      }
    }
  }

  // 3. Load walls and stamp onto grid
  walls = [];
  nextWallId = 1;
  if (config.walls) {
    for (var w = 0; w < config.walls.length; w++) {
      var wallDef = config.walls[w];
      walls.push({
        id: wallDef.id,
        startX: wallDef.startX,
        startZ: wallDef.startZ,
        endX: wallDef.endX,
        endZ: wallDef.endZ,
        height: wallDef.height || wallHeight,
      });
      stampWallCells(wallDef, 'wall');

      var num = parseInt(String(wallDef.id).replace('W-', ''), 10);
      if (!isNaN(num) && num >= nextWallId) nextWallId = num + 1;
    }
  }

  // 4. Load doors and stamp onto grid (overwrite wall cells)
  doors = [];
  nextDoorId = 1;
  if (config.doors) {
    for (var d = 0; d < config.doors.length; d++) {
      var doorDef = config.doors[d];
      doors.push({
        id: doorDef.id,
        gridX: doorDef.gridX,
        gridZ: doorDef.gridZ,
        width: doorDef.width || 4,
        type: doorDef.type || 'rollup',
      });
      for (var dx = 0; dx < (doorDef.width || 4); dx++) {
        var cx = doorDef.gridX + dx;
        if (inBounds(cx, doorDef.gridZ)) grid[doorDef.gridZ][cx] = 'door';
      }

      var dnum = parseInt(String(doorDef.id).replace('D-', ''), 10);
      if (!isNaN(dnum) && dnum >= nextDoorId) nextDoorId = dnum + 1;
    }
  }

  // 5. Load pathways and stamp onto grid
  pathways = [];
  nextPathwayId = 1;
  if (config.pathways) {
    for (var p = 0; p < config.pathways.length; p++) {
      var pDef = config.pathways[p];
      var wps = pDef.waypoints
        ? pDef.waypoints.map(function(wp) { return { x: wp.x, z: wp.z }; })
        : [];
      pathways.push({
        id: pDef.id,
        name: pDef.name,
        type: pDef.type,
        waypoints: wps,
      });

      var pnum = parseInt(String(pDef.id).replace('R-', ''), 10);
      if (!isNaN(pnum) && pnum >= nextPathwayId) nextPathwayId = pnum + 1;
    }
  }

  console.log('gridsquare: layout loaded — "' + layoutName + '" (' + gridWidth + '×' + gridDepth + ')');
}


// ---------------------------------------------------------------------------
// Layout Saving — Serialize current grid state
// ---------------------------------------------------------------------------

/**
 * Serialize the complete grid state to a plain object (JSON-safe).
 * @returns {object}
 */
export function saveLayout() {
  var cellsCopy = [];
  for (var z = 0; z < gridDepth; z++) {
    cellsCopy.push(grid[z].slice());
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
      cells: cellsCopy,
    },
    walls: walls.map(function(w) {
      return { id: w.id, startX: w.startX, startZ: w.startZ, endX: w.endX, endZ: w.endZ, height: w.height };
    }),
    doors: doors.map(function(d) {
      return { id: d.id, gridX: d.gridX, gridZ: d.gridZ, width: d.width, type: d.type };
    }),
    pathways: pathways.map(function(p) {
      return {
        id: p.id, name: p.name, type: p.type,
        waypoints: p.waypoints.map(function(wp) { return { x: wp.x, z: wp.z }; }),
      };
    }),
  };
}

/** Alias — same as saveLayout */
export function getLayout() {
  return saveLayout();
}


// ---------------------------------------------------------------------------
// Snapshot / Restore — For Prediction Mode
// ---------------------------------------------------------------------------
// Takes a deep copy of all mutable state so we can revert after a simulation.

export function takeSnapshot() {
  var cellsCopy = [];
  for (var z = 0; z < gridDepth; z++) {
    cellsCopy.push(grid[z].slice());
  }

  return {
    gridWidth: gridWidth,
    gridDepth: gridDepth,
    cellSize: cellSize,
    wallHeight: wallHeight,
    layoutName: layoutName,
    grid: cellsCopy,
    walls: walls.map(function(w) {
      return { id: w.id, startX: w.startX, startZ: w.startZ, endX: w.endX, endZ: w.endZ, height: w.height };
    }),
    doors: doors.map(function(d) {
      return { id: d.id, gridX: d.gridX, gridZ: d.gridZ, width: d.width, type: d.type };
    }),
    pathways: pathways.map(function(p) {
      return {
        id: p.id, name: p.name, type: p.type,
        waypoints: p.waypoints.map(function(wp) { return { x: wp.x, z: wp.z }; }),
      };
    }),
    nextWallId: nextWallId,
    nextDoorId: nextDoorId,
    nextPathwayId: nextPathwayId,
  };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot || !snapshot.grid) {
    console.warn('gridsquare: invalid snapshot');
    return;
  }

  gridWidth = snapshot.gridWidth;
  gridDepth = snapshot.gridDepth;
  cellSize = snapshot.cellSize;
  wallHeight = snapshot.wallHeight;
  layoutName = snapshot.layoutName;

  grid = [];
  for (var z = 0; z < gridDepth; z++) {
    grid.push(snapshot.grid[z].slice());
  }

  walls = snapshot.walls.map(function(w) {
    return { id: w.id, startX: w.startX, startZ: w.startZ, endX: w.endX, endZ: w.endZ, height: w.height };
  });
  doors = snapshot.doors.map(function(d) {
    return { id: d.id, gridX: d.gridX, gridZ: d.gridZ, width: d.width, type: d.type };
  });
  pathways = snapshot.pathways.map(function(p) {
    return {
      id: p.id, name: p.name, type: p.type,
      waypoints: p.waypoints.map(function(wp) { return { x: wp.x, z: wp.z }; }),
    };
  });

  nextWallId = snapshot.nextWallId;
  nextDoorId = snapshot.nextDoorId;
  nextPathwayId = snapshot.nextPathwayId;
}


// ===========================================================================
// DEFAULT LAYOUT DEFINITIONS
// ===========================================================================
// These are pure data — the structural recipes for known forge layouts.
// loadLayout() consumes them. forgehousebuilder.js reads the resulting
// grid state to generate meshes.


/**
 * The Coulter Forge — default layout based on the real facility.
 * 60m wide × 80m deep. 4 exterior walls, 3 roll-up doors.
 */
export function getDefaultCoulterLayout() {
  return {
    name: 'coulter_current',
    gridWidth: 60,
    gridDepth: 80,
    cellSize: 1,
    wallHeight: 8,
    grid: null,
    walls: [
      { id: 'W-001', startX: 0,  startZ: 0,  endX: 59, endZ: 0,  height: 8 },  // North
      { id: 'W-002', startX: 0,  startZ: 79, endX: 59, endZ: 79, height: 8 },  // South
      { id: 'W-003', startX: 0,  startZ: 0,  endX: 0,  endZ: 79, height: 8 },  // West
      { id: 'W-004', startX: 59, startZ: 0,  endX: 59, endZ: 79, height: 8 },  // East
    ],
    doors: [
      { id: 'D-001', gridX: 15, gridZ: 0,  width: 6, type: 'rollup' },   // North dock 1
      { id: 'D-002', gridX: 40, gridZ: 0,  width: 6, type: 'rollup' },   // North dock 2
      { id: 'D-003', gridX: 15, gridZ: 79, width: 6, type: 'rollup' },   // South dock
    ],
    pathways: [],
  };
}

/**
 * Zone painting recipe for the Coulter layout.
 * Returns an array of { x1, z1, x2, z2, zone } blocks to apply via setCellBlock.
 * Separated from the layout config so callers can apply zones after loading.
 */
export function getCoulterZones() {
  return [
    // Staging areas near doors
    { x1: 13, z1: 1,  x2: 22, z2: 6,  zone: 'zone:staging_inbound' },
    { x1: 38, z1: 1,  x2: 47, z2: 6,  zone: 'zone:staging_outbound' },

    // Production zones
    { x1: 2,  z1: 10, x2: 20, z2: 35, zone: 'zone:heat_treatment' },
    { x1: 25, z1: 10, x2: 45, z2: 35, zone: 'zone:heavy_machinery' },

    // Storage zones
    { x1: 2,  z1: 40, x2: 15, z2: 55, zone: 'zone:storage_raw' },
    { x1: 40, z1: 40, x2: 57, z2: 55, zone: 'zone:storage_finished' },
    { x1: 2,  z1: 60, x2: 10, z2: 68, zone: 'zone:storage_scrap' },

    // Support zones
    { x1: 48, z1: 60, x2: 57, z2: 72, zone: 'zone:maintenance' },
    { x1: 48, z1: 73, x2: 57, z2: 77, zone: 'zone:office' },
    { x1: 2,  z1: 72, x2: 12, z2: 77, zone: 'zone:parking' },

    // Main forklift aisles (3 corridors)
    { x1: 20, z1: 1,  x2: 24, z2: 77, zone: 'zone:pathway_forklift' },
    { x1: 1,  z1: 36, x2: 58, z2: 39, zone: 'zone:pathway_forklift' },
    { x1: 35, z1: 1,  x2: 37, z2: 77, zone: 'zone:pathway_forklift' },

    // Personnel walkway
    { x1: 46, z1: 40, x2: 47, z2: 77, zone: 'zone:pathway_personnel' },
  ];
}

/**
 * Apply the Coulter zone painting to the current grid.
 * Call this after loadLayout(getDefaultCoulterLayout()).
 */
export function applyCoulterZones() {
  var zones = getCoulterZones();
  for (var i = 0; i < zones.length; i++) {
    var z = zones[i];
    setCellBlock(z.x1, z.z1, z.x2, z.z2, z.zone);
  }
}

/**
 * Blank empty layout — 60×80 with 4 walls, no doors, no zones.
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


// ===========================================================================
// DEFAULT EQUIPMENT DEFINITIONS
// ===========================================================================
// Pure data: what equipment the Coulter Forge has and where it goes.
// forgehousebuilder.js reads these to spawn equipment.
// Each entry has: name, type, gridX, gridZ, and spec overrides.

export function getCoulterEquipment() {
  return {
    furnaces: [
      { name: 'Main Gas Furnace',      gridX: 4,  gridZ: 12, specs: { maxTemp: 1300, heatingRate: 5, fuelType: 'gas',      maxContents: 6 } },
      { name: 'Electric Box Furnace',   gridX: 4,  gridZ: 20, specs: { maxTemp: 1200, heatingRate: 3, fuelType: 'electric',  maxContents: 4 } },
      { name: 'Preheat Furnace',        gridX: 12, gridZ: 12, specs: { maxTemp: 900,  heatingRate: 8, fuelType: 'gas',      maxContents: 8 } },
    ],
    presses: [
      { name: '2000T Hydraulic Press',  gridX: 27, gridZ: 12, specs: { tonnage: 2000, cycleTime: 8, pressType: 'hydraulic' } },
      { name: '800T Mechanical Press',  gridX: 27, gridZ: 22, specs: { tonnage: 800,  cycleTime: 5, pressType: 'mechanical' } },
    ],
    hammers: [
      { name: '5kJ Power Hammer',      gridX: 35, gridZ: 14, specs: { strikeEnergy: 5000, blowRate: 60 } },
    ],
    quenchTanks: [
      { name: 'Oil Quench Tank 1',     gridX: 12, gridZ: 28, specs: { quenchantType: 'oil',   tankVolume: 5000, capacity: 4 } },
      { name: 'Water Quench Tank',      gridX: 4,  gridZ: 28, specs: { quenchantType: 'water', tankVolume: 3000, capacity: 3 } },
    ],
    racks: [
      { name: 'Raw Stock Rack A',      gridX: 4,  gridZ: 42, specs: { rackType: 'raw_material',    capacityCount: 30, capacityWeight: 8000 } },
      { name: 'Raw Stock Rack B',      gridX: 8,  gridZ: 42, specs: { rackType: 'raw_material',    capacityCount: 30, capacityWeight: 8000 } },
      { name: 'Finished Rack A',       gridX: 42, gridZ: 42, specs: { rackType: 'finished_goods',  capacityCount: 40, capacityWeight: 10000 } },
      { name: 'Finished Rack B',       gridX: 48, gridZ: 42, specs: { rackType: 'finished_goods',  capacityCount: 40, capacityWeight: 10000 } },
      { name: 'Die Storage',           gridX: 50, gridZ: 60, specs: { rackType: 'die_storage',     capacityCount: 20, capacityWeight: 3000 } },
      { name: 'Scrap Bin',             gridX: 4,  gridZ: 62, specs: { rackType: 'scrap',           capacityCount: 50, capacityWeight: 15000 } },
    ],
    forklifts: [
      { name: 'Bay 1 Forklift',        gridX: 21, gridZ: 38, specs: { speed: 3 } },
      { name: 'Bay 2 Forklift',        gridX: 23, gridZ: 38, specs: { speed: 3 } },
    ],
    manipulators: [
      { name: 'Hot Handler 1',         gridX: 20, gridZ: 15, specs: { speed: 2, thermalTolerance: 1200 } },
      { name: 'Hot Handler 2',         gridX: 20, gridZ: 25, specs: { speed: 2, thermalTolerance: 1200 } },
    ],
    trucks: [
      { name: 'Inbound Truck 1',       truckType: 'flatbed', direction: 'inbound' },
      { name: 'Outbound Truck 1',      truckType: 'flatbed', direction: 'outbound' },
    ],
    tools: [
      { name: 'Shaft Die Set',         gridX: 51, gridZ: 61, specs: { weight: 200, compatibleEquipment: ['press', 'hammer'] } },
      { name: 'Flange Die Set',        gridX: 52, gridZ: 61, specs: { weight: 180, compatibleEquipment: ['press'] } },
    ],

    // Furnaces to preheat on startup (by array index → target temp)
    preheatTargets: [
      { index: 0, targetTemp: 1100 },   // Main Gas Furnace → 1100°C
      { index: 2, targetTemp: 850 },     // Preheat Furnace → 850°C
    ],
  };
}