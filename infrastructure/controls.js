// ============================================================================
// controls.js — Camera Navigation Controller
// Forgeworks · Infrastructure · Tier 1 Leaf Dependency
// ============================================================================
// Manages all 3D camera interaction: orbiting, panning, zooming, and
// programmatic camera movement (flyTo, resetView). Separated from visualhud
// to keep input handling clean and extensible.
//
// Default view: top-down (bird's-eye blueprint view of the forge floor).
// Left-click drag: orbit. Right-click drag: pan. Scroll: zoom.
//
// Imports: Nothing (leaf dependency — receives camera/DOM via initControls)
// Exports: Camera control functions, flyTo animation, view reset
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let camera = null;
let orbitControls = null;
let domElement = null;

// Default positions (set during init based on grid dimensions)
let defaultTarget = new THREE.Vector3(30, 0, 40);
let defaultPosition = new THREE.Vector3(30, 60, 40);

// Configuration
const config = {
  minDistance: 5,
  maxDistance: 150,
  minPolarAngle: 0,                        // allow straight-down view
  maxPolarAngle: Math.PI / 2 - 0.05,      // prevent going below floor
  panSpeed: 1.0,
  rotateSpeed: 0.8,
  zoomSpeed: 1.2,
  enableDamping: true,
  dampingFactor: 0.08,
};

// Pan bounds (restrict panning to forge floor area)
let panBounds = null; // { minX, maxX, minZ, maxZ } or null for unlimited

// FlyTo animation state
let flyAnimation = null;
// {
//   startPosition: Vector3,
//   startTarget: Vector3,
//   endPosition: Vector3,
//   endTarget: Vector3,
//   duration: number (seconds),
//   elapsed: number (seconds),
//   onComplete: function or null
// }

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Create and configure OrbitControls. Positions camera in top-down view
 * centered over the grid.
 *
 * @param {THREE.PerspectiveCamera} cam - The scene camera
 * @param {HTMLElement} dom - The renderer's DOM element (for event binding)
 * @param {number} gridWidth - Grid width in meters (X axis)
 * @param {number} gridDepth - Grid depth in meters (Z axis)
 */
export function initControls(cam, dom, gridWidth, gridDepth) {
  camera = cam;
  domElement = dom;

  // Calculate default positions — camera centered on grid origin (0,0,0)
  const maxDim = Math.max(gridWidth, gridDepth);
  const cameraHeight = maxDim * 0.85; // high enough to see the whole floor

  defaultTarget = new THREE.Vector3(0, 0, 0);
  defaultPosition = new THREE.Vector3(0, cameraHeight, 0);

  // Position camera top-down
  camera.position.copy(defaultPosition);
  camera.lookAt(defaultTarget);

  // Create OrbitControls
  orbitControls = new OrbitControls(camera, domElement);

  // Set the orbit target (the point the camera rotates around)
  orbitControls.target.copy(defaultTarget);

  // Mouse button mapping
  orbitControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };

  // Zoom limits
  orbitControls.minDistance = config.minDistance;
  orbitControls.maxDistance = config.maxDistance;

  // Polar angle limits (vertical rotation)
  orbitControls.minPolarAngle = config.minPolarAngle;
  orbitControls.maxPolarAngle = config.maxPolarAngle;

  // Interaction speeds
  orbitControls.panSpeed = config.panSpeed;
  orbitControls.rotateSpeed = config.rotateSpeed;
  orbitControls.zoomSpeed = config.zoomSpeed;

  // Damping (inertia for smooth movement)
  orbitControls.enableDamping = config.enableDamping;
  orbitControls.dampingFactor = config.dampingFactor;

  // Pan parallel to screen plane, not ground plane
  orbitControls.screenSpacePanning = true;

  // No pan bounds — infinite grid
  // setPanBounds() can be called later if needed

  // Force an initial update
  orbitControls.update();
}

// ---------------------------------------------------------------------------
// Frame Update — Called Every Frame in the Render Loop
// ---------------------------------------------------------------------------

/**
 * Update controls. Must be called every frame for damping to work
 * and for flyTo animations to advance.
 *
 * @param {number} [realDeltaSec] - Real (wall clock) seconds since last frame.
 *                                   Required for flyTo animation timing.
 */
export function update(realDeltaSec) {
  if (!orbitControls) return;

  // Advance flyTo animation if active
  if (flyAnimation) {
    advanceFlyAnimation(realDeltaSec || 0.016);
  }

  // Enforce pan bounds after OrbitControls processes user input
  if (panBounds) {
    enforcePanBounds();
  }

  // Required for damping
  orbitControls.update();
}

// ---------------------------------------------------------------------------
// View Reset
// ---------------------------------------------------------------------------

/**
 * Smoothly return the camera to the default top-down position.
 * Uses flyTo animation internally.
 */
export function resetView() {
  flyTo(defaultTarget.x, defaultTarget.y, defaultTarget.z, defaultPosition.y);
}

// ---------------------------------------------------------------------------
// FlyTo — Smooth Camera Animation
// ---------------------------------------------------------------------------

/**
 * Smoothly animate the camera to look at a specific world position.
 * User input is suppressed during the animation.
 *
 * @param {number} targetX - World X to look at
 * @param {number} targetY - World Y to look at (usually 0 for ground-level)
 * @param {number} targetZ - World Z to look at
 * @param {number} [distance=15] - How far the camera should be from the target
 * @param {number} [duration=0.8] - Animation duration in seconds
 * @param {function} [onComplete] - Optional callback when animation finishes
 */
export function flyTo(targetX, targetY, targetZ, distance = 15, duration = 0.8, onComplete = null) {
  if (!camera || !orbitControls) return;

  // Disable user input during animation
  orbitControls.enabled = false;

  // Calculate end camera position: above and slightly offset from target
  // Use current camera direction projected onto XZ plane for approach angle,
  // or default to straight above if camera is already top-down
  const currentDir = new THREE.Vector3();
  currentDir.subVectors(camera.position, orbitControls.target).normalize();

  // If nearly top-down, keep it top-down for the destination
  const isTopDown = Math.abs(currentDir.y) > 0.95;

  let endPosition;
  if (isTopDown) {
    // Fly to a top-down view above the target
    endPosition = new THREE.Vector3(targetX, distance, targetZ);
  } else {
    // Fly to an angled view preserving the current viewing angle
    const horizontalDist = distance * Math.sin(orbitControls.getPolarAngle());
    const verticalDist = distance * Math.cos(orbitControls.getPolarAngle());
    const azimuth = orbitControls.getAzimuthalAngle();

    endPosition = new THREE.Vector3(
      targetX + horizontalDist * Math.sin(azimuth),
      targetY + verticalDist,
      targetZ + horizontalDist * Math.cos(azimuth)
    );
  }

  const endTarget = new THREE.Vector3(targetX, targetY, targetZ);

  flyAnimation = {
    startPosition: camera.position.clone(),
    startTarget: orbitControls.target.clone(),
    endPosition,
    endTarget,
    duration: Math.max(duration, 0.1),
    elapsed: 0,
    onComplete,
  };
}

/**
 * Cancel any in-progress flyTo animation and re-enable user controls.
 */
export function cancelFly() {
  if (flyAnimation) {
    flyAnimation = null;
    if (orbitControls) {
      orbitControls.enabled = true;
    }
  }
}

/**
 * Check if a flyTo animation is currently in progress.
 * @returns {boolean}
 */
export function isFlying() {
  return flyAnimation !== null;
}

// ---------------------------------------------------------------------------
// FlyTo Animation — Internal
// ---------------------------------------------------------------------------

function advanceFlyAnimation(deltaSec) {
  if (!flyAnimation) return;

  flyAnimation.elapsed += deltaSec;
  const t = Math.min(flyAnimation.elapsed / flyAnimation.duration, 1.0);

  // Smooth ease-in-out curve (cubic)
  const eased = smoothstep(t);

  // Lerp camera position
  camera.position.lerpVectors(
    flyAnimation.startPosition,
    flyAnimation.endPosition,
    eased
  );

  // Lerp orbit target
  orbitControls.target.lerpVectors(
    flyAnimation.startTarget,
    flyAnimation.endTarget,
    eased
  );

  // Animation complete
  if (t >= 1.0) {
    const callback = flyAnimation.onComplete;
    flyAnimation = null;
    orbitControls.enabled = true;
    orbitControls.update();

    if (callback) callback();
  }
}

/**
 * Smooth ease-in-out (Hermite interpolation).
 * @param {number} t - Value in [0, 1]
 * @returns {number} Eased value in [0, 1]
 */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Target and Position Control
// ---------------------------------------------------------------------------

/**
 * Immediately move the orbit center without animation.
 * Used for programmatic camera positioning.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function setTarget(x, y, z) {
  if (!orbitControls) return;
  orbitControls.target.set(x, y, z);
  orbitControls.update();
}

/**
 * Get the current orbit center position.
 * @returns {{x: number, y: number, z: number}|null}
 */
export function getTarget() {
  if (!orbitControls) return null;
  const t = orbitControls.target;
  return { x: t.x, y: t.y, z: t.z };
}

/**
 * Get the current camera position.
 * @returns {{x: number, y: number, z: number}|null}
 */
export function getPosition() {
  if (!camera) return null;
  return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
}

/**
 * Get the distance from camera to orbit target.
 * @returns {number}
 */
export function getDistance() {
  if (!camera || !orbitControls) return 0;
  return camera.position.distanceTo(orbitControls.target);
}

// ---------------------------------------------------------------------------
// Enable / Disable User Input
// ---------------------------------------------------------------------------

/**
 * Enable all user camera interaction (orbit, pan, zoom).
 */
export function enableControls() {
  if (orbitControls) orbitControls.enabled = true;
}

/**
 * Disable all user camera interaction.
 * Useful during modal dialogs, animations, or when another input mode is active.
 */
export function disableControls() {
  if (orbitControls) orbitControls.enabled = false;
}

/**
 * Check if user controls are currently enabled.
 * @returns {boolean}
 */
export function isEnabled() {
  return orbitControls ? orbitControls.enabled : false;
}

/**
 * Enable or disable left-click orbit rotation.
 * Used by build mode to claim left-click for selection.
 * @param {boolean} enabled
 */
export function setRotateEnabled(enabled) {
  if (!orbitControls) return;
  if (enabled) {
    orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  } else {
    orbitControls.mouseButtons.LEFT = -1;
  }
}

/**
 * Enable or disable right-click panning.
 * Used by build mode to claim right-click for context menu.
 * @param {boolean} enabled
 */
export function setPanEnabled(enabled) {
  if (!orbitControls) return;
  if (enabled) {
    orbitControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  } else {
    orbitControls.mouseButtons.RIGHT = -1;
  }
}

// ---------------------------------------------------------------------------
// Pan Bounds
// ---------------------------------------------------------------------------

/**
 * Restrict panning so the orbit target stays within the forge floor area.
 * Prevents the user from panning the camera off into empty void beyond the grid.
 *
 * @param {number} minX - Left boundary
 * @param {number} maxX - Right boundary
 * @param {number} minZ - Near boundary
 * @param {number} maxZ - Far boundary
 */
export function setPanBounds(minX, maxX, minZ, maxZ) {
  panBounds = { minX, maxX, minZ, maxZ };
}

/**
 * Remove pan bounds (allow unlimited panning).
 */
export function clearPanBounds() {
  panBounds = null;
}

function enforcePanBounds() {
  if (!panBounds || !orbitControls) return;

  const target = orbitControls.target;
  let clamped = false;

  if (target.x < panBounds.minX) { target.x = panBounds.minX; clamped = true; }
  if (target.x > panBounds.maxX) { target.x = panBounds.maxX; clamped = true; }
  if (target.z < panBounds.minZ) { target.z = panBounds.minZ; clamped = true; }
  if (target.z > panBounds.maxZ) { target.z = panBounds.maxZ; clamped = true; }

  // If we clamped the target, shift the camera position to match
  if (clamped) {
    // The offset between camera and target should remain the same
    // OrbitControls handles this on next update()
  }
}

// ---------------------------------------------------------------------------
// Camera Reference (for other systems that need direct access)
// ---------------------------------------------------------------------------

/**
 * Get the Three.js camera instance.
 * @returns {THREE.PerspectiveCamera|null}
 */
export function getCamera() {
  return camera;
}

/**
 * Get the OrbitControls instance (for advanced configuration).
 * @returns {OrbitControls|null}
 */
export function getOrbitControls() {
  return orbitControls;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Dispose of controls and release event listeners.
 * Call when tearing down the 3D scene.
 */
export function dispose() {
  cancelFly();
  if (orbitControls) {
    orbitControls.dispose();
    orbitControls = null;
  }
  camera = null;
  domElement = null;
  panBounds = null;
}