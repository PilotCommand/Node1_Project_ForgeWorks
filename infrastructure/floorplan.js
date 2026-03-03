// ============================================================================
// floorplan.js — DEPRECATED: Re-exports from gridsquare.js
// ============================================================================
// This file exists only for backward compatibility. All spatial logic has
// moved to infrastructure/gridsquare.js. Import from gridsquare directly.
//
// Mesh building functions (buildFloorMesh, buildWallMeshes, etc.) have moved
// to infrastructure/forgehousebuilder.js and are NOT re-exported here.
// ============================================================================

export {
  // Grid dimensions & cell access
  getGridWidth,
  getGridDepth,
  getCellSize,
  getWallHeight,
  getCell,
  setCell,
  setCellBlock,
  getCellBlockStates,
  isCellPassable,
  isCellAvailable,
  getCellsOfType,
  getZoneCells,

  // Coordinate conversion
  gridToWorld,
  worldToGrid,

  // Layout management
  loadLayout,
  saveLayout,
  getLayout,
  getLayoutName,
  setLayoutName,
  getDefaultCoulterLayout,
  getEmptyLayout,

  // Walls, doors, pathways
  addWall,
  removeWall,
  getWalls,
  addDoor,
  removeDoor,
  getDoors,
  addPathway,
  removePathway,
  getPathways,

  // Pathfinding
  findPath,

  // Snapshot / restore
  takeSnapshot,
  restoreSnapshot,

  // Zone colors
  ZONE_COLORS,
} from './gridsquare.js';