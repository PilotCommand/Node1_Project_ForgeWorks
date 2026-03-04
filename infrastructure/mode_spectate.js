// ============================================================================
// mode_spectate.js — Spectate Mode
// Forgeworks Infrastructure
// ============================================================================
// Passive observation mode. Camera controls are active but no objects
// can be placed, selected, or modified. Used for watching the simulation
// run and reviewing the forge layout.
//
// Imports: (none yet)
// Exports: activate(), deactivate(), update()
// ============================================================================

let active = false;

/**
 * Called when switching TO spectate mode.
 */
export function activate() {
  active = true;
}

/**
 * Called when switching AWAY from spectate mode.
 */
export function deactivate() {
  active = false;
}

/**
 * Called each frame while spectate mode is active.
 * @param {number} dt - Simulation delta time in seconds
 */
export function update(dt) {
  if (!active) return;
}
