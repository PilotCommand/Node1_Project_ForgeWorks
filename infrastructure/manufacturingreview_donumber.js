// ============================================================================
// manufacturingreview_donumber.js — Delivery Order Number Helpers
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Pure functions for parsing, formatting, validating, and generating
// Delivery Order numbers. No DOM, no state, no imports.
//
// DO Number format:
//   Standalone / Parent:  000001         (1–9 digits, displayed zero-padded to 6)
//   Child:                000001-02      (base + hyphen + exactly 2 digits)
//
// Suffix back-calculation:
//   Batches are numbered highest-to-lowest so the final delivery is always -00.
//   A customer receiving -00 knows the order is complete with no further
//   shipments on the way.
//
//   3 batches → suffixes: ['02', '01', '00']
//   5 batches → suffixes: ['04', '03', '02', '01', '00']
//
// Exports:
//   formatBase(n)
//   parseDoNumber(str)
//   buildDoNumber(base, suffix)
//   generateChildSuffixes(count)
//   getBaseNumber(doNumber)
//   getSuffix(doNumber)
//   isTerminating(doNumber)
//   validateDoNumber(str)
//   compareDoNumbers(a, b)
// ============================================================================


// ---------------------------------------------------------------------------
// formatBase
// ---------------------------------------------------------------------------

/**
 * Format a number or numeric string as a zero-padded DO base number.
 * Pads to 6 digits minimum; passes through longer numbers unchanged.
 * Strips any non-digit characters before formatting.
 *
 * @param {number|string} n
 * @returns {string}  e.g. '000001', '000042', '123456789'
 */
export function formatBase(n) {
  var digits = String(n || '').replace(/\D/g, '');
  if (!digits) return '000000';
  // Remove leading zeros before re-padding, but preserve at least one digit
  var numeric = digits.replace(/^0+/, '') || '0';
  return numeric.length >= 6 ? numeric : numeric.padStart(6, '0');
}


// ---------------------------------------------------------------------------
// parseDoNumber
// ---------------------------------------------------------------------------

/**
 * Parse a DO number string into its components.
 *
 * @param {string} str
 * @returns {{
 *   base:    string,   zero-padded base e.g. '000001'
 *   suffix:  string|null,  two-digit suffix e.g. '02', or null if standalone
 *   isChild: boolean,
 *   isValid: boolean,
 *   raw:     string    the original input
 * }}
 */
export function parseDoNumber(str) {
  var raw = String(str || '').trim();
  var result = { base: '', suffix: null, isChild: false, isValid: false, raw: raw };

  if (!raw) return result;

  var parts = raw.split('-');

  // Must have 1 or 2 parts only
  if (parts.length > 2) return result;

  var basePart = parts[0];
  var suffixPart = parts[1] !== undefined ? parts[1] : null;

  // Base must be 1–9 digits
  if (!/^\d{1,9}$/.test(basePart)) return result;

  // If suffix present, must be exactly 2 digits
  if (suffixPart !== null) {
    if (!/^\d{2}$/.test(suffixPart)) return result;
  }

  // Base must not be zero
  if (parseInt(basePart, 10) === 0) return result;

  result.base    = formatBase(basePart);
  result.suffix  = suffixPart;
  result.isChild = suffixPart !== null;
  result.isValid = true;
  return result;
}


// ---------------------------------------------------------------------------
// buildDoNumber
// ---------------------------------------------------------------------------

/**
 * Build a full DO number string from a base and optional suffix.
 *
 * @param {string} base    e.g. '000001'
 * @param {string|null} suffix  e.g. '02', or null for standalone/parent
 * @returns {string}  e.g. '000001' or '000001-02'
 */
export function buildDoNumber(base, suffix) {
  if (suffix === null || suffix === undefined || suffix === '') {
    return String(base);
  }
  return String(base) + '-' + String(suffix);
}


// ---------------------------------------------------------------------------
// generateChildSuffixes
// ---------------------------------------------------------------------------

/**
 * Generate the back-calculated suffix array for a given batch count.
 * Returns suffixes in shipping order: highest first, '00' always last.
 * The last suffix '00' signals order completion to the customer.
 *
 * @param {number} count  Number of batches (2–99)
 * @returns {string[]}    e.g. count=3 → ['02', '01', '00']
 *
 * @throws {Error} if count < 1 or count > 99
 */
export function generateChildSuffixes(count) {
  var n = parseInt(count, 10);
  if (isNaN(n) || n < 1) {
    throw new Error('Batch count must be at least 1.');
  }
  if (n > 99) {
    throw new Error('Maximum 99 batches per delivery order.');
  }

  var suffixes = [];
  for (var i = n - 1; i >= 0; i--) {
    suffixes.push(String(i).padStart(2, '0'));
  }
  return suffixes;
  // n=1 → ['00']
  // n=2 → ['01', '00']
  // n=3 → ['02', '01', '00']
}


// ---------------------------------------------------------------------------
// getBaseNumber
// ---------------------------------------------------------------------------

/**
 * Extract the base portion of any DO number, with or without a suffix.
 * Always returns a zero-padded 6-digit string (or longer if the input is).
 *
 * @param {string} doNumber
 * @returns {string}  e.g. '000001'
 */
export function getBaseNumber(doNumber) {
  var parsed = parseDoNumber(doNumber);
  return parsed.isValid ? parsed.base : String(doNumber || '').split('-')[0];
}


// ---------------------------------------------------------------------------
// getSuffix
// ---------------------------------------------------------------------------

/**
 * Extract the suffix portion of a child DO number.
 * Returns null for standalone or parent orders.
 *
 * @param {string} doNumber
 * @returns {string|null}  e.g. '02', or null
 */
export function getSuffix(doNumber) {
  var parsed = parseDoNumber(doNumber);
  return parsed.isValid ? parsed.suffix : null;
}


// ---------------------------------------------------------------------------
// isTerminating
// ---------------------------------------------------------------------------

/**
 * Returns true if this DO number is a terminating child batch (-00).
 * A customer receiving a -00 shipment knows the full order is complete.
 *
 * @param {string} doNumber
 * @returns {boolean}
 */
export function isTerminating(doNumber) {
  var parsed = parseDoNumber(doNumber);
  return parsed.isValid && parsed.suffix === '00';
}


// ---------------------------------------------------------------------------
// validateDoNumber
// ---------------------------------------------------------------------------

/**
 * Validate a DO number string.
 * Returns null if valid, or a human-readable error message if not.
 *
 * @param {string} str
 * @returns {string|null}
 */
export function validateDoNumber(str) {
  var raw = String(str || '').trim();

  if (!raw) return 'DO number cannot be empty.';

  var parts = raw.split('-');

  if (parts.length > 2) {
    return 'DO number can only contain one hyphen (e.g. 000001-02).';
  }

  var basePart = parts[0];

  if (!/^\d+$/.test(basePart)) {
    return 'Base number must contain digits only.';
  }

  if (basePart.length > 9) {
    return 'Base number cannot exceed 9 digits.';
  }

  if (parseInt(basePart, 10) === 0) {
    return 'Base number must be greater than zero.';
  }

  if (parts.length === 2) {
    var suffixPart = parts[1];
    if (!/^\d{2}$/.test(suffixPart)) {
      return 'Batch suffix must be exactly two digits (e.g. 000001-02).';
    }
  }

  return null;  // valid
}


// ---------------------------------------------------------------------------
// compareDoNumbers
// ---------------------------------------------------------------------------

/**
 * Comparator for sorting DO numbers in ascending numeric order.
 * Sorts by base number first, then by suffix descending within the same base
 * (so -02 appears before -01 before -00 in the list — shipping order).
 *
 * Usage: array.sort(compareDoNumbers)  — sorts a to z numerically
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}  negative if a < b, positive if a > b, 0 if equal
 */
export function compareDoNumbers(a, b) {
  var pa = parseDoNumber(a);
  var pb = parseDoNumber(b);

  // Invalid entries sort to the end
  if (!pa.isValid && !pb.isValid) return 0;
  if (!pa.isValid) return 1;
  if (!pb.isValid) return -1;

  // Compare base numerically
  var baseA = parseInt(pa.base, 10);
  var baseB = parseInt(pb.base, 10);
  if (baseA !== baseB) return baseA - baseB;

  // Same base — parent/standalone (no suffix) sorts before children
  if (pa.suffix === null && pb.suffix !== null) return -1;
  if (pa.suffix !== null && pb.suffix === null) return  1;
  if (pa.suffix === null && pb.suffix === null) return  0;

  // Both children — sort suffix descending (02 before 01 before 00)
  var sufA = parseInt(pa.suffix, 10);
  var sufB = parseInt(pb.suffix, 10);
  return sufB - sufA;
}
