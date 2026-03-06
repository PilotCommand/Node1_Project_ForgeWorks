// ============================================================================
// manufacturingreview_defs.js — Shared Constants, Definitions & Pure Helpers
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// This file exists to break circular imports between manufacturingreview.js
// (the entry point/orchestrator) and the panel modules (_process, _inputs,
// _summary, _estimates). All shared data/helpers live here; nobody imports
// from main except the public show/hide/isVisible/onBack API.
//
// Imports:  manufacturingreview_states.js (S) — for unit system reads only
// Exports:  NODE_W, NODE_H, PORT_R, PORT_HIT, ACCENT, ACCENT_DIM
//           MATERIAL_CATALOG, NODE_DEFS
//           computeChain, round3, fmtVol
//           dMass, dLen, dTemp, dVol, dDensity, dMassUnit, dLenUnit,
//           dTempUnit, dVolUnit, dDensUnit
//           toDisplay, fromDisplay, unitSuffix, scaleParam
//           buildInputSection, buildTextInput, buildNumberInputEl,
//           buildSelectEl, buildTextareaInput, fWrap, fLabel, sInput
// ============================================================================

import * as S from './manufacturingreview_states.js';

export var NODE_W   = 180;
export var NODE_H   = 72;
export var PORT_R   = 6;
export var PORT_HIT = 14;

export var ACCENT     = '#e05c3a';
export var ACCENT_DIM = 'rgba(224, 92, 58, ';

// State is managed by manufacturingreview_states.js — imported as S above.







// ---------------------------------------------------------------------------
// Reference Data
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Material Catalog — two-level: family → grades
// densityDefault in g/cm³ (SI). Used to auto-populate the density field
// when the user changes family. Editable per-job in the node detail panel.
// ---------------------------------------------------------------------------
export var MATERIAL_CATALOG = {
  carbon_steel: {
    label: 'Carbon Steel',
    densityDefault: 7.85,
    grades: [
      '1006', '1008', '1015', '1018', '1022', '1026',
      '1035', '1040', '1045', '1045 de 1', '1045 de 2',
      'AMS 1015', 'AMS 1035',
      'Electrical Iron',
      'Grade 4 ASTM-A-596 Magnet Steel',
      'SA-508 Class 1', 'SA-508 Class 1a',
    ],
  },
  standard_alloy_steel: {
    label: 'Standard Steel Alloy',
    densityDefault: 7.85,
    grades: [
      '4130', '4140', '4320', '4330 MOD', '4340', '4340 HI TRANS',
      '4340 MOD (300M)', '4620', '6150', '8620', '8630', '8740',
      '9310', '52100',
      'Grade B-7', 'Grade B-23',
    ],
  },
  special_alloy_steel: {
    label: 'Special Steel Alloy',
    densityDefault: 7.85,
    grades: [
      '1-1/4 CR 1/2 MO F-11',
      '2-1/4 CR 1 MO F-22',
      '5 CR 1/2 MO F-5a (201)',
      'AMS-6304',
      'CHROMOLOY',
      'D6AC',
      'F-9', 'F-91',
      'Grade B-16', 'Grade B-24',
      'HY-80', 'HY-100',
      'NITRIDING STEEL 135M',
      'SA-508-CL 2', 'SA-508-CL 3', 'SA-508-CL 4',
    ],
  },
  stainless_chromium: {
    label: 'Stainless — Chromium Types',
    densityDefault: 7.75,
    grades: [
      '403', '403 ESR', '403 VAR',
      '405', '410', '416', '420', '422 ESR',
      '430', '431',
      '440A', '440C', '440C VAR',
      'F6NM',
      'Greek Ascaloy',
    ],
  },
  copper_based: {
    label: 'Copper Based',
    densityDefault: 8.94,
    grades: [
      'OFHC Copper',
      '70-30 CU-NI ESR',
    ],
  },
  stainless_chrome_nickel: {
    label: 'Stainless — Chrome Nickel Types',
    densityDefault: 7.93,
    grades: [
      '254 SMO',
      '302', '303S', '303SE',
      '304/304L', '304L ESR', '304L VAR',
      '309', '310', '316/316L', '316L VAR', '317',
      '321', '321 VAR',
      '348 LO CO',
      '2205',
      'AL-6XN',
      'Carpenter 20 CB-3',
      'FER 255',
      'Nitronic 40', 'Nitronic 50', 'Nitronic 60',
    ],
  },
  stainless_ph: {
    label: 'Stainless — Precipitation Hardenable',
    densityDefault: 7.78,
    grades: [
      '15-5PH ESR', '15-5PH VAR',
      '17-4PH', '17-4PH VAR',
      'PH 13-8MO', 'PH 15-7MO',
    ],
  },
  nickel_alloy: {
    label: 'Nickel and Nickel Copper',
    densityDefault: 8.20,
    grades: [
      'Alloy 214', 'Alloy 230',
      'Alloy 600', 'Alloy 600T', 'Alloy 601',
      'Alloy 617', 'Alloy 625',
      'Alloy 690',
      'Alloy 706', 'Alloy 718', 'Alloy 725',
      'Alloy 800 HT', 'Alloy 825',
      'Alloy 901', 'Alloy 925',
      'Alloy A286',
      'Alloy B2',
      'Alloy C-22', 'Alloy C-276',
      'Alloy S', 'Alloy X', 'Alloy X750',
    ],
  },
  cobalt: {
    label: 'Cobalt',
    densityDefault: 8.30,
    grades: [
      'Alloy HS-188',
      'Alloy L-605',
      'Alloy N-155',
    ],
  },
  aluminum: {
    label: 'Aluminum',
    densityDefault: 2.71,
    grades: [
      '1100', '2014', '2024', '2219', '2618',
      '3003', '5083', '6061',
      '7050', '7075', '7079',
    ],
  },
  titanium: {
    label: 'Titanium',
    densityDefault: 4.43,
    grades: [
      'CP Grade 2', 'CP Grade 4', 'CP Grade 6',
      '6AL-4V',
    ],
  },
};

// ---------------------------------------------------------------------------
// Node Type Definitions
// ---------------------------------------------------------------------------

export var NODE_DEFS = {

  // ── STOCK IN ──────────────────────────────────────────────────────────────
  // This forge buys ingots and billets in three cross-section geometries.
  stock_in: {
    label: 'Stock In', color: '#3a1208', textColor: '#ffb090', borderColor: '#e05c3a',
    hasInput: false, hasOutput: true,
    defaultParams: {
      poNumber: '', heatNumber: '', supplier: '', certNumber: '',
      stockType: 'billet',          // ingot | billet
      materialFamily: 'carbon_steel', grade: '4140', condition: 'annealed', density: 7.85,
      mfgMethod: 'ingot_cast', priorHT: 'none', grainDir: 'longitudinal', grainSize: '',
      // Geometry: round_cylinder | rectangular_prism | round_corner_square
      geometry: 'round_cylinder',
      diameter: 400,                // round_cylinder
      width: 300, sectionHeight: 300,   // rectangular_prism  (renamed from 'height' to avoid clash)
      side: 300,  cornerRadius: 30, // round_corner_square
      length: 1000,                 // all geometries
      quantity: 1,
    },
    paramDefs: [
      { section: 'Procurement' },
      { key: 'poNumber',   label: 'PO Number',       type: 'text' },
      { key: 'heatNumber', label: 'Heat / Lot #',    type: 'text' },
      { key: 'supplier',   label: 'Supplier / Mill', type: 'text' },
      { key: 'certNumber', label: 'Mill Cert #',     type: 'text' },
      { section: 'Stock Type' },
      { key: 'stockType', label: 'Stock Type', type: 'select', options: ['ingot','billet'] },
      { section: 'Material' },
      { key: 'materialFamily', label: 'Material Family', type: 'material_family' },
      { key: 'grade',          label: 'Grade',           type: 'grade_lookup'    },
      { key: 'condition', label: 'Incoming Condition', type: 'select', options: [
        'annealed','normalized','as_rolled','as_cast','quench_temper','stress_relief','unknown',
      ]},
      { key: 'density', label: 'Density', unitType: 'density', type: 'number', min: 0.5, max: 25, step: 0.01 },
      { section: 'Prior Processing' },
      { key: 'mfgMethod', label: 'Manufacturing Method', type: 'select', options: [
        'ingot_cast','continuous_cast','forged','rolled','unknown',
      ]},
      { key: 'priorHT', label: 'Prior Heat Treatment', type: 'select', options: [
        'none','annealed','normalized','quench_temper','stress_relief','unknown',
      ]},
      { key: 'grainDir',  label: 'Grain Direction', type: 'select', options: ['longitudinal','transverse','unknown','not_applicable'] },
      { key: 'grainSize', label: 'Grain Size (ASTM #)', type: 'text' },
      { section: 'Geometry' },
      { key: 'geometry', label: 'Cross-Section', type: 'select', options: [
        'round_cylinder','rectangular_prism','round_corner_square',
      ], refreshPanel: true },
      { key: 'diameter',      label: 'Diameter',        unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.geometry === 'round_cylinder'; } },
      { key: 'width',         label: 'Width',           unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.geometry === 'rectangular_prism'; } },
      { key: 'sectionHeight', label: 'Height',          unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.geometry === 'rectangular_prism'; } },
      { key: 'side',          label: 'Side',            unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.geometry === 'round_corner_square'; } },
      { key: 'cornerRadius',  label: 'Corner Radius',   unitType: 'length', type: 'number', min: 0, max: 500,   step: 1,
        showWhen: function(p) { return p.geometry === 'round_corner_square'; } },
      { key: 'length',        label: 'Length',          unitType: 'length', type: 'number', min: 1, max: 20000, step: 1 },
      { section: 'Quantity' },
      { key: 'quantity', label: 'Pieces', type: 'number', min: 1, max: 9999, step: 1 },
    ],
  },

  // ── SAW / CUT ─────────────────────────────────────────────────────────────
  cut: {
    label: 'Saw / Cut', color: '#101820', textColor: '#99bbcc', borderColor: '#405060',
    hasInput: true, hasOutput: true,
    defaultParams: {
      purpose: 'cut_to_length',   // cut_to_length | crop_ends | section
      sawType: 'band_saw',        // band_saw | cold_saw
      bladeType: 'bi_metal',
      coolant: 'flood',
      kerfMm: 6,
      cropBothEnds: 'yes',        // crop head & tail (inclusion-rich zones)
      cropHeadMm: 75, cropTailMm: 50,
      targetLength: 500,
      numPieces: 1,
      notes: '',
    },
    paramDefs: [
      { section: 'Operation' },
      { key: 'purpose',  label: 'Purpose', type: 'select', options: [
        'cut_to_length','crop_ends','section',
      ]},
      { section: 'Saw Setup' },
      { key: 'sawType',   label: 'Saw Type',      type: 'select', options: ['band_saw','cold_saw'] },
      { key: 'bladeType', label: 'Blade Type',    type: 'select', options: ['bi_metal','carbide_tipped','high_speed_steel'] },
      { key: 'coolant',   label: 'Coolant',       type: 'select', options: ['flood','mist','dry'] },
      { key: 'kerfMm',    label: 'Kerf Width',    unitType: 'length', type: 'number', min: 1, max: 30, step: 0.5 },
      { section: 'Cropping' },
      { key: 'cropBothEnds', label: 'Crop Ends',     type: 'select', options: ['yes','no'], refreshPanel: true },
      { key: 'cropHeadMm',   label: 'Head Crop',     unitType: 'length', type: 'number', min: 0, max: 500, step: 5,
        showWhen: function(p) { return p.cropBothEnds === 'yes'; } },
      { key: 'cropTailMm',   label: 'Tail Crop',     unitType: 'length', type: 'number', min: 0, max: 500, step: 5,
        showWhen: function(p) { return p.cropBothEnds === 'yes'; } },
      { section: 'Output' },
      { key: 'targetLength', label: 'Target Length',  unitType: 'length', type: 'number', min: 1, max: 10000, step: 1 },
      { key: 'numPieces',    label: 'Pieces Cut',     type: 'number', min: 1, max: 999, step: 1 },
      { key: 'notes',        label: 'Notes',           type: 'text' },
    ],
  },

  // ── HEAT (forge furnace) ──────────────────────────────────────────────────
  // Gas-fired (primary) or electric (small jobs).
  heat: {
    label: 'Heat To Work', color: '#201000', textColor: '#ffe090', borderColor: '#b07010',
    hasInput: true, hasOutput: true,
    defaultParams: {
      furnaceType: 'gas', atmosphere: 'air', loadMethod: 'batch',
      targetTemp: 1200, minTemp: 1100, soakMin: 30, scaleLossPct: 1.5,
      furnaceId: '',
    },
    paramDefs: [
      { section: 'Furnace' },
      { key: 'furnaceType', label: 'Furnace Type',   type: 'select', options: ['gas','electric'] },
      { key: 'atmosphere',  label: 'Atmosphere',     type: 'select', options: ['air','nitrogen','controlled_carbon'] },
      { key: 'loadMethod',  label: 'Loading Method', type: 'select', options: ['single_piece','batch','rotary_hearth'] },
      { key: 'furnaceId',   label: 'Furnace ID / #', type: 'text' },
      { section: 'Temperature' },
      { key: 'targetTemp',   label: 'Target Temp',    unitType: 'temp', type: 'number', min: 0, max: 1450, step: 10 },
      { key: 'minTemp',      label: 'Min Forge Temp', unitType: 'temp', type: 'number', min: 0, max: 1450, step: 10 },
      { key: 'soakMin',      label: 'Soak Time (min)',                  type: 'number', min: 1, max: 600,  step: 1  },
      { section: 'Scale Loss' },
      { key: 'scaleLossPct', label: 'Scale Loss (%)', type: 'number', min: 0, max: 10, step: 0.1 },
    ],
  },

  // ── FORGE (press or hammer) ───────────────────────────────────────────────
  forge: {
    label: 'Forge', color: '#200800', textColor: '#ffaa70', borderColor: '#a03008',
    hasInput: true, hasOutput: true,
    defaultParams: {
      equipment: 'press',      // press | hammer
      process: 'open_die',     // open_die | closed_die | upset
      pressTonnage: 2500, numHits: 1,
      dieTemp: 200, lubricant: 'graphite', dieNumber: '',
      flashPct: 0, forgeRatio: 3.0,
      outDiameter: 200, outHeight: 150,
    },
    paramDefs: [
      { section: 'Equipment' },
      { key: 'equipment',    label: 'Equipment',        type: 'select', options: ['press','hammer'] },
      { key: 'process',      label: 'Process Type',     type: 'select', options: ['open_die','closed_die','upset'] },
      { key: 'pressTonnage', label: 'Tonnage (ton)',     type: 'number', min: 10, max: 50000, step: 50 },
      { key: 'numHits',      label: 'Hits / Strokes',   type: 'number', min: 1,  max: 500,   step: 1  },
      { section: 'Tooling' },
      { key: 'dieNumber', label: 'Die / Tool #',      type: 'text' },
      { key: 'dieTemp',   label: 'Die Preheat Temp',  unitType: 'temp', type: 'number', min: 0, max: 500, step: 10 },
      { key: 'lubricant', label: 'Lubricant',          type: 'select', options: ['graphite','oil_graphite','dry','none'] },
      { section: 'Material Flow' },
      { key: 'flashPct',   label: 'Flash Allowance (%)', type: 'number', min: 0, max: 50, step: 0.5 },
      { key: 'forgeRatio', label: 'Forge Ratio (R)',     type: 'number', min: 1, max: 20, step: 0.1 },
      { section: 'Output Dimensions' },
      { key: 'outDiameter', label: 'Output Diameter', unitType: 'length', type: 'number', min: 1, max: 5000, step: 1 },
      { key: 'outHeight',   label: 'Output Height',   unitType: 'length', type: 'number', min: 1, max: 5000, step: 1 },
    ],
  },

  // ── RING MILL ─────────────────────────────────────────────────────────────
  ring_mill: {
    label: 'Ring Mill', color: '#0d1f10', textColor: '#80e0a0', borderColor: '#207040',
    hasInput: true, hasOutput: true,
    defaultParams: {
      preformType: 'pierced_disc',
      mandrelDiam: 100,
      outOD: 800, outID: 600, outHeight: 150,
      odContour: 'none', idContour: 'none',
      rollPasses: 3,
    },
    paramDefs: [
      { section: 'Preform' },
      { key: 'preformType', label: 'Preform Type',     type: 'select', options: ['pierced_disc','pre_ring'] },
      { key: 'mandrelDiam', label: 'Mandrel Diameter', unitType: 'length', type: 'number', min: 10, max: 2000, step: 1 },
      { section: 'Output Dimensions' },
      { key: 'outOD',     label: 'Ring OD',     unitType: 'length', type: 'number', min: 10,  max: 10000, step: 1 },
      { key: 'outID',     label: 'Ring ID',     unitType: 'length', type: 'number', min: 1,   max: 9000,  step: 1 },
      { key: 'outHeight', label: 'Ring Height', unitType: 'length', type: 'number', min: 1,   max: 5000,  step: 1 },
      { section: 'Contour' },
      { key: 'odContour', label: 'OD Contour', type: 'select', options: ['none','forged','machined'] },
      { key: 'idContour', label: 'ID Contour', type: 'select', options: ['none','forged','machined'] },
      { section: 'Process' },
      { key: 'rollPasses', label: 'Rolling Passes', type: 'number', min: 1, max: 20, step: 1 },
    ],
  },

  // ── TRIM FLASH ────────────────────────────────────────────────────────────
  trim: {
    label: 'Trim Flash', color: '#101828', textColor: '#90b0e0', borderColor: '#304880',
    hasInput: true, hasOutput: true,
    defaultParams: {
      flashPct: 15, trimCondition: 'hot',
      dieType: 'conventional', dieNumber: '', flashDisposition: 'scrap_recycle',
    },
    paramDefs: [
      { section: 'Trim Operation' },
      { key: 'trimCondition', label: 'Trim Condition', type: 'select', options: ['hot','warm','cold'] },
      { key: 'dieType',       label: 'Trim Die Type',  type: 'select', options: ['conventional','precision'] },
      { key: 'dieNumber',     label: 'Die Number',     type: 'text' },
      { section: 'Flash' },
      { key: 'flashPct',         label: 'Flash to Remove (%)', type: 'number', min: 0, max: 50, step: 0.5 },
      { key: 'flashDisposition', label: 'Flash Disposition',   type: 'select', options: [
        'scrap_recycle','remelt','reforge',
      ]},
    ],
  },

  // ── HEAT TREAT ────────────────────────────────────────────────────────────
  // Furnace (gas or electric) + water quench tank.
  heat_treat: {
    label: 'Heat Treat', color: '#140828', textColor: '#c0a0f0', borderColor: '#5838a8',
    hasInput: true, hasOutput: true,
    defaultParams: {
      process: 'normalize', specNumber: '',
      furnaceType: 'gas',
      targetTemp: 900, soakMin: 60,
      quenchant: 'water', quenchAgitation: 'still',
      temperTemp: 0, temperSoakMin: 0,
      hardnessScale: 'HB', targetHardnessMin: 0, targetHardnessMax: 0,
    },
    paramDefs: [
      { section: 'Process' },
      { key: 'process',    label: 'Process Type', type: 'select', options: [
        'normalize','anneal','stress_relief','quench_temper',
      ], refreshPanel: true },
      { key: 'specNumber', label: 'Spec / Standard #', type: 'text' },
      { section: 'Furnace' },
      { key: 'furnaceType', label: 'Furnace Type', type: 'select', options: ['gas','electric'] },
      { section: 'Heat' },
      { key: 'targetTemp', label: 'Heat Temp',  unitType: 'temp', type: 'number', min: 100, max: 1300, step: 10 },
      { key: 'soakMin',    label: 'Soak (min)',                   type: 'number', min: 1,   max: 2400, step: 5  },
      { section: 'Quench', showWhen: function(p) { return p.process === 'quench_temper'; } },
      { key: 'quenchant',       label: 'Quench Medium', type: 'select', options: ['air','water','none'] },
      { key: 'quenchAgitation', label: 'Agitation',     type: 'select', options: ['still','agitated'] },
      { section: 'Temper', showWhen: function(p) { return p.process === 'quench_temper'; } },
      { key: 'temperTemp',    label: 'Temper Temp',    unitType: 'temp', type: 'number', min: 0, max: 800, step: 10 },
      { key: 'temperSoakMin', label: 'Temper Soak (min)',                type: 'number', min: 0, max: 2400, step: 5 },
      { section: 'Target Properties' },
      { key: 'hardnessScale',     label: 'Hardness Scale', type: 'select', options: ['HB','HRC','HRB','HV'] },
      { key: 'targetHardnessMin', label: 'Min Hardness',  type: 'number', min: 0, max: 999, step: 1 },
      { key: 'targetHardnessMax', label: 'Max Hardness',  type: 'number', min: 0, max: 999, step: 1 },
    ],
  },

  // ── MACHINE ───────────────────────────────────────────────────────────────
  // Covers: lathe, vertical mill, boullard, drill press, saw, sander, grinder.
  machine: {
    label: 'Machine', color: '#081a14', textColor: '#70e0c0', borderColor: '#187050',
    hasInput: true, hasOutput: true,
    defaultParams: {
      equipment: 'lathe',
      operation: 'turn',
      numSetups: 1,
      programNumber: '', setupNumber: '',
      stockPerSurface: 3, outDiameter: 100, outHeight: 150,
      surfaceFinish: '125', toleranceClass: 'IT7',
    },
    paramDefs: [
      { section: 'Equipment' },
      { key: 'equipment', label: 'Equipment', type: 'select', options: [
        'lathe','vertical_mill','boullard','drill_press','saw','sander','grinder',
      ], refreshPanel: true },
      { key: 'operation', label: 'Primary Operation', type: 'select',
        optionsFor: function(p) {
          var map = {
            lathe:         ['turn','face','bore','thread'],
            vertical_mill: ['mill','face','drill','profile'],
            boullard:      ['mill','profile','face'],
            drill_press:   ['drill'],
            saw:           ['cut'],
            sander:        ['sand'],
            grinder:       ['grind'],
          };
          return map[p.equipment] || ['turn','face','bore','mill','drill','grind','cut','sand','profile'];
        },
      },
      { key: 'numSetups', label: 'Number of Setups', type: 'number', min: 1, max: 20, step: 1 },
      { section: 'Reference' },
      { key: 'programNumber', label: 'Program / Ref #', type: 'text' },
      { key: 'setupNumber',   label: 'Setup Sheet #',   type: 'text' },
      { section: 'Output Dimensions' },
      { key: 'stockPerSurface', label: 'Stock / Surface', unitType: 'length', type: 'number', min: 0, max: 25,   step: 0.5 },
      { key: 'outDiameter',     label: 'Final OD',        unitType: 'length', type: 'number', min: 1, max: 5000, step: 1   },
      { key: 'outHeight',       label: 'Final Height',    unitType: 'length', type: 'number', min: 1, max: 5000, step: 1   },
      { section: 'Quality' },
      { key: 'surfaceFinish',  label: 'Surface Finish (Ra μin)', type: 'select', options: ['16','32','63','125','250','500'] },
      { key: 'toleranceClass', label: 'Tolerance Class',         type: 'select', options: ['IT5','IT6','IT7','IT8','IT9','IT10','IT11'] },
    ],
  },

  // ── WELD ──────────────────────────────────────────────────────────────────
  // Arc or MIG, shielding gas: argon or 730.
  weld: {
    label: 'Weld', color: '#1a1000', textColor: '#ffd060', borderColor: '#806010',
    hasInput: true, hasOutput: true,
    defaultParams: {
      process: 'arc', shieldingGas: 'argon',
      filler: '', passes: 1, pwht: 'none', notes: '',
    },
    paramDefs: [
      { section: 'Process' },
      { key: 'process',      label: 'Weld Process',    type: 'select', options: ['arc','mig'] },
      { key: 'shieldingGas', label: 'Shielding Gas',   type: 'select', options: ['argon','730','none'] },
      { key: 'filler',       label: 'Filler / Rod #',  type: 'text' },
      { key: 'passes',       label: 'Number of Passes',type: 'number', min: 1, max: 100, step: 1 },
      { section: 'Post-Weld' },
      { key: 'pwht',  label: 'Post-Weld HT', type: 'select', options: ['none','stress_relief'] },
      { key: 'notes', label: 'Notes',         type: 'text' },
    ],
  },

  // ── INSPECT ───────────────────────────────────────────────────────────────
  // Equipment: Brinell hardness tester, tape/CMM for dimensional, multiped temp recorder.
  inspect: {
    label: 'Inspect', color: '#081a0a', textColor: '#80e090', borderColor: '#188030',
    hasInput: true, hasOutput: true,
    defaultParams: {
      method: 'dimensional', specNumber: '',
      checkDimensional: 'yes', checkHardness: 'no', checkTemp: 'no',
      samplingPlan: '100_percent',
      result: 'pending',
    },
    paramDefs: [
      { section: 'Inspection' },
      { key: 'method', label: 'Primary Method', type: 'select', options: [
        'dimensional','hardness_brinell','temperature','visual','combined',
      ]},
      { key: 'specNumber', label: 'Spec / Dwg #', type: 'text' },
      { section: 'Required Checks' },
      { key: 'checkDimensional', label: 'Dimensional',        type: 'select', options: ['yes','no'] },
      { key: 'checkHardness',    label: 'Brinell Hardness',   type: 'select', options: ['yes','no'] },
      { key: 'checkTemp',        label: 'Temperature Record', type: 'select', options: ['yes','no'] },
      { section: 'Sampling' },
      { key: 'samplingPlan', label: 'Sampling Plan', type: 'select', options: [
        '100_percent','first_article','AQL','statistical',
      ]},
      { section: 'Disposition' },
      { key: 'result', label: 'Result / Status', type: 'select', options: [
        'pending','pass','fail','conditional_pass','hold_for_review','scrap',
      ]},
    ],
  },

  // ── STOCK OUT ─────────────────────────────────────────────────────────────
  // This forge sells: bars (round/rect/hex, optionally stepped), discs, rings, mushrooms.
  stock_out: {
    label: 'Stock Out', color: '#001828', textColor: '#80d0f0', borderColor: '#0070a0',
    hasInput: true, hasOutput: false,
    defaultParams: {
      productType: 'bar',           // bar | disc | ring | mushroom
      // Bar
      barShape: 'round',            // round | rectangular | hexagonal
      isStepped: 'no',
      numSteps: 1,
      barDiameter: 100, barAcrossFlats: 100, barWidth: 100, barThickness: 50, barLength: 500,
      // Disc
      discOD: 300, discThickness: 80,
      // Ring
      ringOD: 400, ringID: 200, ringHeight: 100,
      odContour: 'none', idContour: 'none',
      // Mushroom
      flangeDiam: 300, stemDiam: 100, totalHeight: 200,
      // Identification & shipping
      partNumber: '', partRevision: '', workOrderNumber: '',
      customerName: '', shippingMethod: 'ground',
      certRequired: 'yes', certType: 'C_of_C',
    },
    paramDefs: [
      { section: 'Product' },
      { key: 'productType', label: 'Product Type', type: 'select', options: [
        'bar','disc','ring','mushroom',
      ], refreshPanel: true },
      { section: 'Bar', showWhen: function(p) { return p.productType === 'bar'; } },
      { key: 'barShape',  label: 'Bar Shape',       type: 'select', options: ['round','rectangular','hexagonal'], refreshPanel: true },
      { key: 'isStepped', label: 'Stepped Bar',     type: 'select', options: ['no','yes'], refreshPanel: true },
      { key: 'numSteps',  label: 'Number of Steps', type: 'number', min: 1, max: 12, step: 1,
        showWhen: function(p) { return p.isStepped === 'yes'; } },
      { key: 'barDiameter',    label: 'Round OD',         unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.barShape === 'round'; } },
      { key: 'barAcrossFlats', label: 'Hex Across Flats', unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.barShape === 'hexagonal'; } },
      { key: 'barWidth',       label: 'Rect Width',       unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.barShape === 'rectangular'; } },
      { key: 'barThickness',   label: 'Rect Thickness',   unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1,
        showWhen: function(p) { return p.barShape === 'rectangular'; } },
      { key: 'barLength',      label: 'Length',            unitType: 'length', type: 'number', min: 1, max: 20000, step: 1 },
      { section: 'Disc', showWhen: function(p) { return p.productType === 'disc'; } },
      { key: 'discOD',        label: 'Disc OD',        unitType: 'length', type: 'number', min: 1, max: 10000, step: 1 },
      { key: 'discThickness', label: 'Disc Thickness', unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1 },
      { section: 'Ring', showWhen: function(p) { return p.productType === 'ring'; } },
      { key: 'ringOD',     label: 'Ring OD',    unitType: 'length', type: 'number', min: 1,  max: 10000, step: 1 },
      { key: 'ringID',     label: 'Ring ID',    unitType: 'length', type: 'number', min: 1,  max: 9000,  step: 1 },
      { key: 'ringHeight', label: 'Ring Height',unitType: 'length', type: 'number', min: 1,  max: 5000,  step: 1 },
      { key: 'odContour',  label: 'OD Contour', type: 'select', options: ['none','forged','machined'] },
      { key: 'idContour',  label: 'ID Contour', type: 'select', options: ['none','forged','machined'] },
      { section: 'Mushroom', showWhen: function(p) { return p.productType === 'mushroom'; } },
      { key: 'flangeDiam',  label: 'Flange Diameter', unitType: 'length', type: 'number', min: 1, max: 10000, step: 1 },
      { key: 'stemDiam',    label: 'Stem Diameter',   unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1 },
      { key: 'totalHeight', label: 'Total Height',    unitType: 'length', type: 'number', min: 1, max: 5000,  step: 1 },
      { section: 'Identification' },
      { key: 'partNumber',      label: 'Part Number',  type: 'text' },
      { key: 'partRevision',    label: 'Revision',     type: 'text' },
      { key: 'workOrderNumber', label: 'Work Order #', type: 'text' },
      { section: 'Shipping' },
      { key: 'customerName',   label: 'Customer',        type: 'text' },
      { key: 'shippingMethod', label: 'Shipping Method', type: 'select', options: [
        'ground','air_freight','ocean_freight','will_call','internal_transfer',
      ]},
      { section: 'Certification' },
      { key: 'certRequired', label: 'Cert Required', type: 'select', options: ['yes','no'] },
      { key: 'certType',     label: 'Cert Type',     type: 'select', options: [
        'C_of_C','material_test_report','first_article','PPAP','FAIR','none',
      ]},
    ],
  },

};

// ===========================================================================
// CALCULATION ENGINE
// ===========================================================================

export function computeChain() {
  var startNode = S.getNodes().find(function(n) { return n.type === 'stock_in'; });
  if (!startNode) return [];

  var chain = [];
  var visited = {};
  var current = startNode;
  var massKg = 0;
  var dims = {};

  while (current && !visited[current.id]) {
    visited[current.id] = true;

    var conn = S.getConnections().find(function(c) { return c.fromId === current.id; });

    // Compute current node (pass 1 / only pass)
    var step = computeStep(current, massKg, dims);
    chain.push(step);
    massKg = step.massOut;
    dims   = step.dimsOut;

    if (!conn) break;

    var nextNode = S.getNodes().find(function(n) { return n.id === conn.toId; });
    if (!nextNode) break;

    // Expand cycles: run destination node (cycle-1) extra times before moving forward
    var cycles = Math.max(1, conn.cycle || 1);
    for (var ci = 1; ci < cycles; ci++) {
      var cycleStep = computeStep(nextNode, massKg, dims);
      cycleStep.label = (nextNode.label || NODE_DEFS[nextNode.type].label) + '  ×' + (ci + 1);
      cycleStep.isCycle = true;
      chain.push(cycleStep);
      massKg = cycleStep.massOut;
      dims   = cycleStep.dimsOut;
    }

    current = nextNode;
  }
  return chain;
}

function computeStep(node, massIn, dimsIn) {
  var p   = node.params;
  var def = NODE_DEFS[node.type];
  var step = {
    nodeId: node.id, nodeType: node.type,
    label: node.label || def.label,
    massIn: round3(massIn), massLoss: 0, massOut: 0, lossPct: 0,
    dimsIn: dimsIn, dimsOut: {}, calcs: [],
  };

  switch (node.type) {

    case 'stock_in': {
      var dens = p.density || S.getGeneral().density;
      // Volume depends on cross-section geometry
      var vol_mm3;
      var geom = p.geometry || 'round_cylinder';
      if (geom === 'rectangular_prism') {
        vol_mm3 = (p.width || 0) * (p.sectionHeight || 0) * (p.length || 0);
      } else if (geom === 'round_corner_square') {
        // True RCS area = side² − (4−π)×R²
        var side = p.side || 0; var Rc = p.cornerRadius || 0;
        var A_rcs = Math.max(0, side * side - (4 - Math.PI) * Rc * Rc);
        vol_mm3 = A_rcs * (p.length || 0);
      } else {
        // round_cylinder (default)
        vol_mm3 = Math.PI * Math.pow((p.diameter || 0) / 2, 2) * (p.length || 0);
      }
      var massPerPc = round3(vol_mm3 / 1e6 * dens);
      var totalMass = round3(massPerPc * (p.quantity || 1));
      step.massIn  = 0;
      step.massOut = totalMass;
      step.dimsOut = { diameter: p.diameter || p.side || p.width, height: p.sectionHeight, length: p.length, geometry: geom };
      step.calcs   = [
        { label: 'Stock type',   result: (p.stockType||'billet') },
        { label: 'Material',     result: (p.grade||'—') + '  (' + (p.condition||'').replace(/_/g,' ') + ')' },
        { label: 'Family',       result: (MATERIAL_CATALOG[p.materialFamily]||{}).label || (p.materialFamily||'—') },
        { label: 'PO / Heat',    result: [(p.poNumber||'—'), (p.heatNumber||'—')].join('  /  ') },
        { label: 'Cross-section',result: geom.replace(/_/g,' ') },
        { label: 'Volume / pc',  result: dVol(vol_mm3) },
        { label: 'Mass / pc',    result: dMass(massPerPc) },
        { label: 'Total mass',   result: dMass(totalMass) + '  (' + (p.quantity||1) + ' pc' + ((p.quantity||1) > 1 ? 's' : '') + ')' },
      ];
      break;
    }

    case 'cut': {
      // Work out the incoming cross-section area from dimsIn
      var geomC = dimsIn.geometry || 'round_cylinder';
      var Ac;
      if (geomC === 'rectangular_prism') {
        Ac = (dimsIn.width || 0) * (dimsIn.height || 0);
      } else if (geomC === 'round_corner_square') {
        var Sc = dimsIn.diameter || 0; var Rcc = 0;
        Ac = Math.max(0, Sc * Sc - (4 - Math.PI) * Rcc * Rcc);
      } else {
        var Dc = dimsIn.diameter || 0;
        Ac = Math.PI * Math.pow(Dc / 2, 2);
      }
      var densC   = S.getGeneral().density;
      var cropH   = p.cropBothEnds === 'yes' ? (p.cropHeadMm || 0) : 0;
      var cropT   = p.cropBothEnds === 'yes' ? (p.cropTailMm || 0) : 0;
      var cropTot = cropH + cropT;
      // mass lost to crop ends + kerf(s)
      var kerf    = p.kerfMm || 0;
      var numCuts = (p.numPieces || 1) + (p.cropBothEnds === 'yes' ? 1 : 0); // cuts = pieces + 1 crop cut
      var kerfLoss= round3(Ac * kerf * numCuts / 1e6 * densC);
      var cropLoss= round3(Ac * cropTot / 1e6 * densC);
      var totalLossC = round3(kerfLoss + cropLoss);
      step.massOut  = round3(Math.max(0, massIn - totalLossC));
      step.massLoss = totalLossC;
      step.dimsOut  = Object.assign({}, dimsIn, { length: p.targetLength || dimsIn.length });
      step.calcs    = [
        { label: 'Purpose',      result: (p.purpose||'cut_to_length').replace(/_/g,' ') },
        { label: 'Saw / Blade',  result: (p.sawType||'band_saw').replace(/_/g,' ') + '  ·  ' + (p.bladeType||'bi_metal').replace(/_/g,' ') },
        { label: 'Crop (H + T)', result: dLen(cropH) + ' + ' + dLen(cropT) + '  =  ' + dLen(cropTot) },
        { label: 'Kerf × cuts',  result: dLen(kerf) + ' × ' + numCuts + ' cuts' },
        { label: 'Crop loss',    result: dMass(cropLoss) },
        { label: 'Kerf loss',    result: dMass(kerfLoss) },
        { label: 'Mass out',     result: dMass(step.massOut) },
      ];
      break;
    }


    case 'heat': {
      var scaleLoss = round3(massIn * ((p.scaleLossPct||0) / 100));
      step.massOut  = round3(massIn - scaleLoss);
      step.massLoss = scaleLoss;
      step.dimsOut  = Object.assign({}, dimsIn);
      step.calcs    = [
        { label: 'Furnace',     result: (p.furnaceType||'gas') + '  ·  ' + (p.atmosphere||'air') },
        { label: 'Loading',     result: (p.loadMethod||'batch').replace(/_/g,' ') + (p.furnaceId ? '  #' + p.furnaceId : '') },
        { label: 'Target temp', result: dTemp(p.targetTemp) + '  (min: ' + dTemp(p.minTemp) + ')' },
        { label: 'Soak',        result: (p.soakMin||0) + ' min' },
        { label: 'Scale loss',  result: dMass(scaleLoss) + '  (' + (p.scaleLossPct||0) + '%)' },
        { label: 'Mass out',    result: dMass(step.massOut) },
      ];
      break;
    }

    case 'forge': {
      var h0f = dimsIn.length || dimsIn.height || 0;
      var h1f = p.outHeight || 0;
      var epsF = (h0f > 0 && h1f > 0) ? round3(Math.log(h0f / h1f)) : null;
      var pctF = (h0f > 0 && h1f > 0) ? round3((h0f - h1f) / h0f * 100) : null;
      var flashLoss = round3(massIn * ((p.flashPct||0) / 100));
      step.massOut  = round3(massIn - flashLoss);
      step.massLoss = flashLoss;
      step.dimsOut  = { diameter: p.outDiameter, height: p.outHeight };
      step.calcs    = [
        { label: 'Equipment',     result: (p.equipment||'press') + '  ·  ' + (p.process||'open_die').replace(/_/g,' ') },
        { label: 'Tonnage / Hits',result: (p.pressTonnage||'—') + ' ton  ×  ' + (p.numHits||1) + ' hit' + ((p.numHits||1) > 1 ? 's' : '') },
        { label: 'Die / Lube',   result: (p.dieNumber ? '#' + p.dieNumber + '  ·  ' : '') + dTemp(p.dieTemp||200) + '  ·  ' + (p.lubricant||'graphite').replace(/_/g,' ') },
        { label: 'Flash loss',   result: dMass(flashLoss) + '  (' + (p.flashPct||0) + '%)' },
        { label: 'Mass out',     result: dMass(step.massOut) },
        { label: 'Forge ratio R',result: (p.forgeRatio||0) + ' : 1' + ((p.forgeRatio||0) >= 3 ? '  ✓' : '  ⚠') },
        { label: 'True strain ε',result: epsF !== null ? '' + epsF : '—' },
        { label: '% Height red.',result: pctF !== null ? pctF + '%' : '—' },
      ];
      break;
    }

    case 'ring_mill': {
      var odR = p.outOD || 0; var idR = p.outID || 0; var htR = p.outHeight || 0;
      var volRing = Math.max(0, Math.PI / 4 * (odR * odR - idR * idR) * htR);
      var massRing = round3(volRing / 1e6 * S.getGeneral().density);
      step.massOut  = massRing;
      step.massLoss = round3(Math.max(0, massIn - massRing));
      step.dimsOut  = { od: odR, id: idR, height: htR, diameter: odR };
      step.calcs    = [
        { label: 'Preform',       result: (p.preformType||'pierced_disc').replace(/_/g,' ') + '  ·  mandrel Ø ' + dLen(p.mandrelDiam||0) },
        { label: 'Ring OD / ID',  result: dLen(odR) + ' OD  ×  ' + dLen(idR) + ' ID' },
        { label: 'Ring height',   result: dLen(htR) },
        { label: 'OD / ID contour',result: (p.odContour||'none') + '  /  ' + (p.idContour||'none') },
        { label: 'Rolling passes',result: (p.rollPasses||1) + ' passes' },
        { label: 'Ring volume',   result: dVol(volRing) },
        { label: 'Mass out',      result: dMass(massRing) },
      ];
      break;
    }

    case 'trim': {
      var trimLoss = round3(massIn * ((p.flashPct||0) / 100));
      step.massOut  = round3(massIn - trimLoss);
      step.massLoss = trimLoss;
      step.dimsOut  = Object.assign({}, dimsIn);
      step.calcs    = [
        { label: 'Condition',     result: (p.trimCondition||'hot') + '  ·  ' + (p.dieType||'conventional').replace(/_/g,' ') + ' die' },
        { label: 'Flash removed', result: dMass(trimLoss) + '  (' + (p.flashPct||0) + '%)' },
        { label: 'Disposition',   result: (p.flashDisposition||'scrap_recycle').replace(/_/g,' ') },
        { label: 'Mass out',      result: dMass(step.massOut) },
      ];
      break;
    }

    case 'heat_treat': {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      var htHardness = (p.targetHardnessMin > 0 || p.targetHardnessMax > 0)
        ? p.targetHardnessMin + '–' + p.targetHardnessMax + ' ' + (p.hardnessScale||'HB')
        : '—';
      step.calcs    = [
        { label: 'Process',   result: (p.process||'normalize').replace(/_/g,' ') + (p.specNumber ? '  ·  ' + p.specNumber : '') },
        { label: 'Furnace',   result: (p.furnaceType||'gas') + '  ·  heat ' + dTemp(p.targetTemp||0) + '  ·  ' + (p.soakMin||60) + ' min' },
        { label: 'Quench',    result: (p.quenchant||'water') + '  (' + (p.quenchAgitation||'still') + ')' },
        { label: 'Temper',    result: (p.temperTemp||0) > 0 ? dTemp(p.temperTemp) + '  ·  ' + (p.temperSoakMin||0) + ' min' : 'none' },
        { label: 'Target HRD',result: htHardness },
        { label: 'Mass',      result: dMass(massIn) + '  (no loss)' },
      ];
      break;
    }

    case 'machine': {
      var dInM  = dimsIn.diameter || dimsIn.od || 100;
      var hInM  = dimsIn.height   || 150;
      var volIn  = Math.PI * Math.pow(dInM / 2, 2) * hInM;
      var volOut = Math.PI * Math.pow((p.outDiameter||dInM) / 2, 2) * (p.outHeight||hInM);
      var chipMass = round3(Math.max(0, (volIn - volOut) / 1e6 * S.getGeneral().density));
      step.massOut  = round3(Math.max(0, massIn - chipMass));
      step.massLoss = chipMass;
      step.dimsOut  = { diameter: p.outDiameter, height: p.outHeight };
      step.calcs    = [
        { label: 'Equipment',    result: (p.equipment||'lathe').replace(/_/g,' ') + '  ·  ' + (p.operation||'turn') },
        { label: 'Setups',       result: (p.numSetups||1) + ' setup' + ((p.numSetups||1) > 1 ? 's' : '') },
        { label: 'Stock/surface',result: dLen(p.stockPerSurface||0) },
        { label: 'Final OD',     result: dLen(p.outDiameter||0) },
        { label: 'Final H',      result: dLen(p.outHeight||0) },
        { label: 'Finish / Tol', result: (p.surfaceFinish||'125') + ' Ra  ·  ' + (p.toleranceClass||'IT7') },
        { label: 'Chip loss',    result: dMass(chipMass) },
        { label: 'Mass out',     result: dMass(step.massOut) },
      ];
      break;
    }

    case 'weld': {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      step.calcs    = [
        { label: 'Process',     result: (p.process||'arc') + '  ·  gas: ' + (p.shieldingGas||'argon') },
        { label: 'Filler',      result: p.filler || '—' },
        { label: 'Passes',      result: (p.passes||1) + ' pass' + ((p.passes||1) > 1 ? 'es' : '') },
        { label: 'Post-weld HT',result: (p.pwht||'none').replace(/_/g,' ') },
        { label: 'Mass',        result: dMass(massIn) + '  (pass-through)' },
      ];
      break;
    }

    case 'inspect': {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      var checks = [];
      if (p.checkDimensional === 'yes') checks.push('dimensional');
      if (p.checkHardness    === 'yes') checks.push('Brinell hardness');
      if (p.checkTemp        === 'yes') checks.push('temperature record');
      step.calcs    = [
        { label: 'Method',   result: (p.method||'dimensional').replace(/_/g,' ') + (p.specNumber ? '  ·  ' + p.specNumber : '') },
        { label: 'Sampling', result: (p.samplingPlan||'100_percent').replace(/_/g,' ') },
        { label: 'Checks',   result: checks.length > 0 ? checks.join(', ') : 'per method' },
        { label: 'Result',   result: (p.result||'pending').replace(/_/g,' ') },
        { label: 'Mass',     result: dMass(massIn) + '  (pass-through)' },
      ];
      break;
    }

    case 'stock_out': {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      var prodType = p.productType || 'bar';
      var prodDesc = '';
      if (prodType === 'bar') {
        prodDesc = (p.barShape||'round') + ' bar' + (p.isStepped === 'yes' ? '  (' + (p.numSteps||1) + '-step)' : '');
      } else if (prodType === 'disc') {
        prodDesc = 'disc  ' + dLen(p.discOD||0) + ' Ø × ' + dLen(p.discThickness||0);
      } else if (prodType === 'ring') {
        prodDesc = 'ring  OD ' + dLen(p.ringOD||0) + '  ID ' + dLen(p.ringID||0) + '  H ' + dLen(p.ringHeight||0);
        if (p.odContour !== 'none') prodDesc += '  OD-contour: ' + p.odContour;
        if (p.idContour !== 'none') prodDesc += '  ID-contour: ' + p.idContour;
      } else if (prodType === 'mushroom') {
        prodDesc = 'mushroom  flange Ø ' + dLen(p.flangeDiam||0) + '  stem Ø ' + dLen(p.stemDiam||0);
      }
      step.calcs    = [
        { label: 'Product',   result: prodDesc },
        { label: 'Part',      result: (p.partNumber||'—') + (p.partRevision ? '  Rev ' + p.partRevision : '') + (p.workOrderNumber ? '  WO: ' + p.workOrderNumber : '') },
        { label: 'Customer',  result: (p.customerName||'—') + '  ·  ' + (p.shippingMethod||'ground').replace(/_/g,' ') },
        { label: 'Cert',      result: p.certRequired === 'yes' ? (p.certType||'C_of_C').replace(/_/g,' ') : 'none required' },
        { label: 'Mass out',  result: dMass(massIn) },
      ];
      break;
    }

    default: {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      step.calcs    = [{ label: 'Mass (pass-through)', result: dMass(massIn) }];
      break;
    }
  }

  step.lossPct = step.massIn > 0 ? round3(step.massLoss / step.massIn * 100) : 0;
  return step;
}

export function fmtVol(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(3) + ' ×10⁶';
  return Math.round(v).toLocaleString();
}

export function round3(v) { return Math.round(v * 1000) / 1000; }
export function dMass(kg) {
  if (S.getUnitSystem() === 'imperial') {
    return round3(kg * 2.20462) + ' lb';
  }
  return kg + ' kg';
}

export function dLen(mm) {
  if (S.getUnitSystem() === 'imperial') {
    return round3(mm / 25.4) + ' in';
  }
  return mm + ' mm';
}

export function dTemp(celsius) {
  if (S.getUnitSystem() === 'imperial') {
    return round3(celsius * 9 / 5 + 32) + ' °F';
  }
  return celsius + ' °C';
}

export function dVol(mm3) {
  if (S.getUnitSystem() === 'imperial') {
    return round3(mm3 / 16387.064) + ' in³';
  }
  return fmtVol(mm3) + ' mm³';
}

export function dDensity(g_cm3) {
  if (S.getUnitSystem() === 'imperial') {
    return round3(g_cm3 * 0.036127) + ' lb/in³';
  }
  return g_cm3 + ' g/cm³';
}

export function dMassUnit()   { return S.getUnitSystem() === 'imperial' ? 'lb'    : 'kg';    }
export function dLenUnit()    { return S.getUnitSystem() === 'imperial' ? 'in'    : 'mm';    }
export function dTempUnit()   { return S.getUnitSystem() === 'imperial' ? '°F'   : '°C';   }
export function dVolUnit()    { return S.getUnitSystem() === 'imperial' ? 'in³'  : 'mm³';  }
export function dDensUnit()   { return S.getUnitSystem() === 'imperial' ? 'lb/in³': 'g/cm³'; }

// ---------------------------------------------------------------------------
// Display unit conversion helpers (used by _process.js, _inputs.js, printToPDF)
// Living here in main breaks the _process ↔ _inputs circular dependency.
// ---------------------------------------------------------------------------

export function toDisplay(v, unitType) {
  if (unitType === 'length')  return S.getUnitSystem() === 'imperial' ? round3(v / 25.4) : v;
  if (unitType === 'temp')    return S.getUnitSystem() === 'imperial' ? round3(v * 9 / 5 + 32) : v;
  if (unitType === 'density') return S.getUnitSystem() === 'imperial' ? round3(v * 0.036127) : v;
  return v;
}
export function fromDisplay(v, unitType) {
  if (unitType === 'length')  return S.getUnitSystem() === 'imperial' ? round3(v * 25.4) : v;
  if (unitType === 'temp')    return S.getUnitSystem() === 'imperial' ? round3((v - 32) * 5 / 9) : v;
  if (unitType === 'density') return S.getUnitSystem() === 'imperial' ? round3(v / 0.036127) : v;
  return v;
}
export function unitSuffix(unitType) {
  if (unitType === 'length')  return S.getUnitSystem() === 'imperial' ? ' (in)'     : ' (mm)';
  if (unitType === 'temp')    return S.getUnitSystem() === 'imperial' ? ' (°F)'    : ' (°C)';
  if (unitType === 'density') return S.getUnitSystem() === 'imperial' ? ' (lb/in³)' : ' (g/cm³)';
  return '';
}
export function scaleParam(pd) {
  if (!pd.unitType) return { min: pd.min, max: pd.max, step: pd.step || 1 };
  if (pd.unitType === 'length' && S.getUnitSystem() === 'imperial') {
    return { min: round3(pd.min / 25.4), max: round3(pd.max / 25.4), step: round3((pd.step || 1) / 25.4) };
  }
  if (pd.unitType === 'temp' && S.getUnitSystem() === 'imperial') {
    return { min: round3(pd.min * 9/5 + 32), max: round3(pd.max * 9/5 + 32), step: pd.step ? round3(pd.step * 9/5) : 1 };
  }
  if (pd.unitType === 'density' && S.getUnitSystem() === 'imperial') {
    return { min: round3(pd.min * 0.036127), max: round3(pd.max * 0.036127), step: round3((pd.step || 0.01) * 0.036127) };
  }
  return { min: pd.min, max: pd.max, step: pd.step || 1 };
}


// ===========================================================================
// DOM BUILDER
// ===========================================================================

export function buildInputSection(title, fields) {
  var section = document.createElement('div');
  Object.assign(section.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    fontSize: '9px', letterSpacing: '2.5px', textTransform: 'uppercase', color: ACCENT,
    paddingBottom: '6px', borderBottom: '1px solid ' + ACCENT_DIM + '0.25)',
  });
  hdr.textContent = title;
  section.appendChild(hdr);
  fields.forEach(function(f) { if (f) section.appendChild(f); });
  return section;
}

export function buildTextInput(label, id, value, onChange) {
  var wrap = fWrap();
  wrap.appendChild(fLabel(label, id));
  var inp = document.createElement('input');
  inp.type = 'text'; inp.id = id; inp.value = value || '';
  sInput(inp);
  inp.addEventListener('input', function() { if (onChange) onChange(inp.value); });
  wrap.appendChild(inp);
  return wrap;
}

export function buildNumberInputEl(label, id, value, min, max, step, onChange) {
  var wrap = fWrap();
  wrap.appendChild(fLabel(label, id));
  var inp = document.createElement('input');
  inp.type = 'number'; inp.id = id; inp.value = value;
  inp.min = min; inp.max = max; inp.step = step || 1;
  sInput(inp);
  inp.addEventListener('change', function() { if (onChange) onChange(parseFloat(inp.value) || value); });
  wrap.appendChild(inp);
  return wrap;
}

export function buildSelectEl(label, id, options, value, onChange) {
  var wrap = fWrap();
  wrap.appendChild(fLabel(label, id));
  var sel = document.createElement('select');
  sel.id = id; sInput(sel); sel.style.cursor = 'pointer';
  options.forEach(function(o) {
    var opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', function() { if (onChange) onChange(sel.value); });
  wrap.appendChild(sel);
  return wrap;
}

export function buildTextareaInput(label, id, value, onChange) {
  var wrap = fWrap();
  wrap.appendChild(fLabel(label, id));
  var ta = document.createElement('textarea');
  ta.id = id;
  ta.value = value || '';
  ta.rows = 3;
  sInput(ta);
  Object.assign(ta.style, { resize: 'vertical', minHeight: '56px', lineHeight: '1.5' });
  ta.addEventListener('input', function() { if (onChange) onChange(ta.value); });
  wrap.appendChild(ta);
  return wrap;
}

export function fWrap() {
  var el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: '4px' });
  return el;
}
export function fLabel(text, forId) {
  var lbl = document.createElement('label');
  lbl.htmlFor = forId;
  Object.assign(lbl.style, { fontSize: '8px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#99b0c0' });
  lbl.textContent = text;
  return lbl;
}
export function sInput(el) {
  Object.assign(el.style, {
    background: 'rgba(255,255,255,0.14)', border: '2px solid rgba(255,255,255,0.18)',
    borderRadius: '3px', color: '#c0ccd8', padding: '6px 8px', fontSize: '11px',
    fontFamily: 'inherit', outline: 'none', transition: 'border-color 0.2s ease', width: '100%',
  });
  el.addEventListener('focus', function() { el.style.borderColor = ACCENT_DIM + '0.7)'; });
  el.addEventListener('blur',  function() { el.style.borderColor = 'rgba(255,255,255,0.18)'; });
}