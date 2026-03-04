// ============================================================================
// mode_build.js — Build Mode
// Forgeworks Infrastructure
// ============================================================================
// Handles placement and configuration of equipment on the forge floor.
//
// Cursor: yellow cylinder follows mouse on ground plane.
// Hover:  warm yellow highlight on grid cell under cursor.
// Click:  left-click selects a single grid cell.
// Drag:   left-click + drag draws a rectangular selection.
//         Only axis-aligned rectangles are possible.
//
// Imports: visualhud (scene, camera, renderer access)
// Exports: activate(), deactivate(), update()
// ============================================================================

import * as THREE from 'three';
import { getCamera, getRenderer, addToScene, removeFromScene, setRegistryData, setInfoContent, selectRegistryItem, setTransformContent, onTransformChange } from './visualhud.js';
import { setRotateEnabled, setPanEnabled } from './controls.js';
import { registerZone, unregisterZone, getAllZones, getZonesAtCell, ZONE_TYPES, ZONE_COLORS, getZoneLabel, getZoneColor, getZoneMenuItems } from './floorplan.js';
import { createFurnace } from '../static_equipment/static_furnace.js';
import { createPress } from '../static_equipment/static_press.js';
import { createHammer } from '../static_equipment/static_hammer.js';
import { createQuenchTank } from '../static_equipment/static_quench.js';
import { createRack } from '../static_equipment/static_racks.js';
import { createForklift } from '../mobile_equipment/mobile_forklift.js';
import { createManipulator } from '../mobile_equipment/mobile_manipulator.js';
import { createTruck } from '../mobile_equipment/mobile_trucks.js';
import { createTool } from '../mobile_equipment/mobile_tools.js';
import { createMetalPart } from '../production_entities/product_metalpart.js';
import * as builder from './forgehousebuilder.js';
import * as staticRegistry from '../static_equipment/static_registry.js';
import * as mobileRegistry from '../mobile_equipment/mobile_registry.js';
import * as productRegistry from '../production_entities/product_registry.js';

let active = false;

// Cursor preview mesh
let cursorMesh = null;
let cursorVerts = null; // vertical lines that face camera

// Grid highlights
let hoverHighlight = null;    // single-cell highlight under cursor
let dragPreviewMesh = null;   // live rectangle while dragging

// Drag state
let isDragging = false;
let dragStartCell = null;     // { x, z } grid cell where drag began
let currentCell = null;       // { x, z } grid cell under cursor right now

// Committed selections (array of rects, each with its own mesh)
let selections = [];          // [{ rect: {minX,minZ,maxX,maxZ}, mesh: THREE.Mesh }]

// Placed zones (persists across mode switches)
let zones = [];               // [{ id, rect, type, mesh }]  — id is from floorplan registry

// Auto-increment counters for placed object names
let placeCounters = {
  furnace: 1, press: 1, hammer: 1, quench: 1, rack: 1,
  forklift: 1, manipulator: 1, truck: 1, tool: 1, metalpart: 1,
};

// Zone colors and labels are imported from floorplan.js (single source of truth)

// Raycasting
let raycaster = new THREE.Raycaster();
let mouseVec = new THREE.Vector2();
let groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let intersectPoint = new THREE.Vector3();

// Bound listener references
let onMouseMoveBound = null;
let onMouseDownBound = null;
let onMouseUpBound = null;
let onContextMenuBound = null;
let onDblClickBound = null;

// Context menu
let contextMenu = null;
let contextMenuVisible = false;

// Build-mode object/zone selection
let buildSelectionHighlight = null;
let buildSelectedId = null;

// ---------------------------------------------------------------------------
// Activate / Deactivate
// ---------------------------------------------------------------------------

export function activate() {
  active = true;

  // Inject scrollbar theme styles (once)
  if (!document.getElementById('build-menu-styles')) {
    var style = document.createElement('style');
    style.id = 'build-menu-styles';
    style.textContent = [
      '.build-ctx-menu::-webkit-scrollbar { width: 6px; }',
      '.build-ctx-menu::-webkit-scrollbar-track { background: rgba(0, 10, 20, 0.4); border-radius: 3px; }',
      '.build-ctx-menu::-webkit-scrollbar-thumb { background: rgba(255, 204, 0, 0.3); border-radius: 3px; }',
      '.build-ctx-menu::-webkit-scrollbar-thumb:hover { background: rgba(255, 204, 0, 0.5); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // Disable left-click orbit and right-click pan — build mode owns both
  setRotateEnabled(false);
  setPanEnabled(false);

  // --- Cursor cylinder ---
  if (!cursorMesh) {
    var group = new THREE.Group();
    var radius = 0.25;
    var height = 1;
    var segments = 32;

    var geo = new THREE.CylinderGeometry(radius, radius, height, segments);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffcc00, transparent: true, opacity: 0.4, depthWrite: false,
    });
    group.add(new THREE.Mesh(geo, mat));

    // Top ring
    var ringPts = [];
    for (var i = 0; i <= segments; i++) {
      var a = (i / segments) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * radius, height / 2, Math.sin(a) * radius));
    }
    var ringMat = new THREE.LineBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8 });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat));

    // Bottom ring
    var botPts = [];
    for (var i = 0; i <= segments; i++) {
      var a = (i / segments) * Math.PI * 2;
      botPts.push(new THREE.Vector3(Math.cos(a) * radius, -height / 2, Math.sin(a) * radius));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(botPts), ringMat.clone()));

    // Two vertical lines (billboard to camera)
    var vertGeo = new THREE.BufferGeometry();
    vertGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      radius, -height / 2, 0, radius, height / 2, 0,
      -radius, -height / 2, 0, -radius, height / 2, 0,
    ], 3));
    cursorVerts = new THREE.LineSegments(vertGeo, ringMat.clone());
    group.add(cursorVerts);

    cursorMesh = group;
    cursorMesh.visible = false;
  }
  addToScene(cursorMesh);

  // --- Hover highlight (single cell) ---
  if (!hoverHighlight) {
    hoverHighlight = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xddee44, transparent: true, opacity: 0.4,
        depthWrite: false, side: THREE.DoubleSide,
      })
    );
    hoverHighlight.rotation.x = -Math.PI / 2;
    hoverHighlight.visible = false;
  }
  addToScene(hoverHighlight);

  // --- Drag preview rectangle ---
  if (!dragPreviewMesh) {
    dragPreviewMesh = makeSelectionMesh();
    dragPreviewMesh.visible = false;
  }
  addToScene(dragPreviewMesh);

  // Restore any previously committed selections
  for (var i = 0; i < selections.length; i++) {
    addToScene(selections[i].mesh);
  }

  // Zone meshes are always in the scene — no need to re-add

  // --- Event listeners ---
  var domEl = getRenderer().domElement;
  onMouseMoveBound = onMouseMove;
  onMouseDownBound = onMouseDown;
  onMouseUpBound = onMouseUp;
  onContextMenuBound = onContextMenu;
  onDblClickBound = onDblClick;
  domEl.addEventListener('mousemove', onMouseMoveBound);
  domEl.addEventListener('mousedown', onMouseDownBound);
  domEl.addEventListener('mouseup', onMouseUpBound);
  domEl.addEventListener('contextmenu', onContextMenuBound);
  domEl.addEventListener('dblclick', onDblClickBound);

  // --- Selection highlight (for click-to-inspect) ---
  if (!buildSelectionHighlight) {
    buildSelectionHighlight = createBuildSelectionHighlight();
    buildSelectionHighlight.visible = false;
  }
  addToScene(buildSelectionHighlight);

  // --- Transform panel change handler ---
  onTransformChange(handleTransformChange);

  // --- Context menu DOM ---
  if (!contextMenu) {
    contextMenu = buildContextMenuDOM();
  }
  // Ensure it's in the container
  var container = getRenderer().domElement.parentElement;
  if (container && !contextMenu.parentNode) {
    container.appendChild(contextMenu);
  }
  contextMenu.style.display = 'none';
  contextMenuVisible = false;
}

export function deactivate() {
  active = false;

  // Re-enable left-click orbit and right-click pan
  setRotateEnabled(true);
  setPanEnabled(true);

  if (cursorMesh) { cursorMesh.visible = false; removeFromScene(cursorMesh); }
  if (hoverHighlight) { hoverHighlight.visible = false; removeFromScene(hoverHighlight); }
  if (dragPreviewMesh) { dragPreviewMesh.visible = false; removeFromScene(dragPreviewMesh); }
  if (buildSelectionHighlight) { buildSelectionHighlight.visible = false; removeFromScene(buildSelectionHighlight); }

  // Clear build selection
  buildSelectedId = null;

  // Clear transform panel and unregister callback
  setTransformContent(null);
  onTransformChange(null);

  // Remove all committed selection meshes from scene (keep in array)
  for (var i = 0; i < selections.length; i++) {
    removeFromScene(selections[i].mesh);
  }

  // NOTE: zone meshes stay in the scene — they're part of the world, not the mode

  // Hide context menu
  hideContextMenu();

  isDragging = false;
  dragStartCell = null;

  var domEl = getRenderer() && getRenderer().domElement;
  if (domEl) {
    if (onMouseMoveBound) domEl.removeEventListener('mousemove', onMouseMoveBound);
    if (onMouseDownBound) domEl.removeEventListener('mousedown', onMouseDownBound);
    if (onMouseUpBound) domEl.removeEventListener('mouseup', onMouseUpBound);
    if (onContextMenuBound) domEl.removeEventListener('contextmenu', onContextMenuBound);
    if (onDblClickBound) domEl.removeEventListener('dblclick', onDblClickBound);
  }
  onMouseMoveBound = null;
  onMouseDownBound = null;
  onMouseUpBound = null;
  onContextMenuBound = null;
  onDblClickBound = null;
}

// ---------------------------------------------------------------------------
// Raycast helper — returns grid cell { x, z } or null
// ---------------------------------------------------------------------------

function raycastToGrid(event) {
  var renderer = getRenderer();
  var camera = getCamera();
  if (!renderer || !camera) return null;

  var rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseVec, camera);
  var hit = raycaster.ray.intersectPlane(groundPlane, intersectPoint);
  if (!hit) return null;

  return {
    x: Math.floor(intersectPoint.x),
    z: Math.floor(intersectPoint.z),
    worldX: intersectPoint.x,
    worldZ: intersectPoint.z,
  };
}

// ---------------------------------------------------------------------------
// Selection mesh helper — position and scale to cover a cell rectangle
// ---------------------------------------------------------------------------

function makeSelectionMesh() {
  var mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffcc00, transparent: true, opacity: 0.3,
      depthWrite: false, side: THREE.DoubleSide,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}

function positionRectMesh(mesh, r) {
  if (!mesh) return;
  var w = r.maxX - r.minX + 1;
  var h = r.maxZ - r.minZ + 1;
  mesh.scale.set(w, h, 1);
  mesh.position.set(
    r.minX + w / 2,
    0.03,
    r.minZ + h / 2
  );
}

function clearSelections() {
  for (var i = 0; i < selections.length; i++) {
    removeFromScene(selections[i].mesh);
  }
  selections = [];
}

// ---------------------------------------------------------------------------
// Mouse Events
// ---------------------------------------------------------------------------

function onMouseMove(event) {
  var cell = raycastToGrid(event);

  if (cell) {
    currentCell = cell;

    cursorMesh.position.set(cell.worldX, 0.5, cell.worldZ);
    cursorMesh.visible = true;

    if (!isDragging) {
      hoverHighlight.position.set(cell.x + 0.5, 0.02, cell.z + 0.5);
      hoverHighlight.visible = true;
    } else {
      hoverHighlight.visible = false;
    }

    // Live rectangle preview while dragging
    if (isDragging && dragStartCell) {
      var r = makeRect(dragStartCell, cell);
      positionRectMesh(dragPreviewMesh, r);
      dragPreviewMesh.visible = true;
    }
  } else {
    currentCell = null;
    cursorMesh.visible = false;
    hoverHighlight.visible = false;
  }
}

function onMouseDown(event) {
  if (event.button !== 0) return;

  // Close context menu if open
  if (contextMenuVisible) {
    hideContextMenu();
    return;
  }

  var cell = raycastToGrid(event);
  if (!cell) return;

  // If shift is NOT held, clear previous selections and any object selection
  if (!event.shiftKey) {
    clearSelections();
    clearBuildSelection();
  }

  isDragging = true;
  dragStartCell = { x: cell.x, z: cell.z };

  var r = makeRect(dragStartCell, cell);
  positionRectMesh(dragPreviewMesh, r);
  dragPreviewMesh.visible = true;
  hoverHighlight.visible = false;
}

function onMouseUp(event) {
  if (event.button !== 0) return;
  if (!isDragging || !dragStartCell) return;

  var endCell = currentCell || dragStartCell;
  var rect = makeRect(dragStartCell, endCell);

  // Check if this was a click (same cell, no drag)
  var isClick = (rect.minX === rect.maxX && rect.minZ === rect.maxZ);

  if (isClick) {
    // Try to select an object at this cell
    var selected = trySelectObjectAtCell(endCell.x, endCell.z, event);
    if (selected) {
      // Object found — don't commit a selection rectangle
      dragPreviewMesh.visible = false;
      isDragging = false;
      dragStartCell = null;
      return;
    }
  }

  // No object hit (or was a drag) — commit selection rectangle as before
  clearBuildSelection();

  var mesh = makeSelectionMesh();
  positionRectMesh(mesh, rect);
  mesh.visible = true;
  addToScene(mesh);
  selections.push({ rect: rect, mesh: mesh });

  // Hide drag preview
  dragPreviewMesh.visible = false;

  isDragging = false;
  dragStartCell = null;

  console.log('Selections:', selections.map(function(s) { return s.rect; }));
}

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------

var CONTEXT_MENU_ITEMS = [
  { id: 'place_object',    label: 'Place Object', submenu: [
    { id: 'place_stationary', label: 'Stationary Equipment', submenu: [
      { id: 'place_furnace',    label: 'Furnace' },
      { id: 'place_press',      label: 'Press' },
      { id: 'place_hammer',     label: 'Hammer' },
      { id: 'place_quench',     label: 'Quench Tank' },
      { id: 'place_rack',       label: 'Rack' },
    ]},
    { id: 'place_mobile', label: 'Mobile Machinery', submenu: [
      { id: 'place_forklift',     label: 'Forklift' },
      { id: 'place_manipulator',  label: 'Manipulator' },
      { id: 'place_truck',        label: 'Truck' },
      { id: 'place_tool',         label: 'Tool' },
    ]},
    { id: 'place_product', label: 'Working Product', submenu: [
      { id: 'place_metalpart',  label: 'Metal Part' },
    ]},
    { id: 'place_custom',  label: 'Custom Item' },
  ]},
  { id: 'divider' },
  { id: 'set_zone',       label: 'Set Zone', submenu: getZoneMenuItems() },
  { id: 'clear_selection', label: 'Clear Selection' },
];

function buildContextMenuDOM() {
  var menu = document.createElement('div');
  applyMenuStyle(menu);
  populateMenu(menu, CONTEXT_MENU_ITEMS);
  return menu;
}

function applyMenuStyle(el) {
  el.className = 'build-ctx-menu';
  Object.assign(el.style, {
    position: 'absolute',
    zIndex: '50',
    background: 'rgba(0, 15, 30, 0.92)',
    border: '1px solid rgba(255, 204, 0, 0.3)',
    borderRadius: '4px',
    padding: '4px 0',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', monospace",
    fontSize: '12px',
    backdropFilter: 'blur(6px)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
    minWidth: '170px',
    maxHeight: '400px',
    overflowY: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255, 204, 0, 0.3) rgba(0, 10, 20, 0.4)',
    display: 'none',
    pointerEvents: 'auto',
  });
}

function populateMenu(menu, items) {
  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    if (item.id === 'divider') {
      var divider = document.createElement('div');
      Object.assign(divider.style, {
        height: '1px',
        background: 'rgba(255, 204, 0, 0.15)',
        margin: '4px 0',
      });
      menu.appendChild(divider);
      continue;
    }

    var row = document.createElement('div');
    row.dataset.action = item.id;
    Object.assign(row.style, {
      padding: '6px 14px',
      color: '#c0d0c0',
      cursor: 'pointer',
      transition: 'background 0.1s, color 0.1s',
      letterSpacing: '0.5px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'relative',
    });

    var label = document.createElement('span');
    label.textContent = item.label;
    row.appendChild(label);

    // Submenu arrow indicator
    if (item.submenu) {
      var arrow = document.createElement('span');
      arrow.textContent = '▸';
      arrow.style.opacity = '0.5';
      arrow.style.marginLeft = '12px';
      row.appendChild(arrow);
    }

    row.addEventListener('mouseenter', (function(itm, rowEl) {
      return function() {
        // Highlight this row, reset siblings
        var siblings = rowEl.parentNode.children;
        for (var s = 0; s < siblings.length; s++) {
          if (siblings[s].style) {
            siblings[s].style.background = 'transparent';
            siblings[s].style.color = '#c0d0c0';
          }
        }
        rowEl.style.background = 'rgba(255, 204, 0, 0.15)';
        rowEl.style.color = '#ffcc00';
        if (itm.submenu) {
          showSubmenu(rowEl, itm.submenu, 1);
        } else {
          hideSubmenu();
        }
      };
    })(item, row));

    row.addEventListener('mouseleave', (function(itm, rowEl) {
      return function(e) {
        var related = e.relatedTarget;
        // Don't un-highlight if moving into a submenu
        for (var s = 0; s < activeSubmenus.length; s++) {
          if (activeSubmenus[s].el && activeSubmenus[s].el.contains(related)) return;
        }
        rowEl.style.background = 'transparent';
        rowEl.style.color = '#c0d0c0';
      };
    })(item, row));

    if (!item.submenu) {
      row.addEventListener('click', (function(action) {
        return function() {
          hideContextMenu();
          handleContextAction(action);
        };
      })(item.id));
    }

    menu.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Submenu — recursive, supports any depth
// ---------------------------------------------------------------------------

var activeSubmenus = [];  // stack of { el, parentRow } from outermost to innermost

function showSubmenu(parentRow, items, depth) {
  depth = depth || 1;

  // Close any submenus at this depth or deeper
  while (activeSubmenus.length >= depth) {
    var old = activeSubmenus.pop();
    if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }

  var sub = document.createElement('div');
  applyMenuStyle(sub);
  sub.style.display = 'block';

  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    if (item.id === 'divider') {
      var divider = document.createElement('div');
      Object.assign(divider.style, {
        height: '1px',
        background: 'rgba(255, 204, 0, 0.15)',
        margin: '4px 0',
      });
      sub.appendChild(divider);
      continue;
    }

    var row = document.createElement('div');
    row.dataset.action = item.id;
    Object.assign(row.style, {
      padding: '6px 14px',
      color: '#c0d0c0',
      cursor: 'pointer',
      transition: 'background 0.1s, color 0.1s',
      letterSpacing: '0.5px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    });

    var label = document.createElement('span');
    label.textContent = item.label;
    row.appendChild(label);

    if (item.submenu) {
      var arrow = document.createElement('span');
      arrow.textContent = '▸';
      arrow.style.opacity = '0.5';
      arrow.style.marginLeft = '12px';
      row.appendChild(arrow);
    }

    row.addEventListener('mouseenter', (function(itm, rowEl, d) {
      return function() {
        // Highlight this row
        var siblings = rowEl.parentNode.children;
        for (var s = 0; s < siblings.length; s++) {
          siblings[s].style.background = 'transparent';
          siblings[s].style.color = '#c0d0c0';
        }
        rowEl.style.background = 'rgba(255, 204, 0, 0.15)';
        rowEl.style.color = '#ffcc00';

        if (itm.submenu) {
          showSubmenu(rowEl, itm.submenu, d + 1);
        } else {
          // Close deeper submenus if hovering a leaf
          while (activeSubmenus.length > d) {
            var old = activeSubmenus.pop();
            if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
          }
        }
      };
    })(item, row, depth));

    if (!item.submenu) {
      row.addEventListener('click', (function(action) {
        return function() {
          hideContextMenu();
          handleContextAction(action);
        };
      })(item.id));
    }

    sub.appendChild(row);
  }

  // Position adjacent right, top-aligned to the parent menu panel
  var container = getRenderer().domElement.parentElement;
  if (!container) return;
  container.appendChild(sub);

  var parentMenuRect = parentRow.parentNode.getBoundingClientRect();
  var containerRect = container.getBoundingClientRect();
  var x = parentMenuRect.right - containerRect.left + 2;
  var y = parentMenuRect.top - containerRect.top;

  var subW = sub.offsetWidth;
  var subH = sub.offsetHeight;
  if (x + subW > containerRect.width) {
    x = parentMenuRect.left - containerRect.left - subW - 2;
  }
  if (y + subH > containerRect.height) {
    y = containerRect.height - subH - 4;
  }

  sub.style.left = x + 'px';
  sub.style.top = y + 'px';

  activeSubmenus.push({ el: sub, parentRow: parentRow });
}

function hideSubmenu() {
  while (activeSubmenus.length > 0) {
    var old = activeSubmenus.pop();
    if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }
}

function showContextMenu(screenX, screenY) {
  if (!contextMenu) return;
  var container = getRenderer().domElement.parentElement;
  if (!container) return;

  var rect = container.getBoundingClientRect();
  var x = screenX - rect.left;
  var y = screenY - rect.top;

  // Keep within container bounds
  contextMenu.style.display = 'block';
  var menuW = contextMenu.offsetWidth;
  var menuH = contextMenu.offsetHeight;
  if (x + menuW > rect.width) x = rect.width - menuW - 4;
  if (y + menuH > rect.height) y = rect.height - menuH - 4;
  if (x < 0) x = 4;
  if (y < 0) y = 4;

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenuVisible = true;
}

function hideContextMenu() {
  hideSubmenu();
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
  contextMenuVisible = false;
}

function handleContextAction(action) {
  console.log('Context action:', action, 'Selections:', selections.map(function(s) { return s.rect; }));

  if (action === 'clear_selection') {
    clearSelections();
    return;
  }

  // --- Zone clearing ---
  if (action === 'zone:clear') {
    if (selections.length === 0) return;
    for (var s = 0; s < selections.length; s++) {
      subtractFromZones(selections[s].rect);
    }
    clearSelections();
    pushZonesToRegistry();
    setInfoContent(null);
    selectRegistryItem(null);
    return;
  }

  if (action.indexOf('zone:') === 0 && ZONE_COLORS[action]) {
    if (selections.length === 0) return;

    var lastEntry = null;
    var lastRect = null;
    for (var i = 0; i < selections.length; i++) {
      var rect = selections[i].rect;

      // Subtract this rect from any existing zones it overlaps
      subtractFromZones(rect);

      // Register zone first to get ID, then create mesh with label
      var entry = registerZone(action, rect);
      var mesh = makeZoneMesh(rect, ZONE_COLORS[action], entry.id, action);
      addToScene(mesh);
      entry.meta.mesh = mesh;
      zones.push({ id: entry.id, rect: copyRect(rect), type: action, mesh: mesh, rotation: 0,
        baseW: rect.maxX - rect.minX + 1, baseH: rect.maxZ - rect.minZ + 1,
        area: (rect.maxX - rect.minX + 1) * (rect.maxZ - rect.minZ + 1) });
      lastEntry = entry;
      lastRect = rect;
    }

    clearSelections();
    pushZonesToRegistry();

    // Show the newly built zone in the information panel and highlight in registry
    if (lastEntry) {
      var w = lastRect.maxX - lastRect.minX + 1;
      var h = lastRect.maxZ - lastRect.minZ + 1;
      setInfoContent({
        type: 'zone',
        id: lastEntry.id,
        name: getZoneLabel(action),
        properties: [
          { label: 'Zone Type', value: action.replace('zone:', '') },
          { label: 'Origin', value: '(' + lastRect.minX + ', ' + lastRect.minZ + ')' },
          { label: 'Size', value: w + ' × ' + h },
          { label: 'Area', value: lastEntry.area + ' cells' },
        ],
        status: 'active',
      });
      selectRegistryItem(lastEntry.id);
    }

    console.log('Zones:', zones.map(function(z) { return z.id + ' ' + z.type + ' ' + JSON.stringify(z.rect); }));
    return;
  }

  // --- Object Placement ---
  if (action.indexOf('place_') === 0 && selections.length > 0) {
    var rect = selections[0].rect;
    var selW = rect.maxX - rect.minX + 1;
    var selH = rect.maxZ - rect.minZ + 1;

    // Compute center of the selection for placement
    var cx = Math.floor(rect.minX + selW / 2);
    var cz = Math.floor(rect.minZ + selH / 2);

    var placed = null; // { entry, category, type, infoProps }

    if (action === 'place_furnace') {
      var name = 'Furnace ' + placeCounters.furnace++;
      var entry = createFurnace(name, cx, cz, {});
      entry.mesh = builder.spawnFurnace(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'stationary', type: 'furnace', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Fuel', value: entry.specs.fuelType },
        { label: 'Max Temp', value: entry.specs.maxTemp + ' °C' },
        { label: 'Capacity', value: entry.specs.maxContents + ' parts' },
      ]};
    }
    else if (action === 'place_press') {
      var name = 'Press ' + placeCounters.press++;
      var entry = createPress(name, cx, cz, {});
      entry.mesh = builder.spawnPress(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'stationary', type: 'press', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Tonnage', value: entry.specs.tonnage + ' T' },
        { label: 'Type', value: entry.specs.pressType || 'hydraulic' },
        { label: 'Cycle Time', value: entry.specs.cycleTime + ' s' },
      ]};
    }
    else if (action === 'place_hammer') {
      var name = 'Hammer ' + placeCounters.hammer++;
      var entry = createHammer(name, cx, cz, {});
      entry.mesh = builder.spawnHammer(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'stationary', type: 'hammer', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Strike Energy', value: entry.specs.strikeEnergy + ' J' },
        { label: 'Blow Rate', value: entry.specs.blowRate + ' /min' },
      ]};
    }
    else if (action === 'place_quench') {
      var name = 'Quench Tank ' + placeCounters.quench++;
      var entry = createQuenchTank(name, cx, cz, {});
      entry.mesh = builder.spawnQuenchTank(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'stationary', type: 'quench', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Quenchant', value: entry.specs.quenchantType || 'oil' },
        { label: 'Volume', value: entry.specs.tankVolume + ' L' },
        { label: 'Capacity', value: entry.specs.capacity + ' parts' },
      ]};
    }
    else if (action === 'place_rack') {
      var name = 'Rack ' + placeCounters.rack++;
      var entry = createRack(name, cx, cz, {});
      entry.mesh = builder.spawnRack(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'stationary', type: 'rack', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Rack Type', value: entry.specs.rackType || 'general' },
        { label: 'Capacity', value: entry.specs.capacityCount + ' items' },
        { label: 'Weight Cap', value: entry.specs.capacityWeight + ' kg' },
      ]};
    }
    else if (action === 'place_forklift') {
      var name = 'Forklift ' + placeCounters.forklift++;
      var entry = createForklift(name, cx, cz, {});
      entry.mesh = builder.spawnForklift(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'mobile', type: 'forklift', infoProps: [
        { label: 'Home', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Load Cap', value: entry.specs.loadCapacity + ' kg' },
        { label: 'Speed', value: entry.specs.speed + ' m/s' },
      ]};
    }
    else if (action === 'place_manipulator') {
      var name = 'Manipulator ' + placeCounters.manipulator++;
      var entry = createManipulator(name, cx, cz, {});
      entry.mesh = builder.spawnManipulator(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'mobile', type: 'manipulator', infoProps: [
        { label: 'Home', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Grip Cap', value: entry.specs.gripCapacity + ' kg' },
        { label: 'Reach', value: entry.specs.armReach + ' m' },
        { label: 'Thermal', value: entry.specs.thermalTolerance + ' °C' },
      ]};
    }
    else if (action === 'place_truck') {
      var name = 'Truck ' + placeCounters.truck++;
      var entry = createTruck(name, 'flatbed', 'inbound', {});
      // Trucks register at (0,0) then are positioned via arrive(), place at selection center
      mobileRegistry.updateGridPosition(entry.id, cx, cz);
      entry.mesh = builder.spawnTruck(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'mobile', type: 'truck', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth },
        { label: 'Truck Type', value: entry.specs.truckType || 'flatbed' },
        { label: 'Direction', value: entry.specs.direction || 'inbound' },
      ]};
    }
    else if (action === 'place_tool') {
      var name = 'Tool ' + placeCounters.tool++;
      var entry = createTool(name, 'die', cx, cz, {});
      entry.mesh = builder.spawnTool(entry.id, cx, cz, entry.specs);
      placed = { entry: entry, category: 'mobile', type: 'tool', infoProps: [
        { label: 'Position', value: '(' + cx + ', ' + cz + ')' },
        { label: 'Tool Type', value: entry.specs.toolType || 'die' },
        { label: 'Weight', value: entry.specs.weight + ' kg' },
        { label: 'Material', value: entry.specs.material || 'H13' },
      ]};
    }
    else if (action === 'place_metalpart') {
      var dims = { length: 0.5, width: 0.3, height: 0.15 };
      var weight = 120;
      var entry = createMetalPart('4140', dims, weight, {
        state: 'raw_stored',
        location: null,
      });
      entry.mesh = builder.spawnMetalPart(entry.id, dims, true);
      // Position the mesh at the center of the selection
      if (entry.mesh) {
        entry.mesh.position.set(cx + 0.5, 0, cz + 0.5);
      }
      placed = { entry: entry, category: 'products', type: 'metalpart', infoProps: [
        { label: 'Material', value: entry.materialGrade || '4140' },
        { label: 'State', value: entry.state },
        { label: 'Weight', value: weight + ' kg' },
        { label: 'Dims', value: dims.length + ' × ' + dims.width + ' × ' + dims.height + ' m' },
      ]};
    }

    if (placed) {
      clearSelections();
      pushRegistryForCategory(placed.category);

      // Show in info panel
      var categoryLabel = placed.category === 'products' ? 'product' :
                          placed.category === 'mobile' ? 'mobile' : 'equipment';
      setInfoContent({
        type: categoryLabel,
        id: placed.entry.id,
        name: placed.entry.name || placed.entry.materialGrade || placed.entry.id,
        properties: placed.infoProps,
        status: placed.entry.status || placed.entry.state || 'idle',
      });
      selectRegistryItem(placed.entry.id);

      // Show in transform panel
      if (placed.type === 'metalpart' && placed.entry.mesh) {
        setTransformContent({
          id: placed.entry.id,
          name: placed.entry.materialGrade || placed.entry.id,
          x: cx,
          z: cz,
          rotation: 0,
          width: null,
          depth: null,
        });
      } else {
        setTransformContent({
          id: placed.entry.id,
          name: placed.entry.name || placed.entry.id,
          x: placed.entry.gridX != null ? placed.entry.gridX : cx,
          z: placed.entry.gridZ != null ? placed.entry.gridZ : cz,
          rotation: placed.entry.rotation || 0,
          width: placed.entry.gridWidth || null,
          depth: placed.entry.gridDepth || null,
        });
      }

      buildSelectedId = placed.entry.id;

      console.log('Placed:', placed.entry.id, placed.type, 'at', cx, cz);
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Build-mode Click-to-Select (objects via click, zones via double-click)
// ---------------------------------------------------------------------------

var STATIC_TYPES = { furnace: true, press: true, hammer: true, quench: true, rack: true };
var MOBILE_TYPES = { forklift: true, manipulator: true, truck: true, tool: true };

function createBuildSelectionHighlight() {
  var group = new THREE.Group();

  // Wireframe box
  var geo = new THREE.BoxGeometry(1, 1, 1);
  var edges = new THREE.EdgesGeometry(geo);
  var mat = new THREE.LineBasicMaterial({
    color: 0xffcc00, transparent: true, opacity: 0.6,
  });
  group.add(new THREE.LineSegments(edges, mat));

  // Ground glow
  var glowGeo = new THREE.PlaneGeometry(1, 1);
  var glowMat = new THREE.MeshBasicMaterial({
    color: 0xffcc00, transparent: true, opacity: 0.15,
    depthWrite: false, side: THREE.DoubleSide,
  });
  var glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.01;
  group.add(glow);

  return group;
}

function raycastToObjectBuild(event) {
  var renderer = getRenderer();
  var camera = getCamera();
  if (!renderer || !camera) return null;

  var rect = renderer.domElement.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseVec, camera);

  var sceneRoot = camera;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent;

  var intersects = raycaster.intersectObjects(sceneRoot.children, true);

  for (var i = 0; i < intersects.length; i++) {
    var obj = intersects[i].object;
    if (isOwnBuildMesh(obj)) continue;

    var current = obj;
    while (current) {
      if (current.userData && current.userData.registryId) {
        return {
          registryId: current.userData.registryId,
          registryType: current.userData.registryType,
        };
      }
      current = current.parent;
    }
  }

  return null;
}

function isOwnBuildMesh(obj) {
  var current = obj;
  while (current) {
    if (current === cursorMesh || current === hoverHighlight ||
        current === dragPreviewMesh || current === buildSelectionHighlight) return true;
    // Skip committed selection meshes
    for (var i = 0; i < selections.length; i++) {
      if (current === selections[i].mesh) return true;
    }
    // Skip zone meshes (we select zones via dblclick, not single click)
    for (var j = 0; j < zones.length; j++) {
      if (current === zones[j].mesh) return true;
    }
    current = current.parent;
  }
  return false;
}

function findProductNearCellBuild(gridX, gridZ) {
  var all = productRegistry.getAll();
  var bestDist = 1.5;
  var best = null;

  for (var i = 0; i < all.length; i++) {
    var entry = all[i];
    if (!entry.mesh) continue;

    var mx = entry.mesh.position.x;
    var mz = entry.mesh.position.z;
    var dx = mx - (gridX + 0.5);
    var dz = mz - (gridZ + 0.5);
    var dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }

  return best;
}

/**
 * Handle transform panel edits — move and rotate objects in the world.
 * Called by the transform panel when the user changes position or rotation.
 * @param {{ id: string, x: number, z: number, rotation: number }} data
 */
function handleTransformChange(data) {
  if (!data || !data.id) return;

  var id = data.id;
  var newX = data.x;
  var newZ = data.z;
  var newRot = data.rotation;

  // --- Try static equipment ---
  var staticEntry = staticRegistry.get(id);
  if (staticEntry) {
    // Update registry position and rotation
    staticRegistry.updateGridPosition(id, newX, newZ);
    staticRegistry.updateRotation(id, newRot);

    // Re-read entry (rotation may have swapped width/depth)
    staticEntry = staticRegistry.get(id);

    // Move the mesh
    if (staticEntry.mesh) {
      var w = staticEntry.gridWidth;
      var d = staticEntry.gridDepth;
      staticEntry.mesh.position.set(newX + w / 2, 0, newZ + d / 2);
      staticEntry.mesh.rotation.y = -newRot * Math.PI / 180;
    }

    // Update highlight
    positionBuildHighlightOnEquipment(staticEntry);

    // Refresh info panel position property
    refreshInfoPanelPosition(staticEntry);
    return;
  }

  // --- Try mobile equipment ---
  var mobileEntry = mobileRegistry.get(id);
  if (mobileEntry) {
    mobileRegistry.updateGridPosition(id, newX, newZ);
    mobileRegistry.updateRotation(id, newRot);

    mobileEntry = mobileRegistry.get(id);

    if (mobileEntry.mesh) {
      var w = mobileEntry.gridWidth;
      var d = mobileEntry.gridDepth;
      mobileEntry.mesh.position.set(newX + w / 2, 0, newZ + d / 2);
      mobileEntry.mesh.rotation.y = -newRot * Math.PI / 180;
    }

    // Update precise position for mobiles
    if (mobileEntry.specs) {
      mobileEntry.specs.preciseX = newX + 0.5;
      mobileEntry.specs.preciseZ = newZ + 0.5;
    }

    positionBuildHighlightOnEquipment(mobileEntry);
    refreshInfoPanelPosition(mobileEntry);
    return;
  }

  // --- Try product (metalpart) ---
  var productEntry = productRegistry.get(id);
  if (productEntry) {
    if (productEntry.mesh) {
      productEntry.mesh.position.set(newX + 0.5, 0, newZ + 0.5);
      productEntry.mesh.rotation.y = -newRot * Math.PI / 180;
    }

    positionBuildHighlightAtWorld(newX + 0.5, newZ + 0.5, 1.0, 0.6);
    return;
  }

  // --- Try zone ---
  for (var i = 0; i < zones.length; i++) {
    if (zones[i].id === id) {
      var zone = zones[i];
      var oldRot = zone.rotation || 0;

      // Determine effective dimensions based on rotation
      // baseW/baseH are the original (unrotated) dimensions
      var bw = zone.baseW || (zone.rect.maxX - zone.rect.minX + 1);
      var bh = zone.baseH || (zone.rect.maxZ - zone.rect.minZ + 1);

      // At 90 or 270, the grid footprint swaps
      var isSwapped = (newRot === 90 || newRot === 270);
      var wasSwapped = (oldRot === 90 || oldRot === 270);

      var effectiveW = isSwapped ? bh : bw;
      var effectiveH = isSwapped ? bw : bh;

      // Store new rotation
      zone.rotation = newRot;

      // Build new rect at the new origin with effective dimensions
      zone.rect = {
        minX: newX,
        minZ: newZ,
        maxX: newX + effectiveW - 1,
        maxZ: newZ + effectiveH - 1,
      };

      // Reposition and rotate zone mesh group
      if (zone.mesh) {
        var newCx = newX + effectiveW / 2;
        var newCz = newZ + effectiveH / 2;
        zone.mesh.position.set(newCx, 0, newCz);
        zone.mesh.rotation.y = -newRot * Math.PI / 180;
      }

      positionBuildHighlightOnRect(zone.rect);

      // Re-select to refresh the info and transform panels with new dimensions
      selectZoneInBuild(zone);
      return;
    }
  }
}

/**
 * Lightly refresh the info panel position after a transform change.
 * Does NOT re-render the transform panel (would destroy user input focus).
 */
function refreshInfoPanelPosition(entry) {
  if (!entry) return;

  var type = entry.type;
  var categoryLabel = STATIC_TYPES[type] ? 'equipment' :
                      MOBILE_TYPES[type] ? 'mobile' : 'product';

  var props = [
    { label: 'Position', value: '(' + entry.gridX + ', ' + entry.gridZ + ')' },
  ];
  if (entry.gridWidth !== undefined) {
    props.push({ label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth });
  }
  if (entry.rotation) {
    props.push({ label: 'Rotation', value: entry.rotation + '°' });
  }

  setInfoContent({
    type: categoryLabel,
    id: entry.id,
    name: entry.name || entry.id,
    properties: props,
    status: entry.status || 'idle',
  });
}

/**
 * Try to select an object at the given grid cell. Returns true if something was selected.
 */
function trySelectObjectAtCell(gridX, gridZ, event) {
  // 1. Try 3D raycast for direct mesh hit
  var objectHit = raycastToObjectBuild(event);
  if (objectHit) {
    var entry = null;
    var category = null;

    if (STATIC_TYPES[objectHit.registryType]) {
      entry = staticRegistry.get(objectHit.registryId);
      category = 'stationary';
    } else if (MOBILE_TYPES[objectHit.registryType]) {
      entry = mobileRegistry.get(objectHit.registryId);
      category = 'mobile';
    } else if (objectHit.registryType === 'metalpart') {
      entry = productRegistry.get(objectHit.registryId);
      category = 'products';
    }

    if (entry) {
      selectObjectInBuild(entry, category, objectHit.registryType);
      return true;
    }
  }

  // 2. Try static equipment at grid position
  var staticEntry = staticRegistry.getAtPosition(gridX, gridZ);
  if (staticEntry) {
    selectObjectInBuild(staticEntry, 'stationary', staticEntry.type);
    return true;
  }

  // 3. Try mobile equipment at grid position
  var mobileEntry = mobileRegistry.getAtPosition(gridX, gridZ);
  if (mobileEntry) {
    selectObjectInBuild(mobileEntry, 'mobile', mobileEntry.type);
    return true;
  }

  // 4. Try products near this cell
  var productEntry = findProductNearCellBuild(gridX, gridZ);
  if (productEntry) {
    selectObjectInBuild(productEntry, 'products', productEntry.type);
    return true;
  }

  return false;
}

function selectObjectInBuild(entry, category, type) {
  buildSelectedId = entry.id;

  var categoryLabel = category === 'products' ? 'product' :
                      category === 'mobile' ? 'mobile' : 'equipment';

  var infoData = {
    type: categoryLabel,
    id: entry.id,
    name: entry.name || entry.materialGrade || entry.id,
    properties: [],
    status: entry.status || entry.state || null,
  };

  // Common position
  if (entry.gridX !== undefined) {
    infoData.properties.push({ label: 'Position', value: '(' + entry.gridX + ', ' + entry.gridZ + ')' });
  }
  if (entry.gridWidth !== undefined) {
    infoData.properties.push({ label: 'Footprint', value: entry.gridWidth + ' × ' + entry.gridDepth });
  }

  // Type-specific
  if (type === 'furnace' && entry.specs) {
    infoData.properties.push({ label: 'Fuel', value: entry.specs.fuelType || '—' });
    infoData.properties.push({ label: 'Max Temp', value: entry.specs.maxTemp + ' °C' });
    if (entry.specs.currentTemp !== undefined) {
      infoData.properties.push({ label: 'Temp', value: Math.round(entry.specs.currentTemp) + ' °C' });
    }
    if (entry.specs.maxContents !== undefined) {
      var cur = entry.specs.contents ? entry.specs.contents.length : 0;
      infoData.properties.push({ label: 'Contents', value: cur + ' / ' + entry.specs.maxContents });
    }
  } else if (type === 'press' && entry.specs) {
    infoData.properties.push({ label: 'Tonnage', value: entry.specs.tonnage + ' T' });
    infoData.properties.push({ label: 'Type', value: entry.specs.pressType || '—' });
    infoData.properties.push({ label: 'Cycle Time', value: entry.specs.cycleTime + ' s' });
  } else if (type === 'hammer' && entry.specs) {
    infoData.properties.push({ label: 'Strike Energy', value: entry.specs.strikeEnergy + ' J' });
    infoData.properties.push({ label: 'Blow Rate', value: entry.specs.blowRate + ' /min' });
  } else if (type === 'quench' && entry.specs) {
    infoData.properties.push({ label: 'Quenchant', value: entry.specs.quenchantType || '—' });
    infoData.properties.push({ label: 'Volume', value: entry.specs.tankVolume + ' L' });
    if (entry.specs.currentTemp !== undefined) {
      infoData.properties.push({ label: 'Temp', value: Math.round(entry.specs.currentTemp) + ' °C' });
    }
  } else if (type === 'rack' && entry.specs) {
    infoData.properties.push({ label: 'Rack Type', value: entry.specs.rackType || '—' });
    var curCount = entry.specs.currentContents ? entry.specs.currentContents.length : 0;
    infoData.properties.push({ label: 'Occupancy', value: curCount + ' / ' + entry.specs.capacityCount });
    infoData.properties.push({ label: 'Weight Cap', value: entry.specs.capacityWeight + ' kg' });
  } else if (type === 'forklift' && entry.specs) {
    infoData.properties.push({ label: 'Load Cap', value: (entry.specs.loadCapacity || '—') + ' kg' });
    infoData.properties.push({ label: 'Speed', value: (entry.specs.speed || '—') + ' m/s' });
    if (entry.currentTask) {
      infoData.properties.push({ label: 'Task', value: entry.currentTask.action || 'assigned' });
    }
  } else if (type === 'manipulator' && entry.specs) {
    infoData.properties.push({ label: 'Reach', value: (entry.specs.armReach || '—') + ' m' });
    infoData.properties.push({ label: 'Grip Cap', value: (entry.specs.gripCapacity || '—') + ' kg' });
    infoData.properties.push({ label: 'Thermal', value: (entry.specs.thermalTolerance || '—') + ' °C' });
  } else if (type === 'truck' && entry.specs) {
    infoData.properties.push({ label: 'Truck Type', value: entry.specs.truckType || '—' });
    infoData.properties.push({ label: 'Direction', value: entry.specs.direction || '—' });
  } else if (type === 'tool' && entry.specs) {
    infoData.properties.push({ label: 'Tool Type', value: entry.specs.toolType || '—' });
    infoData.properties.push({ label: 'Weight', value: (entry.specs.weight || '—') + ' kg' });
    infoData.properties.push({ label: 'Material', value: entry.specs.material || '—' });
    infoData.properties.push({ label: 'Wear', value: Math.round((entry.specs.wearState || 1) * 100) + '%' });
  } else if (type === 'metalpart') {
    infoData.properties = [];
    infoData.properties.push({ label: 'Material', value: entry.materialGrade || '—' });
    infoData.properties.push({ label: 'State', value: entry.state || '—' });
    if (entry.mesh) {
      var p = entry.mesh.position;
      infoData.properties.push({ label: 'Position', value: '(' + Math.round(p.x) + ', ' + Math.round(p.z) + ')' });
    }
    if (entry.temperature !== undefined) {
      infoData.properties.push({ label: 'Temp', value: Math.round(entry.temperature) + ' °C' });
    }
    if (entry.weight !== undefined) {
      infoData.properties.push({ label: 'Weight', value: entry.weight + ' kg' });
    }
    if (entry.dimensions) {
      var d = entry.dimensions;
      infoData.properties.push({
        label: 'Dims',
        value: Math.round(d.length * 100) / 100 + ' × ' +
               Math.round(d.width * 100) / 100 + ' × ' +
               Math.round(d.height * 100) / 100 + ' m'
      });
    }
    if (entry.location) {
      infoData.properties.push({ label: 'Location', value: entry.location });
    }
  }

  setInfoContent(infoData);
  selectRegistryItem(entry.id);

  // Populate transform panel
  if (type === 'metalpart' && entry.mesh) {
    setTransformContent({
      id: entry.id,
      name: entry.name || entry.materialGrade || entry.id,
      x: Math.round(entry.mesh.position.x),
      z: Math.round(entry.mesh.position.z),
      rotation: 0,
      width: null,
      depth: null,
    });
  } else {
    setTransformContent({
      id: entry.id,
      name: entry.name || entry.id,
      x: entry.gridX != null ? entry.gridX : 0,
      z: entry.gridZ != null ? entry.gridZ : 0,
      rotation: entry.rotation || 0,
      width: entry.gridWidth || null,
      depth: entry.gridDepth || null,
    });
  }

  // Position highlight
  if (type === 'metalpart' && entry.mesh) {
    positionBuildHighlightAtWorld(entry.mesh.position.x, entry.mesh.position.z, 1.0, 0.6);
  } else if (entry.gridWidth !== undefined) {
    positionBuildHighlightOnEquipment(entry);
  }
}

function selectZoneInBuild(zone) {
  buildSelectedId = zone.id;

  var w = zone.rect.maxX - zone.rect.minX + 1;
  var h = zone.rect.maxZ - zone.rect.minZ + 1;

  setInfoContent({
    type: 'zone',
    id: zone.id,
    name: getZoneLabel(zone.type),
    properties: [
      { label: 'Zone Type', value: zone.type.replace('zone:', '') },
      { label: 'Origin', value: '(' + zone.rect.minX + ', ' + zone.rect.minZ + ')' },
      { label: 'Size', value: w + ' × ' + h },
      { label: 'Area', value: (zone.area || w * h) + ' cells' },
      { label: 'Rotation', value: (zone.rotation || 0) + '\u00b0' },
    ],
    status: 'active',
  });
  selectRegistryItem(zone.id);

  // Populate transform panel
  setTransformContent({
    id: zone.id,
    name: getZoneLabel(zone.type),
    x: zone.rect.minX,
    z: zone.rect.minZ,
    rotation: zone.rotation || 0,
    width: w,
    depth: h,
  });

  positionBuildHighlightOnRect(zone.rect);
}

function clearBuildSelection() {
  if (buildSelectedId) {
    buildSelectedId = null;
    setInfoContent(null);
    selectRegistryItem(null);
    setTransformContent(null);
  }
  if (buildSelectionHighlight) buildSelectionHighlight.visible = false;
}

function positionBuildHighlightOnEquipment(entry) {
  if (!buildSelectionHighlight) return;

  var w = entry.gridWidth;
  var h = entry.gridDepth;
  var cx = entry.gridX + w / 2;
  var cz = entry.gridZ + h / 2;
  var boxH = 2.5;

  var wireframe = buildSelectionHighlight.children[0];
  if (wireframe) {
    wireframe.scale.set(w + 0.15, boxH, h + 0.15);
    wireframe.position.set(cx, boxH / 2, cz);
  }
  var glow = buildSelectionHighlight.children[1];
  if (glow) {
    glow.scale.set(w + 0.3, h + 0.3, 1);
    glow.position.set(cx, 0.01, cz);
  }
  buildSelectionHighlight.visible = true;
}

function positionBuildHighlightOnRect(rect) {
  if (!buildSelectionHighlight) return;

  var w = rect.maxX - rect.minX + 1;
  var h = rect.maxZ - rect.minZ + 1;
  var cx = rect.minX + w / 2;
  var cz = rect.minZ + h / 2;

  var wireframe = buildSelectionHighlight.children[0];
  if (wireframe) {
    wireframe.scale.set(w + 0.1, 0.3, h + 0.1);
    wireframe.position.set(cx, 0.15, cz);
  }
  var glow = buildSelectionHighlight.children[1];
  if (glow) {
    glow.scale.set(w + 0.2, h + 0.2, 1);
    glow.position.set(cx, 0.01, cz);
  }
  buildSelectionHighlight.visible = true;
}

function positionBuildHighlightAtWorld(wx, wz, size, boxH) {
  if (!buildSelectionHighlight) return;

  var wireframe = buildSelectionHighlight.children[0];
  if (wireframe) {
    wireframe.scale.set(size, boxH, size);
    wireframe.position.set(wx, boxH / 2, wz);
  }
  var glow = buildSelectionHighlight.children[1];
  if (glow) {
    glow.scale.set(size + 0.2, size + 0.2, 1);
    glow.position.set(wx, 0.01, wz);
  }
  buildSelectionHighlight.visible = true;
}

function onDblClick(event) {
  if (event.button !== 0) return;

  var cell = raycastToGrid(event);
  if (!cell) return;

  // Double-click selects zones
  var zonesAtCell = getZonesAtCell(cell.x, cell.z);
  if (zonesAtCell.length > 0) {
    // Find the matching local zone entry (has rotation, baseW, baseH)
    var floorplanZone = zonesAtCell[0];
    var localZone = null;
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].id === floorplanZone.id) {
        localZone = zones[i];
        break;
      }
    }

    // Clear any committed selections (user is inspecting, not building)
    clearSelections();
    selectZoneInBuild(localZone || floorplanZone);
  }
}

// ---------------------------------------------------------------------------
// Zone Helpers
// ---------------------------------------------------------------------------

function makeZoneMesh(rect, colorHex, zoneId, zoneType) {
  var w = rect.maxX - rect.minX + 1;
  var h = rect.maxZ - rect.minZ + 1;
  var cx = rect.minX + w / 2;
  var cz = rect.minZ + h / 2;

  var group = new THREE.Group();

  // Position the group at the zone center — children use relative coords (0,0)
  group.position.set(cx, 0, cz);

  // --- Fill plane ---
  var geo = new THREE.PlaneGeometry(w, h);
  var mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  var fill = new THREE.Mesh(geo, mat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(0, 0.015, 0);
  group.add(fill);

  // --- Outline ---
  var hw = w / 2;
  var hh = h / 2;
  var outlinePts = [
    new THREE.Vector3(-hw, 0.02, -hh),
    new THREE.Vector3( hw, 0.02, -hh),
    new THREE.Vector3( hw, 0.02,  hh),
    new THREE.Vector3(-hw, 0.02,  hh),
    new THREE.Vector3(-hw, 0.02, -hh), // close the loop
  ];
  var outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
  var outlineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.7,
  });
  group.add(new THREE.Line(outlineGeo, outlineMat));

  // --- Label sprite ---
  var labelText = getZoneLabel(zoneType);
  if (zoneId) labelText += '  ' + zoneId;

  var label = makeZoneLabel(labelText, colorHex, w, h);
  label.position.set(0, 0.05, 0);
  group.add(label);

  return group;
}

function makeZoneLabel(text, colorHex, zoneW, zoneH) {
  var canvas = document.createElement('canvas');
  var fontSize = 42;
  var padding = 24;
  var ctx = canvas.getContext('2d');

  // Measure text width first to size the canvas
  ctx.font = 'bold ' + fontSize + 'px Consolas, SF Mono, Fira Code, monospace';
  var textWidth = ctx.measureText(text).width;
  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = 64;

  // Re-set font after resize (canvas resize clears state)
  ctx.font = 'bold ' + fontSize + 'px Consolas, SF Mono, Fira Code, monospace';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background pill
  ctx.fillStyle = 'rgba(0, 10, 20, 0.6)';
  roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 8);
  ctx.fill();

  // Text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colorHex;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  var texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  var spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: false,
  });
  var sprite = new THREE.Sprite(spriteMat);

  // Scale label proportional to its actual text width
  var aspect = canvas.width / canvas.height;
  var labelHeight = Math.min(zoneH * 0.5, 0.8);
  var labelWidth = labelHeight * aspect;

  // Clamp so it doesn't overflow the zone footprint
  if (labelWidth > zoneW * 0.95) {
    labelWidth = zoneW * 0.95;
    labelHeight = labelWidth / aspect;
  }

  sprite.scale.set(labelWidth, labelHeight, 1);

  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Subtract a rectangle from all existing zones.
 * Zones fully inside the cut rect are removed.
 * Zones partially overlapping are split into up to 4 remaining pieces.
 */
function subtractFromZones(cutRect) {
  var newZones = [];

  for (var i = zones.length - 1; i >= 0; i--) {
    var zone = zones[i];

    if (!rectsOverlap(zone.rect, cutRect)) {
      // No overlap — keep as-is
      continue;
    }

    // Unregister from floorplan registry and remove mesh
    unregisterZone(zone.id);
    removeFromScene(zone.mesh);
    zones.splice(i, 1);

    // Compute remaining rectangles after subtraction
    var pieces = subtractRect(zone.rect, cutRect);

    // Create new zone entries for each remaining piece
    for (var p = 0; p < pieces.length; p++) {
      var entry = registerZone(zone.type, pieces[p]);
      var mesh = makeZoneMesh(pieces[p], ZONE_COLORS[zone.type], entry.id, zone.type);
      addToScene(mesh);
      entry.meta.mesh = mesh;
      newZones.push({ id: entry.id, rect: pieces[p], type: zone.type, mesh: mesh, rotation: 0,
        baseW: pieces[p].maxX - pieces[p].minX + 1, baseH: pieces[p].maxZ - pieces[p].minZ + 1,
        area: (pieces[p].maxX - pieces[p].minX + 1) * (pieces[p].maxZ - pieces[p].minZ + 1) });
    }
  }

  // Add all new pieces back into the zones array
  for (var i = 0; i < newZones.length; i++) {
    zones.push(newZones[i]);
  }
}

/**
 * Subtract rect B from rect A, returning 0-4 remaining rectangles.
 *
 * Splits A into up to 4 strips:
 *   - Top strip:    full width of A, above B
 *   - Bottom strip: full width of A, below B
 *   - Left strip:   between top and bottom, to the left of B
 *   - Right strip:  between top and bottom, to the right of B
 */
function subtractRect(a, b) {
  var pieces = [];

  // Clamp B to the bounds of A
  var cMinX = Math.max(a.minX, b.minX);
  var cMaxX = Math.min(a.maxX, b.maxX);
  var cMinZ = Math.max(a.minZ, b.minZ);
  var cMaxZ = Math.min(a.maxZ, b.maxZ);

  // Top strip (full width, above the cut)
  if (a.minZ < cMinZ) {
    pieces.push({ minX: a.minX, minZ: a.minZ, maxX: a.maxX, maxZ: cMinZ - 1 });
  }

  // Bottom strip (full width, below the cut)
  if (a.maxZ > cMaxZ) {
    pieces.push({ minX: a.minX, minZ: cMaxZ + 1, maxX: a.maxX, maxZ: a.maxZ });
  }

  // Left strip (between top and bottom, left of cut)
  if (a.minX < cMinX) {
    pieces.push({ minX: a.minX, minZ: cMinZ, maxX: cMinX - 1, maxZ: cMaxZ });
  }

  // Right strip (between top and bottom, right of cut)
  if (a.maxX > cMaxX) {
    pieces.push({ minX: cMaxX + 1, minZ: cMinZ, maxX: a.maxX, maxZ: cMaxZ });
  }

  return pieces;
}

function rectsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function copyRect(r) {
  return { minX: r.minX, minZ: r.minZ, maxX: r.maxX, maxZ: r.maxZ };
}

function pushZonesToRegistry() {
  var items = [];
  for (var i = 0; i < zones.length; i++) {
    var z = zones[i];
    var w = z.rect.maxX - z.rect.minX + 1;
    var h = z.rect.maxZ - z.rect.minZ + 1;
    items.push({
      id: z.id,
      label: getZoneLabel(z.type),
      type: z.type.replace('zone:', ''),
      color: getZoneColor(z.type),
      status: 'active',
      properties: [
        { label: 'Zone Type', value: z.type.replace('zone:', '') },
        { label: 'Origin', value: '(' + z.rect.minX + ', ' + z.rect.minZ + ')' },
        { label: 'Size', value: w + ' × ' + h },
        { label: 'Area', value: (w * h) + ' cells' },
      ],
    });
  }
  setRegistryData('zones', items);
}

function pushRegistryForCategory(category) {
  if (category === 'stationary') {
    var all = staticRegistry.getAll();
    var items = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      items.push({
        id: e.id,
        label: e.name,
        type: e.type,
        status: e.status || 'idle',
        properties: [
          { label: 'Type', value: e.type },
          { label: 'Position', value: '(' + e.gridX + ', ' + e.gridZ + ')' },
          { label: 'Footprint', value: e.gridWidth + ' × ' + e.gridDepth },
        ],
      });
    }
    setRegistryData('stationary', items);
  }
  else if (category === 'mobile') {
    var all = mobileRegistry.getAll();
    var items = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      items.push({
        id: e.id,
        label: e.name,
        type: e.type,
        status: e.status || 'idle',
        properties: [
          { label: 'Type', value: e.type },
          { label: 'Position', value: '(' + e.gridX + ', ' + e.gridZ + ')' },
        ],
      });
    }
    setRegistryData('mobile', items);
  }
  else if (category === 'products') {
    var all = productRegistry.getAll();
    var items = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      items.push({
        id: e.id,
        label: (e.materialGrade || 'Part') + ' ' + e.id,
        type: 'metalpart',
        status: e.state || 'arriving',
        properties: [
          { label: 'Material', value: e.materialGrade || '—' },
          { label: 'State', value: e.state || '—' },
          { label: 'Weight', value: (e.weight || 0) + ' kg' },
        ],
      });
    }
    setRegistryData('products', items);
  }
}

function onContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event.clientX, event.clientY);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function makeRect(a, b) {
  return {
    minX: Math.min(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxX: Math.max(a.x, b.x),
    maxZ: Math.max(a.z, b.z),
  };
}

// ---------------------------------------------------------------------------
// Per-frame Update
// ---------------------------------------------------------------------------

export function update(dt) {
  if (!active) return;

  // Rotate vertical lines to face camera
  if (cursorVerts && cursorMesh && cursorMesh.visible) {
    var camera = getCamera();
    if (camera) {
      var camPos = camera.position;
      var meshPos = cursorMesh.position;
      var angle = Math.atan2(camPos.x - meshPos.x, camPos.z - meshPos.z);
      cursorVerts.rotation.y = angle;
    }
  }

  // Pulse selection highlight
  if (buildSelectionHighlight && buildSelectionHighlight.visible) {
    var t = performance.now() * 0.003;
    var pulse = 0.45 + Math.sin(t) * 0.15;

    var wireframe = buildSelectionHighlight.children[0];
    if (wireframe && wireframe.material) {
      wireframe.material.opacity = pulse + 0.15;
    }
    var glow = buildSelectionHighlight.children[1];
    if (glow && glow.material) {
      glow.material.opacity = pulse * 0.25;
    }
  }
}