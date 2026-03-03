// ============================================================================
// measurementunits.js — Unit Conversion Utilities
// Forgeworks · Infrastructure · Tier 1 Leaf Dependency
// ============================================================================
// Converts between SI (used internally for all calculations) and imperial
// (optional display). All stored values throughout the project are SI.
// This file only matters when showing numbers to the user.
//
// Imports: Nothing (leaf dependency)
// Exports: Conversion functions, formatting, display system toggle
// ============================================================================

// ---------------------------------------------------------------------------
// Display System State
// ---------------------------------------------------------------------------

let displaySystem = 'si'; // 'si' or 'imperial'

export function setDisplaySystem(system) {
  if (system !== 'si' && system !== 'imperial') {
    console.warn(`measurementunits: invalid display system "${system}", expected "si" or "imperial"`);
    return;
  }
  displaySystem = system;
}

export function getDisplaySystem() {
  return displaySystem;
}

// ---------------------------------------------------------------------------
// Conversion Factors & Definitions
// ---------------------------------------------------------------------------
// Each unit type maps a unit name to its factor relative to the SI base unit.
// To convert: value_in_target = value_in_source * (source_factor / target_factor)
// Temperature is special — handled separately with offset conversions.
// ---------------------------------------------------------------------------

const UNIT_TYPES = {

  distance: {
    si: 'meters',
    imperial: 'feet',
    units: {
      meters:      { factor: 1,        symbol: 'm',   decimals: 2 },
      feet:        { factor: 0.3048,   symbol: 'ft',  decimals: 2 },
      inches:      { factor: 0.0254,   symbol: 'in',  decimals: 1 },
      centimeters: { factor: 0.01,     symbol: 'cm',  decimals: 1 },
      millimeters: { factor: 0.001,    symbol: 'mm',  decimals: 0 },
    }
  },

  mass: {
    si: 'kilograms',
    imperial: 'pounds',
    units: {
      kilograms: { factor: 1,        symbol: 'kg',  decimals: 1 },
      pounds:    { factor: 0.453592, symbol: 'lb',  decimals: 1 },
      grams:     { factor: 0.001,    symbol: 'g',   decimals: 0 },
      tons:      { factor: 1000,     symbol: 't',   decimals: 2 },
      shortTons: { factor: 907.185,  symbol: 'tn',  decimals: 2 },
    }
  },

  temperature: {
    si: 'celsius',
    imperial: 'fahrenheit',
    // Temperature uses offset conversion — not factor-based.
    // Handled by dedicated functions below.
    units: {
      celsius:    { symbol: '°C', decimals: 0 },
      fahrenheit: { symbol: '°F', decimals: 0 },
      kelvin:     { symbol: 'K',  decimals: 0 },
    }
  },

  force: {
    si: 'newtons',
    imperial: 'tonsForce',
    units: {
      newtons:    { factor: 1,        symbol: 'N',    decimals: 0 },
      kilonewtons:{ factor: 1000,     symbol: 'kN',   decimals: 1 },
      tonsForce:  { factor: 9806.65,  symbol: 'tf',   decimals: 2 },
      poundsForce:{ factor: 4.44822,  symbol: 'lbf',  decimals: 0 },
    }
  },

  pressure: {
    si: 'pascals',
    imperial: 'psi',
    units: {
      pascals:      { factor: 1,         symbol: 'Pa',   decimals: 0 },
      kilopascals:  { factor: 1000,      symbol: 'kPa',  decimals: 1 },
      megapascals:  { factor: 1000000,   symbol: 'MPa',  decimals: 2 },
      psi:          { factor: 6894.757,  symbol: 'psi',  decimals: 1 },
      bar:          { factor: 100000,    symbol: 'bar',  decimals: 2 },
    }
  },

  volume: {
    si: 'liters',
    imperial: 'gallons',
    units: {
      liters:       { factor: 1,       symbol: 'L',    decimals: 1 },
      milliliters:  { factor: 0.001,   symbol: 'mL',   decimals: 0 },
      cubicMeters:  { factor: 1000,    symbol: 'm³',   decimals: 3 },
      gallons:      { factor: 3.78541, symbol: 'gal',  decimals: 1 },
    }
  },

  energy: {
    si: 'joules',
    imperial: 'btu',
    units: {
      joules:      { factor: 1,         symbol: 'J',    decimals: 0 },
      kilojoules:  { factor: 1000,      symbol: 'kJ',   decimals: 1 },
      megajoules:  { factor: 1000000,   symbol: 'MJ',   decimals: 2 },
      btu:         { factor: 1055.06,   symbol: 'BTU',  decimals: 0 },
      kilocalories:{ factor: 4184,      symbol: 'kcal', decimals: 1 },
    }
  },

  power: {
    si: 'watts',
    imperial: 'horsepower',
    units: {
      watts:      { factor: 1,       symbol: 'W',   decimals: 0 },
      kilowatts:  { factor: 1000,    symbol: 'kW',  decimals: 1 },
      megawatts:  { factor: 1000000, symbol: 'MW',  decimals: 3 },
      horsepower: { factor: 745.7,   symbol: 'hp',  decimals: 1 },
    }
  },

};

// ---------------------------------------------------------------------------
// Temperature Conversion (offset-based, not factor-based)
// ---------------------------------------------------------------------------

function convertTemperature(value, from, to) {
  if (from === to) return value;

  // Normalize to Celsius first
  let celsius;
  switch (from) {
    case 'celsius':    celsius = value; break;
    case 'fahrenheit': celsius = (value - 32) * (5 / 9); break;
    case 'kelvin':     celsius = value - 273.15; break;
    default:
      console.warn(`measurementunits: unknown temperature unit "${from}"`);
      return value;
  }

  // Convert from Celsius to target
  switch (to) {
    case 'celsius':    return celsius;
    case 'fahrenheit': return celsius * (9 / 5) + 32;
    case 'kelvin':     return celsius + 273.15;
    default:
      console.warn(`measurementunits: unknown temperature unit "${to}"`);
      return value;
  }
}

// ---------------------------------------------------------------------------
// General-Purpose Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a value between any two units of the same type.
 * @param {number} value - The value to convert
 * @param {string} fromUnit - Source unit name (e.g., 'meters', 'pounds', 'celsius')
 * @param {string} toUnit - Target unit name
 * @returns {number} Converted value
 */
export function convert(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;

  // Temperature is special
  if (isTemperatureUnit(fromUnit) && isTemperatureUnit(toUnit)) {
    return convertTemperature(value, fromUnit, toUnit);
  }

  // Find which unit type these belong to
  const typeInfo = findUnitType(fromUnit);
  if (!typeInfo) {
    console.warn(`measurementunits: unknown unit "${fromUnit}"`);
    return value;
  }

  const fromDef = typeInfo.units[fromUnit];
  const toDef = typeInfo.units[toUnit];

  if (!toDef) {
    console.warn(`measurementunits: unknown unit "${toUnit}" in type "${typeInfo.name}"`);
    return value;
  }

  // value_in_si = value * fromFactor, then value_in_target = value_in_si / toFactor
  return value * (fromDef.factor / toDef.factor);
}

// ---------------------------------------------------------------------------
// Shorthand Conversion Functions
// ---------------------------------------------------------------------------

// Temperature
export function celsiusToFahrenheit(c) { return convertTemperature(c, 'celsius', 'fahrenheit'); }
export function fahrenheitToCelsius(f) { return convertTemperature(f, 'fahrenheit', 'celsius'); }
export function celsiusToKelvin(c)     { return convertTemperature(c, 'celsius', 'kelvin'); }
export function kelvinToCelsius(k)     { return convertTemperature(k, 'kelvin', 'celsius'); }

// Distance
export function metersToFeet(m)    { return convert(m, 'meters', 'feet'); }
export function feetToMeters(ft)   { return convert(ft, 'feet', 'meters'); }
export function metersToInches(m)  { return convert(m, 'meters', 'inches'); }
export function inchesToMeters(i)  { return convert(i, 'inches', 'meters'); }

// Mass
export function kilogramsToPounds(kg) { return convert(kg, 'kilograms', 'pounds'); }
export function poundsToKilograms(lb) { return convert(lb, 'pounds', 'kilograms'); }

// Force
export function newtonsToTonsForce(n)  { return convert(n, 'newtons', 'tonsForce'); }
export function tonsForceToNewtons(tf) { return convert(tf, 'tonsForce', 'newtons'); }

// Pressure
export function pascalsToPsi(pa)  { return convert(pa, 'pascals', 'psi'); }
export function psiToPascals(psi) { return convert(psi, 'psi', 'pascals'); }

// Volume
export function litersToGallons(l)  { return convert(l, 'liters', 'gallons'); }
export function gallonsToLiters(g)  { return convert(g, 'gallons', 'liters'); }

// Energy
export function joulesToBtu(j)  { return convert(j, 'joules', 'btu'); }
export function btuToJoules(b)  { return convert(b, 'btu', 'joules'); }

// Power
export function wattsToHorsepower(w)  { return convert(w, 'watts', 'horsepower'); }
export function horsepowerToWatts(hp) { return convert(hp, 'horsepower', 'watts'); }
export function wattsToKilowatts(w)   { return convert(w, 'watts', 'kilowatts'); }
export function kilowattsToWatts(kw)  { return convert(kw, 'kilowatts', 'watts'); }

// ---------------------------------------------------------------------------
// Display Formatting
// ---------------------------------------------------------------------------

/**
 * Format a value for display with appropriate unit symbol.
 * Uses the current displaySystem ('si' or 'imperial') unless overridden.
 *
 * @param {number} value - The value in SI units
 * @param {string} unitType - One of: 'distance', 'mass', 'temperature', 'force',
 *                            'pressure', 'volume', 'energy', 'power'
 * @param {string} [system] - Optional override: 'si' or 'imperial'
 * @returns {string} Formatted string like "1,250 °C" or "2,282 °F"
 */
export function formatValue(value, unitType, system) {
  const sys = system || displaySystem;
  const typeInfo = UNIT_TYPES[unitType];

  if (!typeInfo) {
    console.warn(`measurementunits: unknown unit type "${unitType}"`);
    return String(value);
  }

  // Determine which unit to display in
  const targetUnitName = sys === 'imperial' ? typeInfo.imperial : typeInfo.si;
  const targetUnitDef = typeInfo.units[targetUnitName];

  // Convert from SI base unit to display unit
  let displayValue;
  if (unitType === 'temperature') {
    displayValue = convertTemperature(value, 'celsius', targetUnitName);
  } else {
    const siUnitName = typeInfo.si;
    displayValue = convert(value, siUnitName, targetUnitName);
  }

  // Format number with commas and appropriate decimal places
  const formatted = formatNumber(displayValue, targetUnitDef.decimals);

  return `${formatted} ${targetUnitDef.symbol}`;
}

/**
 * Format a value for display using a specific unit (not auto-selected by system).
 *
 * @param {number} value - The value already in the specified unit
 * @param {string} unitName - The unit name (e.g., 'kilowatts', 'psi')
 * @returns {string} Formatted string like "150 kW"
 */
export function formatInUnit(value, unitName) {
  // Find the unit definition
  for (const typeName of Object.keys(UNIT_TYPES)) {
    const typeInfo = UNIT_TYPES[typeName];
    if (typeInfo.units[unitName]) {
      const unitDef = typeInfo.units[unitName];
      const formatted = formatNumber(value, unitDef.decimals);
      return `${formatted} ${unitDef.symbol}`;
    }
  }

  console.warn(`measurementunits: unknown unit "${unitName}"`);
  return String(value);
}

// ---------------------------------------------------------------------------
// Unit Type Lookup
// ---------------------------------------------------------------------------

/**
 * Get the default display unit name for a unit type under the current system.
 * Useful when other files need to know what unit label to show.
 *
 * @param {string} unitType - e.g., 'temperature', 'distance'
 * @param {string} [system] - Optional override
 * @returns {string} Unit name like 'celsius' or 'fahrenheit'
 */
export function getDisplayUnit(unitType, system) {
  const sys = system || displaySystem;
  const typeInfo = UNIT_TYPES[unitType];
  if (!typeInfo) return null;
  return sys === 'imperial' ? typeInfo.imperial : typeInfo.si;
}

/**
 * Get the symbol for a specific unit.
 * @param {string} unitName - e.g., 'celsius', 'kilowatts'
 * @returns {string|null} Symbol like '°C', 'kW'
 */
export function getUnitSymbol(unitName) {
  for (const typeName of Object.keys(UNIT_TYPES)) {
    const typeInfo = UNIT_TYPES[typeName];
    if (typeInfo.units[unitName]) {
      return typeInfo.units[unitName].symbol;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function isTemperatureUnit(unitName) {
  return unitName === 'celsius' || unitName === 'fahrenheit' || unitName === 'kelvin';
}

function findUnitType(unitName) {
  for (const typeName of Object.keys(UNIT_TYPES)) {
    const typeInfo = UNIT_TYPES[typeName];
    if (typeInfo.units && typeInfo.units[unitName]) {
      return { name: typeName, ...typeInfo };
    }
  }
  return null;
}

/**
 * Format a number with commas as thousands separators and fixed decimal places.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(value, decimals) {
  // Round to specified decimals
  const fixed = value.toFixed(decimals);

  // Split into integer and decimal parts
  const parts = fixed.split('.');
  const intPart = parts[0];
  const decPart = parts[1];

  // Add commas to integer part
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}