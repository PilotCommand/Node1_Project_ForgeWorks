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
import { getCamera, getRenderer, addToScene, removeFromScene, setRegistryData } from './visualhud.js';
import { setRotateEnabled, setPanEnabled } from './controls.js';
import { registerZone, unregisterZone, getAllZones, ZONE_TYPES, ZONE_COLORS, getZoneLabel, getZoneColor, getZoneMenuItems } from './floorplan.js';

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

// Context menu
let contextMenu = null;
let contextMenuVisible = false;

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
  domEl.addEventListener('mousemove', onMouseMoveBound);
  domEl.addEventListener('mousedown', onMouseDownBound);
  domEl.addEventListener('mouseup', onMouseUpBound);
  domEl.addEventListener('contextmenu', onContextMenuBound);

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
  }
  onMouseMoveBound = null;
  onMouseDownBound = null;
  onMouseUpBound = null;
  onContextMenuBound = null;
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

  // If shift is NOT held, clear previous selections
  if (!event.shiftKey) {
    clearSelections();
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

  // Commit: create a new mesh for this selection
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
    return;
  }

  if (action.indexOf('zone:') === 0 && ZONE_COLORS[action]) {
    if (selections.length === 0) return;

    for (var i = 0; i < selections.length; i++) {
      var rect = selections[i].rect;

      // Subtract this rect from any existing zones it overlaps
      subtractFromZones(rect);

      // Register zone first to get ID, then create mesh with label
      var entry = registerZone(action, rect);
      var mesh = makeZoneMesh(rect, ZONE_COLORS[action], entry.id, action);
      addToScene(mesh);
      entry.meta.mesh = mesh;
      zones.push({ id: entry.id, rect: copyRect(rect), type: action, mesh: mesh });
    }

    clearSelections();
    pushZonesToRegistry();
    console.log('Zones:', zones.map(function(z) { return z.id + ' ' + z.type + ' ' + JSON.stringify(z.rect); }));
    return;
  }

  // Other actions (place_*, etc.) will be wired up later
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
  fill.position.set(cx, 0.015, cz);
  group.add(fill);

  // --- Outline ---
  var hw = w / 2;
  var hh = h / 2;
  var outlinePts = [
    new THREE.Vector3(cx - hw, 0.02, cz - hh),
    new THREE.Vector3(cx + hw, 0.02, cz - hh),
    new THREE.Vector3(cx + hw, 0.02, cz + hh),
    new THREE.Vector3(cx - hw, 0.02, cz + hh),
    new THREE.Vector3(cx - hw, 0.02, cz - hh), // close the loop
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
  label.position.set(cx, 0.05, cz);
  group.add(label);

  return group;
}

function makeZoneLabel(text, colorHex, zoneW, zoneH) {
  var canvas = document.createElement('canvas');
  var fontSize = 42;
  canvas.width = 512;
  canvas.height = 64;
  var ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background pill
  ctx.fillStyle = 'rgba(0, 10, 20, 0.6)';
  roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 8);
  ctx.fill();

  // Text
  ctx.font = 'bold ' + fontSize + 'px Consolas, SF Mono, Fira Code, monospace';
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

  // Scale label to fit within zone, with a sensible max
  var labelScale = Math.min(zoneW * 0.9, 6);
  sprite.scale.set(labelScale, labelScale * (canvas.height / canvas.width), 1);

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
      newZones.push({ id: entry.id, rect: pieces[p], type: zone.type, mesh: mesh });
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
    items.push({
      id: z.id,
      label: getZoneLabel(z.type),
      type: z.type.replace('zone:', ''),
      color: getZoneColor(z.type),
    });
  }
  setRegistryData('zones', items);
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
}