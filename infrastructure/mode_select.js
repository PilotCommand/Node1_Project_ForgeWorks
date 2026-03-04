// ============================================================================
// mode_select.js — Select Mode
// Forgeworks Infrastructure
// ============================================================================
// Handles clicking and inspecting objects on the forge floor.
// Active when the user is selecting equipment, products, or zones
// to view details or modify properties.
//
// Imports: (none yet)
// Exports: activate(), deactivate(), update()
// ============================================================================

let active = false;

/**
 * Called when switching TO select mode.
 */
export function activate() {
  active = true;
}

/**
 * Called when switching AWAY from select mode.
 */
export function deactivate() {
  active = false;
}

/**
 * Called each frame while select mode is active.
 * @param {number} dt - Simulation delta time in seconds
 */
export function update(dt) {
  if (!active) return;
}
