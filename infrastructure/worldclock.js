// ============================================================================
// worldclock.js — World Time Authority
// Forgeworks · Infrastructure · Tier 1 Leaf Dependency
// ============================================================================
// The single source of truth for all time in the simulation. Every file that
// needs to know "what time is it" or "how much time has passed" reads from
// this clock. It ticks independently of rendering frame rate, ensuring that
// a machine running at 30 FPS and one at 144 FPS both agree on sim state.
//
// Only the render loop calls tick(). Nothing else advances time.
//
// Imports: Nothing (leaf dependency)
// Exports: Time state, tick, speed/pause controls
// ============================================================================

// ---------------------------------------------------------------------------
// Clock State
// ---------------------------------------------------------------------------

let currentTime = 0;     // total elapsed simulation seconds
let deltaTime = 0;       // seconds since last tick (simulation time)
let realDelta = 0;       // seconds since last tick (real/wall time)
let speed = 1.0;         // multiplier (1.0 = real time, 0 = paused via speed)
let isPaused = false;    // explicit pause flag
let tickCount = 0;       // integer frame count

// Simulation calendar — the "real world" date/time the forge starts at
let simStartDate = new Date(0, 0, 1, 0, 0, 0); // 01 Jan 0000, 00:00:00
simStartDate.setFullYear(0); // JS Date constructor treats 0 as 1900, so force it

// Safety cap: if a real frame takes longer than this (in ms), clamp it.
// Prevents physics explosions after tab-away or debugger pauses.
const MAX_REAL_DELTA_MS = 200; // 200ms = 5 FPS floor

// ---------------------------------------------------------------------------
// Tick — Called Once Per Frame by the Render Loop
// ---------------------------------------------------------------------------

/**
 * Advance the simulation clock by one frame.
 * Called exactly once per requestAnimationFrame cycle.
 *
 * @param {number} realDeltaMs - Milliseconds since the last frame (from
 *                                performance.now() or rAF timestamp diff)
 */
export function tick(realDeltaMs) {
  // Clamp to prevent spiral-of-death after long pauses
  const clampedMs = Math.min(realDeltaMs, MAX_REAL_DELTA_MS);

  // Real delta in seconds (always tracks wall time regardless of pause)
  realDelta = clampedMs / 1000;

  if (isPaused) {
    deltaTime = 0;
    // tickCount does NOT increment while paused — simulation is frozen
    return;
  }

  // Simulation delta applies speed multiplier
  deltaTime = realDelta * speed;
  currentTime += deltaTime;
  tickCount++;
}

// ---------------------------------------------------------------------------
// Read State
// ---------------------------------------------------------------------------

/** Total elapsed simulation time in seconds. */
export function getTime() {
  return currentTime;
}

/** Simulation seconds since last tick. Zero when paused. */
export function getDelta() {
  return deltaTime;
}

/** Real (wall clock) seconds since last tick. Nonzero even when paused. */
export function getRealDelta() {
  return realDelta;
}

/** Current speed multiplier. */
export function getSpeed() {
  return speed;
}

/** Whether the clock is paused. */
export function getPaused() {
  return isPaused;
}

/** Total number of simulation ticks (frames where time advanced). */
export function getTickCount() {
  return tickCount;
}

// ---------------------------------------------------------------------------
// Speed Control
// ---------------------------------------------------------------------------

/**
 * Set the simulation speed multiplier.
 * 1.0 = real time, 2.0 = double speed, 0.5 = half speed.
 * Prediction mode may use 1000+ for fast-forward.
 *
 * @param {number} multiplier - Must be >= 0. Zero effectively pauses via speed.
 */
export function setSpeed(multiplier) {
  if (typeof multiplier !== 'number' || multiplier < 0) {
    console.warn(`worldclock: invalid speed "${multiplier}", must be >= 0`);
    return;
  }
  speed = multiplier;
}

// ---------------------------------------------------------------------------
// Pause / Resume
// ---------------------------------------------------------------------------

/** Pause the simulation. Time stops advancing, deltaTime becomes 0. */
export function pause() {
  isPaused = true;
}

/** Resume the simulation at the current speed. */
export function resume() {
  isPaused = false;
}

/** Toggle between paused and running. */
export function togglePause() {
  isPaused = !isPaused;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Reset the clock to its initial state.
 * Used when loading a new layout or starting a fresh simulation.
 */
export function reset() {
  currentTime = 0;
  deltaTime = 0;
  realDelta = 0;
  speed = 1.0;
  isPaused = false;
  tickCount = 0;
}

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------
// The prediction engine needs to save clock state before a run and restore
// it afterward so the forge returns to its pre-prediction time.

/**
 * Capture the current clock state as a plain object.
 * @returns {object} Snapshot that can be passed to restoreSnapshot().
 */
export function takeSnapshot() {
  return {
    currentTime,
    deltaTime,
    realDelta,
    speed,
    isPaused,
    tickCount,
    simStartDate: simStartDate.getTime(),
  };
}

/**
 * Restore clock state from a previously captured snapshot.
 * @param {object} snapshot - Object returned by takeSnapshot().
 */
export function restoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.currentTime !== 'number') {
    console.warn('worldclock: invalid snapshot');
    return;
  }
  currentTime = snapshot.currentTime;
  deltaTime = snapshot.deltaTime;
  realDelta = snapshot.realDelta;
  speed = snapshot.speed;
  isPaused = snapshot.isPaused;
  tickCount = snapshot.tickCount;
  if (snapshot.simStartDate) simStartDate = new Date(snapshot.simStartDate);
}

// ---------------------------------------------------------------------------
// Utility — Formatted Time Display
// ---------------------------------------------------------------------------

/**
 * Format the current simulation time as a human-readable string.
 * @param {number} [seconds] - Optional override. Defaults to currentTime.
 * @returns {string} e.g., "02:15:30" (hh:mm:ss) or "1d 04:30:00" for 24h+
 */
export function formatTime(seconds) {
  const t = seconds !== undefined ? seconds : currentTime;
  const d = new Date(simStartDate.getTime() + t * 1000);

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
}

/**
 * Format a speed multiplier for display.
 * @param {number} [spd] - Optional override. Defaults to current speed.
 * @returns {string} e.g., "1.0x", "2.0x", "1000x"
 */
export function formatSpeed(spd) {
  const s = spd !== undefined ? spd : speed;
  if (s >= 100) return `${Math.round(s)}x`;
  if (s >= 10) return `${s.toFixed(0)}x`;
  return `${s.toFixed(1)}x`;
}

// ---------------------------------------------------------------------------
// Utility — Simulation Calendar Date
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Get the current simulation date as a Date object.
 * Computed from simStartDate + elapsed simulation seconds.
 * @returns {Date}
 */
export function getSimDate() {
  return new Date(simStartDate.getTime() + currentTime * 1000);
}

/**
 * Format the current simulation date as "DD Mon YYYY".
 * @param {number} [seconds] - Optional override. Defaults to currentTime.
 * @returns {string} e.g., "03 Mar 2025"
 */
export function formatDate(seconds) {
  const t = seconds !== undefined ? seconds : currentTime;
  const d = new Date(simStartDate.getTime() + t * 1000);

  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[d.getMonth()];
  const year = String(d.getFullYear()).padStart(4, '0');

  return `${day} ${month} ${year}`;
}

/**
 * Set the simulation start date.
 * @param {Date} date
 */
export function setSimStartDate(date) {
  if (date instanceof Date) {
    simStartDate = new Date(date.getTime());
  }
}