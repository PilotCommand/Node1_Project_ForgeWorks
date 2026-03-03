// ============================================================================
// randnumerics.js — Seeded Random Number Generator
// Forgeworks · Infrastructure · Tier 1 Leaf Dependency
// ============================================================================
// Provides deterministic pseudo-random numbers from a configurable seed.
// Replaces Math.random() everywhere in the project. Because the seed is
// shared, two clients or two simulation runs with the same seed produce
// identical random sequences.
//
// Uses Mulberry32 — simple, fast, well-distributed, ~6 lines of core logic.
// Call order matters for reproducibility. This is intentional.
//
// Imports: Nothing (leaf dependency)
// Exports: Seeded RNG functions, seed control
// ============================================================================

// ---------------------------------------------------------------------------
// Seed State
// ---------------------------------------------------------------------------

let currentSeed = 12345;
let state = currentSeed;

// ---------------------------------------------------------------------------
// Seed Control
// ---------------------------------------------------------------------------

/**
 * Set a new seed and reset the PRNG state.
 * All subsequent random calls produce a deterministic sequence from this seed.
 * @param {number} newSeed - Any integer. Coerced to unsigned 32-bit.
 */
export function setSeed(newSeed) {
  currentSeed = newSeed >>> 0;
  state = currentSeed;
}

/**
 * Get the current seed (the value last passed to setSeed, or the default).
 * Returns the original seed, not the current internal state.
 * @returns {number}
 */
export function getSeed() {
  return currentSeed;
}

/**
 * Reset the PRNG back to the beginning of the current seed sequence.
 * Useful for replaying the same random sequence without changing the seed.
 */
export function resetToSeed() {
  state = currentSeed;
}

// ---------------------------------------------------------------------------
// Core PRNG — Mulberry32
// ---------------------------------------------------------------------------
// Fast, well-distributed 32-bit PRNG. Passes BigCrush statistical tests.
// Returns a float in [0, 1) from the current state, then advances state.
// ---------------------------------------------------------------------------

function mulberry32() {
  state += 0x6D2B79F5;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Random Value Generators
// ---------------------------------------------------------------------------

/**
 * Random float in [0, 1). Drop-in replacement for Math.random().
 * @returns {number}
 */
export function random() {
  return mulberry32();
}

/**
 * Random integer in [min, max] (inclusive on both ends).
 * @param {number} min - Lower bound (integer)
 * @param {number} max - Upper bound (integer)
 * @returns {number}
 */
export function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return lo + Math.floor(mulberry32() * (hi - lo + 1));
}

/**
 * Random float in [min, max).
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number}
 */
export function randomFloat(min, max) {
  return min + mulberry32() * (max - min);
}

/**
 * Pick a random element from an array.
 * @param {Array} array - Non-empty array
 * @returns {*} A random element, or undefined if array is empty
 */
export function randomChoice(array) {
  if (!array || array.length === 0) {
    console.warn('randnumerics: randomChoice called with empty array');
    return undefined;
  }
  return array[Math.floor(mulberry32() * array.length)];
}

/**
 * Pick a random element using weighted probabilities.
 * Weights are relative — they do not need to sum to 1.
 *
 * @param {Array<{value: *, weight: number}>} options
 * @returns {*} The selected value, or undefined if options is empty
 */
export function randomWeighted(options) {
  if (!options || options.length === 0) {
    console.warn('randnumerics: randomWeighted called with empty options');
    return undefined;
  }

  let totalWeight = 0;
  for (let i = 0; i < options.length; i++) {
    totalWeight += options[i].weight;
  }

  let roll = mulberry32() * totalWeight;

  for (let i = 0; i < options.length; i++) {
    roll -= options[i].weight;
    if (roll <= 0) {
      return options[i].value;
    }
  }

  // Fallback for floating point edge case
  return options[options.length - 1].value;
}

/**
 * Shuffle an array in place using Fisher-Yates algorithm (deterministic).
 * @param {Array} array - The array to shuffle
 * @returns {Array} The same array, now shuffled
 */
export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(mulberry32() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

/**
 * Random boolean with a given probability of being true.
 * @param {number} [probability=0.5] - Chance of returning true (0 to 1)
 * @returns {boolean}
 */
export function randomBool(probability = 0.5) {
  return mulberry32() < probability;
}

/**
 * Random float from a Gaussian (normal) distribution via Box-Muller transform.
 * Useful for natural variation (e.g., slight temperature fluctuations).
 * @param {number} [mean=0] - Center of the distribution
 * @param {number} [stdDev=1] - Standard deviation
 * @returns {number}
 */
export function randomGaussian(mean = 0, stdDev = 1) {
  const u1 = mulberry32();
  const u2 = mulberry32();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

// ---------------------------------------------------------------------------
// Snapshot / Restore (for Prediction Mode)
// ---------------------------------------------------------------------------

/**
 * Capture the current PRNG state.
 * @returns {object} Snapshot for restoreSnapshot().
 */
export function takeSnapshot() {
  return { currentSeed, state };
}

/**
 * Restore PRNG state from a previously captured snapshot.
 * @param {object} snapshot - Object returned by takeSnapshot().
 */
export function restoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.state !== 'number') {
    console.warn('randnumerics: invalid snapshot');
    return;
  }
  currentSeed = snapshot.currentSeed;
  state = snapshot.state;
}