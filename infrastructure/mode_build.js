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
import { getCamera, getRenderer, addToScene, removeFromScene } from './visualhud.js';
import { setRotateEnabled, setPanEnabled } from './controls.js';

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
  { id: 'set_zone',       label: 'Set Zone', submenu: [
    { id: 'zone:storage_raw',         label: 'Storage — Raw' },
    { id: 'zone:storage_finished',    label: 'Storage — Finished' },
    { id: 'zone:storage_scrap',       label: 'Storage — Scrap' },
    { id: 'divider' },
    { id: 'zone:staging_inbound',     label: 'Staging — Inbound' },
    { id: 'zone:staging_outbound',    label: 'Staging — Outbound' },
    { id: 'divider' },
    { id: 'zone:heavy_machinery',     label: 'Heavy Machinery' },
    { id: 'zone:heat_treatment',      label: 'Heat Treatment' },
    { id: 'zone:maintenance',         label: 'Maintenance' },
    { id: 'divider' },
    { id: 'zone:pathway_forklift',    label: 'Pathway — Forklift' },
    { id: 'zone:pathway_manipulator', label: 'Pathway — Manipulator' },
    { id: 'zone:pathway_personnel',   label: 'Pathway — Personnel' },
    { id: 'divider' },
    { id: 'zone:office',              label: 'Office' },
    { id: 'zone:parking',             label: 'Parking' },
    { id: 'divider' },
    { id: 'zone:clear',               label: 'Clear Zone' },
  ]},
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
  }

  // Other actions will be wired up later
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