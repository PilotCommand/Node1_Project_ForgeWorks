// ============================================================================
// manufacturingreview.js — Manufacturing Review v2 (Node Flow Editor)
// Forgeworks Infrastructure
// ============================================================================
//
// Layout:
//   Top bar    — navigation, title
//   Left panel — general job inputs / selected node parameters
//   Center     — process flow canvas (right-click to add nodes, drag to connect)
//   Right panel — chain mass-balance calculations
//   Bottom bar  — save, load, print
//
// Canvas interaction:
//   Right-click empty area  → context menu → add node type
//   Right-click on node     → delete / duplicate
//   Drag node body          → move node
//   Drag from output port ● → draw connection to input port ●
//   Click node              → select (shows params in left panel)
//   Click empty canvas      → deselect
//   Delete key              → delete selected node
//
// Exports: show(), hide(), isVisible(), onBack(callback)
// ============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
        // True RCS area = S² − (4−π)×R²
        var S = p.side || 0; var Rc = p.cornerRadius || 0;
        var A_rcs = Math.max(0, S * S - (4 - Math.PI) * Rc * Rc);
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

// ---------------------------------------------------------------------------
// Unit System — import helpers from measurementunits.js and wrap them
// ---------------------------------------------------------------------------

import { setDisplaySystem, formatValue, convert, celsiusToFahrenheit } from './measurementunits.js';
import * as S from './manufacturingreview_states.js';
import {
  init        as initProcess,
  buildCanvasPanel,
  applyWorldTransform,
  resetView,
  createNode,
  refreshNodeEl,
  removeNodeEl,
  selectNode,
  deleteNode,
  setNodeSelected,
  addConnection,
  selectConn,
  deleteConn,
  refreshConnections,
  dismissContextMenu,
  onMouseMove,
  onMouseUp,
  onKeyDown,
} from './manufacturingreview_process.js';
import {
  buildCalcPanel,
  refreshCalcPanel,
} from './manufacturingreview_summary.js';
import {
  buildRightPanel,
  showRightPlaceholder,
  refreshRightPanel,
  buildStepWorkings,
} from './manufacturingreview_estimates.js';
import {
  init           as initInputs,
  buildLeftPanel,
  refreshLeftPanel,
  toDisplay, fromDisplay, unitSuffix, scaleParam,
} from './manufacturingreview_inputs.js';


function setUnitSystem(sys) {
  S.setUnitSystem(sys);
  setDisplaySystem(sys);
  // Refresh all node card previews on canvas
  S.getNodes().forEach(function(n) { refreshNodeEl(n.id); });
  // Refresh all display panels
  refreshRightPanel(); refreshCalcPanel();
  refreshLeftPanel();
}

// Display wrappers — all internal values are SI; these convert for display only.

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


// ===========================================================================
// DOM BUILDER
// ===========================================================================

function buildOverlay() {
  if (S.getOverlay()) return;
  injectStyles();

  // Wire cross-panel refresh callbacks into the process module
  initProcess({
    refreshLeftPanel:  refreshLeftPanel,
    refreshRightPanel: refreshRightPanel,
    refreshCalcPanel:  refreshCalcPanel,
  });

  initInputs({
    refreshRightPanel:  refreshRightPanel,
    refreshCalcPanel:   refreshCalcPanel,
    refreshNodeEl:      refreshNodeEl,
    refreshStatusBadge: refreshStatusBadge,
  });

  S.setOverlay(document.createElement('div'));
  S.getOverlay().id = 'forgeworks-mfg-review';
  Object.assign(S.getOverlay().style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '9999', display: 'flex', flexDirection: 'column',
    background: '#060b11', overflow: 'hidden',
    fontFamily: "'Consolas','SF Mono','Fira Code','Monaco',monospace",
    color: '#aabbcc',
  });

  var bg = document.createElement('div');
  Object.assign(bg.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none',
    background: 'radial-gradient(ellipse 70% 50% at 15% 100%,' + ACCENT_DIM + '0.04) 0%,transparent 70%)',
  });
  S.getOverlay().appendChild(bg);

  S.getOverlay().appendChild(buildTopBar());

  // Outer vertical container: three-panel row on top, calc panel below
  var outer = document.createElement('div');
  Object.assign(outer.style, { flex: '1', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: '2' });

  var body = document.createElement('div');
  Object.assign(body.style, { flex: '1', display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: '0' });
  body.appendChild(buildLeftPanel());
  body.appendChild(buildCanvasPanel());
  body.appendChild(buildRightPanel());
  outer.appendChild(body);

  outer.appendChild(buildCalcPanel());
  S.getOverlay().appendChild(outer);

  S.getOverlay().appendChild(buildActionBar());
  document.body.appendChild(S.getOverlay());

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);
  document.addEventListener('keydown',   onKeyDown);
}

// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function buildTopBar() {
  var bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative', zIndex: '3', display: 'flex', alignItems: 'center',
    padding: '0 24px', height: '52px', minHeight: '52px',
    borderBottom: '1px solid ' + ACCENT_DIM + '0.18)',
    background: 'rgba(4,8,14,0.9)', backdropFilter: 'blur(8px)', gap: '16px',
  });

  var backBtn = document.createElement('button');
  styleBarBtn(backBtn);
  backBtn.innerHTML = '<span style="font-size:14px;line-height:1">‹</span> MENU';
  backBtn.addEventListener('click', function() { if (S.getBackCallback()) S.getBackCallback()(); });
  bar.appendChild(backBtn);

  var sep = document.createElement('div');
  Object.assign(sep.style, { width: '1px', height: '20px', background: 'rgba(255,255,255,0.20)' });
  bar.appendChild(sep);

  var title = document.createElement('div');
  Object.assign(title.style, { fontSize: '12px', fontWeight: '600', letterSpacing: '3px', textTransform: 'uppercase', color: ACCENT });
  title.textContent = 'Manufacturing Review';
  bar.appendChild(title);

  var tag = document.createElement('div');
  Object.assign(tag.style, {
    fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase',
    color: '#99aabc', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.22)', borderRadius: '2px',
  });
  tag.textContent = 'Process Flow Editor';
  bar.appendChild(tag);

  var sp = document.createElement('div'); sp.style.flex = '1';
  bar.appendChild(sp);

  // Zoom indicator + reset
  var zoomIndicator = document.createElement('div');
  zoomIndicator.id = 'mr-zoom-indicator';
  Object.assign(zoomIndicator.style, {
    fontSize: '9px', letterSpacing: '1px', color: '#7a9aaa',
    cursor: 'pointer', padding: '4px 8px',
    border: '1px solid rgba(255,255,255,0.18)', borderRadius: '2px',
    transition: 'all 0.2s ease',
  });
  zoomIndicator.textContent = '100%';
  zoomIndicator.title = 'Click to reset view';
  zoomIndicator.addEventListener('mouseenter', function() { zoomIndicator.style.color = '#99aacc'; zoomIndicator.style.borderColor = 'rgba(255,255,255,0.18)'; });
  zoomIndicator.addEventListener('mouseleave', function() { zoomIndicator.style.color = '#445566'; zoomIndicator.style.borderColor = 'rgba(255,255,255,0.18)'; });
  zoomIndicator.addEventListener('click', function() { resetView(); updateZoomIndicator(); });
  bar.appendChild(zoomIndicator);

  var hint = document.createElement('div');
  Object.assign(hint.style, { fontSize: '9px', letterSpacing: '1px', color: '#6a8090' });
  hint.textContent = 'Drag canvas to pan  ·  Scroll to S.getZoom()  ·  Right-click canvas to add  ·  Click connection to select  ·  Del to remove';
  bar.appendChild(hint);

  var al = document.createElement('div');
  Object.assign(al.style, {
    position: 'absolute', bottom: '0', left: '0', width: '100%', height: '1px',
    background: 'linear-gradient(90deg,' + ACCENT + '44,' + ACCENT + '11 60%,transparent)', pointerEvents: 'none',
  });
  bar.appendChild(al);
  return bar;
}

// ---------------------------------------------------------------------------
// Action Bar
// ---------------------------------------------------------------------------

function buildActionBar() {
  var bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative', zIndex: '3', display: 'flex', alignItems: 'center',
    padding: '0 24px', height: '48px', minHeight: '48px',
    borderTop: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(4,8,14,0.85)', gap: '10px',
  });

  var saveBtn  = makeBarButton('Save Config', '↓');
  var loadBtn  = makeBarButton('Load Config', '↑');
  saveBtn.addEventListener('click', saveConfig);
  loadBtn.addEventListener('click', loadConfig);
  bar.appendChild(saveBtn); bar.appendChild(loadBtn);

  // ── Unit system toggle (centred) ─────────────────────────────────────────
  var unitToggle = document.createElement('div');
  Object.assign(unitToggle.style, {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '3px', padding: '4px 12px',
  });

  function makeUnitOpt(label, value) {
    var wrap = document.createElement('label');
    Object.assign(wrap.style, {
      display: 'flex', alignItems: 'center', gap: '5px',
      cursor: 'pointer', fontSize: '9px', letterSpacing: '1.5px',
      textTransform: 'uppercase', color: S.getUnitSystem() === value ? ACCENT : '#7a9aaa',
      transition: 'color 0.15s ease', userSelect: 'none',
    });
    wrap.id = 'mr-unit-label-' + value;

    var cb = document.createElement('input');
    cb.type = 'radio';
    cb.name = 'mr-unit-system';
    cb.value = value;
    cb.checked = S.getUnitSystem() === value;
    Object.assign(cb.style, {
      accentColor: ACCENT, cursor: 'pointer', width: '11px', height: '11px',
    });
    cb.addEventListener('change', function() {
      if (cb.checked) {
        S.setUnitSystem(value);
        ['si', 'imperial'].forEach(function(v) {
          var lbl = document.getElementById('mr-unit-label-' + v);
          if (lbl) lbl.style.color = S.getUnitSystem() === v ? ACCENT : '#7a9aaa';
        });
        setUnitSystem(value);
      }
    });

    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  var sep = document.createElement('div');
  Object.assign(sep.style, {
    width: '1px', height: '14px',
    background: 'rgba(255,255,255,0.18)', margin: '0 4px',
  });

  unitToggle.appendChild(makeUnitOpt('Imperial', 'imperial'));
  unitToggle.appendChild(sep);
  unitToggle.appendChild(makeUnitOpt('Metric', 'si'));
  bar.appendChild(unitToggle);

  var sp = document.createElement('div'); sp.style.flex = '1';
  bar.appendChild(sp);

  // ── Export dropdown ───────────────────────────────────────────────────────
  var exportWrap = document.createElement('div');
  Object.assign(exportWrap.style, { position: 'relative', display: 'inline-block' });

  var exportBtn = makeBarButton('Export', '⬆');
  exportBtn.style.paddingRight = '22px';

  // Caret
  var caret = document.createElement('span');
  Object.assign(caret.style, {
    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
    fontSize: '8px', color: '#7a9aaa', pointerEvents: 'none',
  });
  caret.textContent = '▾';
  exportBtn.style.position = 'relative';
  exportBtn.appendChild(caret);

  // Dropdown menu
  var exportMenu = document.createElement('div');
  Object.assign(exportMenu.style, {
    position: 'absolute', bottom: '110%', right: '0',
    background: '#0a1520', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '3px', minWidth: '160px', overflow: 'hidden',
    display: 'none', flexDirection: 'column',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.6)', zIndex: '999',
  });

  var exportOptions = [
    { label: 'Print to PDF',  icon: '⎙', fn: function() { printToPDF(); } },
    { label: 'Export Excel',  icon: '⊞', fn: function() { exportToExcel(); } },
    { label: 'Export CSV',    icon: '≡', fn: function() { exportToCSV(); } },
    { label: 'Export .txt',   icon: '≡', fn: function() { exportToTxt(); } },
  ];

  exportOptions.forEach(function(opt) {
    var item = document.createElement('button');
    Object.assign(item.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      width: '100%', padding: '9px 14px',
      background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.07)',
      color: '#99aacc', fontSize: '10px', fontFamily: 'inherit',
      letterSpacing: '1px', cursor: 'pointer', textAlign: 'left',
      transition: 'background 0.1s ease',
    });
    item.innerHTML = '<span style="opacity:0.6;font-size:12px">' + opt.icon + '</span>' + opt.label;
    item.addEventListener('mouseenter', function() { item.style.background = 'rgba(255,255,255,0.06)'; item.style.color = ACCENT; });
    item.addEventListener('mouseleave', function() { item.style.background = 'none'; item.style.color = '#99aacc'; });
    item.addEventListener('click', function() {
      exportMenu.style.display = 'none';
      opt.fn();
    });
    exportMenu.appendChild(item);
  });

  exportBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var open = exportMenu.style.display === 'flex';
    exportMenu.style.display = open ? 'none' : 'flex';
  });
  document.addEventListener('click', function() { exportMenu.style.display = 'none'; });

  exportWrap.appendChild(exportBtn);
  exportWrap.appendChild(exportMenu);
  bar.appendChild(exportWrap);

  var vtag = document.createElement('div');
  Object.assign(vtag.style, { fontSize: '9px', letterSpacing: '2px', color: '#7a9aaa' });
  vtag.textContent = 'MFG-REVIEW v2.0';
  bar.appendChild(vtag);

  return bar;
}

function makeBarButton(label, icon) {
  var btn = document.createElement('button');
  styleBarBtn(btn);
  btn.innerHTML = '<span>' + icon + '</span> ' + label;
  return btn;
}

function styleBarBtn(btn) {
  Object.assign(btn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.20)', borderRadius: '3px',
    color: '#99aacc', cursor: 'pointer', padding: '5px 14px', fontSize: '10px',
    fontFamily: 'inherit', letterSpacing: '1px', transition: 'all 0.2s ease',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  btn.addEventListener('mouseenter', function() { btn.style.borderColor = ACCENT_DIM + '0.5)'; btn.style.color = ACCENT; });
  btn.addEventListener('mouseleave', function() { btn.style.borderColor = 'rgba(255,255,255,0.20)'; btn.style.color = '#99aacc'; });
}


export var SAVE_VERSION = '3.0';

function saveConfig() {
  // Deep-copy nodes so we store clean plain objects (no DOM refs)
  var nodeSnapshot = S.getNodes().map(function(n) {
    return { id: n.id, type: n.type, label: n.label, x: n.x, y: n.y,
             params: JSON.parse(JSON.stringify(n.params || {})) };
  });

  var payload = {
    _version:     SAVE_VERSION,
    _type:        'forgeworks-mfg-review',
    _savedAt:     new Date().toISOString(),
    _unitSystem:  S.getUnitSystem(),
    _nid: S.getNid(),
    _cid: S.getCid(),
    general:      JSON.parse(JSON.stringify(S.getGeneral())),
    nodes:        nodeSnapshot,
    connections:  JSON.parse(JSON.stringify(S.getConnections())),
  };

  var json = JSON.stringify(payload, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');

  // Use job number + part number in filename if available
  var nameParts = ['mfg-review'];
  if (S.getGeneral().jobNumber)  nameParts.push(S.getGeneral().jobNumber.replace(/[^a-zA-Z0-9\-_]/g, '-'));
  if (S.getGeneral().partNumber) nameParts.push(S.getGeneral().partNumber.replace(/[^a-zA-Z0-9\-_]/g, '-'));
  nameParts.push(new Date().toISOString().slice(0,10));
  a.download = nameParts.join('_') + '.json';

  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Config saved — ' + a.download);
}

function loadConfig() {
  var fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.json';
  fi.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var p = JSON.parse(ev.target.result);

        // Type check
        if (p._type !== 'forgeworks-mfg-review') {
          alert('Not a valid Forgeworks Manufacturing Review file.\n\nExpected _type "forgeworks-mfg-review".');
          return;
        }

        var fileVer = parseFloat(p._version || '1.0');
        var warnings = [];

        // ── General panel ─────────────────────────────────────────────────
        // Merge saved general into current defaults so new fields always exist
        Object.keys(S.getGeneral()).forEach(function(k) {
          if (p.general && p.general[k] !== undefined) S.getGeneral()[k] = p.general[k];
        });
        // Also pick up any keys in the saved file that we might not have defaulted
        if (p.general) S.patchGeneral(p.general);

        // ── Counters ──────────────────────────────────────────────────────
        S.setNid(p._nid || 0);
        S.setCid(p._cid || 0);

        // ── Unit system ───────────────────────────────────────────────────
        if (p._unitSystem === 'si' || p._unitSystem === 'imperial') {
          S.setUnitSystem(p._unitSystem);
          setDisplaySystem(S.getUnitSystem());
          // Sync radio buttons if they exist
          ['si','imperial'].forEach(function(v) {
            var lbl = document.getElementById('mr-unit-label-' + v);
            if (lbl) lbl.style.color = S.getUnitSystem() === v ? ACCENT : '#7a9aaa';
            var rb = document.querySelector('input[name="mr-unit-system"][value="' + v + '"]');
            if (rb) rb.checked = S.getUnitSystem() === v;
          });
        }

        // ── Nodes — migrate params to fill in any new fields ──────────────
        S.getNodes().forEach(function(n) { removeNodeEl(n.id); });
        S.setNodes([]);
        S.setConnections([]);

        (p.nodes || []).forEach(function(nd) {
          var def = NODE_DEFS[nd.type];
          if (!def) {
            warnings.push('Unknown node type "' + nd.type + '" — skipped.');
            return;
          }

          // Start from a fresh copy of defaultParams so every new field has its default
          var migratedParams = JSON.parse(JSON.stringify(def.defaultParams || {}));

          // Overlay saved values on top — preserves user data, fills gaps with defaults
          if (nd.params) {
            Object.keys(nd.params).forEach(function(k) {
              migratedParams[k] = nd.params[k];
            });
          }

          var node = {
            id:     nd.id,
            type:   nd.type,
            label:  nd.label || def.label,
            x:      nd.x || 100,
            y:      nd.y || 100,
            params: migratedParams,
          };
          S.pushNode(node);
          renderNodeEl(node);
        });

        // ── Connections ───────────────────────────────────────────────────
        // Validate that both endpoints still exist
        var validNodeIds = S.getNodes().map(function(n) { return n.id; });
        S.setConnections((p.connections || []).filter(function(c) {
          var ok = validNodeIds.indexOf(c.fromId) > -1 && validNodeIds.indexOf(c.toId) > -1;
          if (!ok) warnings.push('Connection ' + c.id + ' references missing node — removed.');
          return ok;
        }));

        // ── Refresh everything ────────────────────────────────────────────
        refreshConnections();
        refreshLeftPanel();
        refreshRightPanel();
        refreshCalcPanel();
        S.resetViewport();
        applyWorldTransform();

        // ── Feedback ─────────────────────────────────────────────────────
        var msg = 'Loaded: ' + file.name +
          '\n' + S.getNodes().length + ' nodes · ' + S.getConnections().length + ' connections' +
          (fileVer < parseFloat(SAVE_VERSION) ? '\nMigrated from v' + fileVer + ' → v' + SAVE_VERSION : '');
        if (warnings.length > 0) msg += '\n\nWarnings:\n' + warnings.join('\n');
        showToast(msg);

      } catch (err) {
        alert('Failed to load config:\n' + err.message);
      }
    };
    reader.readAsText(file);
  });
  fi.click();
}

// Brief non-blocking toast notification
function showToast(msg) {
  var existing = document.getElementById('mr-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'mr-toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(10,20,30,0.95)', border: '1px solid rgba(100,180,255,0.3)',
    color: '#99ccee', fontFamily: 'inherit', fontSize: '10px', letterSpacing: '0.8px',
    padding: '10px 20px', borderRadius: '4px', zIndex: '99999',
    maxWidth: '480px', textAlign: 'center', lineHeight: '1.5',
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
    whiteSpace: 'pre-line',
    opacity: '0', transition: 'opacity 0.2s ease',
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.style.opacity = '1'; });
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
  }, 3500);
}

function printToPDF() {
  var chain = computeChain();
  if (chain.length === 0) { alert('Build a process chain first.'); return; }

  var first    = chain[0];
  var last     = chain[chain.length - 1];
  var massIn   = first.massOut;
  var massOut  = last.massOut;
  var totalLoss = round3(massIn - massOut);
  var yieldPct  = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var unitLabel = S.getUnitSystem() === 'imperial' ? 'Imperial (in / lb / °F)' : 'Metric (mm / kg / °C)';
  var ts        = new Date().toLocaleString();

  var C_sans  = "'Segoe UI','Helvetica Neue',Arial,sans-serif";
  var C_mono  = "'Consolas','SF Mono','Courier New',monospace";
  var C_ink   = '#1a1f2a';
  var C_sub   = '#5a6878';
  var C_faint = '#9aaabb';
  var C_border= '#dde3ea';
  var C_accent= '#b04010';
  var C_aLt   = '#fff3ee';
  var C_aBd   = '#e8c0a8';
  var C_blue  = '#1a3a5c';
  var C_bLt   = '#eef3f8';
  var C_bBd   = '#b8ccde';
  var C_green = '#1a6040';
  var C_gLt   = '#eefaf4';
  var C_gBd   = '#a8d8c0';
  var C_gold  = '#7a5000';
  var C_yLt   = '#fdf8ee';
  var C_yBd   = '#e0c878';

  var NODE_COLORS = {
    stock_in:   { bg:'#3a1208', text:'#ffb090', border:'#e05c3a' },
    cut:        { bg:'#101820', text:'#99bbcc', border:'#405060' },
    heat:       { bg:'#201000', text:'#ffe090', border:'#b07010' },
    forge:      { bg:'#200800', text:'#ffaa70', border:'#a03008' },
    trim:       { bg:'#101828', text:'#90b0e0', border:'#304880' },
    heat_treat: { bg:'#140828', text:'#c0a0f0', border:'#5838a8' },
    machine:    { bg:'#081a14', text:'#70e0c0', border:'#187050' },
    inspect:    { bg:'#081a0a', text:'#80e090', border:'#188030' },
    stock_out:  { bg:'#001828', text:'#80d0f0', border:'#0070a0' },
  };

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function mRow(label, val) {
    return '<tr><td style="padding:4px 12px 4px 0;font-size:10px;color:'+C_sub+';white-space:nowrap;vertical-align:top">'+esc(label)+'</td>'+
           '<td style="padding:4px 0;font-size:10px;font-weight:600;color:'+C_ink+'">'+esc(val)+'</td></tr>';
  }

  // ── COVER PAGE ───────────────────────────────────────────────────────────
  var coverHTML =
    '<div style="page-break-after:always;min-height:99vh;display:flex;flex-direction:column;justify-content:space-between;padding:64px 64px 40px">'+
    '<div>'+
      '<div style="font-size:38px;font-weight:200;letter-spacing:14px;text-transform:uppercase;color:'+C_ink+';margin-bottom:6px">Forgeworks</div>'+
      '<div style="font-size:10px;letter-spacing:6px;text-transform:uppercase;color:'+C_faint+';margin-bottom:40px">Manufacturing Review Package</div>'+
      '<div style="height:3px;background:linear-gradient(to right,'+C_accent+',transparent);margin-bottom:44px"></div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:40px">'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px;border-bottom:1px solid '+C_border+';padding-bottom:6px">Job Information</div>'+
          '<table style="border-collapse:collapse;width:100%">'+
            mRow('Job Number',  S.getGeneral().jobNumber  || '—')+
            mRow('Part Number', S.getGeneral().partNumber || '—')+
            mRow('Part Name',   S.getGeneral().partName   || '—')+
            mRow('Revision',    S.getGeneral().revision   || '—')+
            mRow('Customer',    S.getGeneral().customer   || '—')+
            mRow('Work Order',  S.getGeneral().workOrder  || '—')+
          '</table>'+
        '</div>'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px;border-bottom:1px solid '+C_border+';padding-bottom:6px">Document Information</div>'+
          '<table style="border-collapse:collapse;width:100%">'+
            mRow('Engineer',      S.getGeneral().engineer     || '—')+
            mRow('Date Created',  S.getGeneral().dateCreated  || '—')+
            mRow('Status',       (S.getGeneral().status||'—').replace(/_/g,' '))+
            mRow('Unit System',   unitLabel)+
            mRow('Process Steps', chain.length + ' steps')+
            mRow('Generated',     ts)+
          '</table>'+
        '</div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:36px">'+
        '<div style="padding:18px;border:2px solid '+C_bBd+';border-radius:4px;background:'+C_bLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_blue+';margin-bottom:8px">Raw Stock In</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_blue+';font-family:'+C_mono+'">'+esc(dMass(massIn))+'</div>'+
        '</div>'+
        '<div style="padding:18px;border:2px solid '+C_gBd+';border-radius:4px;background:'+C_gLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_green+';margin-bottom:8px">Final Part Out</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_green+';font-family:'+C_mono+'">'+esc(dMass(massOut))+'</div>'+
        '</div>'+
        '<div style="padding:18px;border:2px solid '+C_aBd+';border-radius:4px;background:'+C_aLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_accent+';margin-bottom:8px">Total Loss</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_accent+';font-family:'+C_mono+'">'+esc(dMass(totalLoss))+'</div>'+
        '</div>'+
        '<div style="padding:18px;border:2px solid '+C_yBd+';border-radius:4px;background:'+C_yLt+'">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_gold+';margin-bottom:8px">Material Yield</div>'+
          '<div style="font-size:24px;font-weight:300;color:'+C_gold+';font-family:'+C_mono+'">'+yieldPct+'%</div>'+
        '</div>'+
      '</div>'+

      '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px">Process Sequence</div>'+
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:32px">'+
      chain.map(function(step,i){
        var nc=NODE_COLORS[step.nodeType]||{bg:'#333',text:'#fff',border:'#555'};
        return '<span style="padding:6px 14px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:'+nc.bg+';color:'+nc.text+';border:1px solid '+nc.border+'">'+esc(step.label)+'</span>'+
          (i<chain.length-1?'<span style="color:'+C_faint+';font-size:16px">→</span>':'');
      }).join('')+
      '</div>'+

      (S.getGeneral().notes?'<div style="padding:16px;border:1px solid '+C_border+';border-radius:4px;background:#fafafa">'+
        '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Notes</div>'+
        '<div style="font-size:11px;color:'+C_ink+';line-height:1.6">'+esc(S.getGeneral().notes)+'</div></div>':'')+
    '</div>'+
    '<div style="border-top:1px solid '+C_border+';padding-top:12px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
      '<span>Forgeworks · Manufacturing Review</span><span>CONFIDENTIAL — FOR INTERNAL USE</span><span>Page 1</span>'+
    '</div></div>';

  // ── ONE PAGE PER STEP ────────────────────────────────────────────────────
  var stepsHTML = chain.map(function(step, idx) {
    var node = S.getNodes().find(function(n){ return n.id===step.nodeId; })||{};
    var def  = NODE_DEFS[step.nodeType]||{paramDefs:[]};
    var p    = node.params||{};
    var nc   = NODE_COLORS[step.nodeType]||{bg:'#222',text:'#fff',border:'#444'};
    var workings = buildStepWorkings(step);

    // Build param sections
    var paramSections = [];
    var curSec = {title:'Parameters',rows:[]};
    def.paramDefs.forEach(function(pd){
      if (pd.section!==undefined){
        if (curSec.rows.length) paramSections.push(curSec);
        curSec={title:pd.section,rows:[]};
      } else {
        var raw=p[pd.key];
        if (raw===undefined||raw==='') return;
        var displayVal;
        if (pd.unitType) {
          displayVal = toDisplay(raw,pd.unitType)+unitSuffix(pd.unitType);
        } else if (pd.type === 'material_family') {
          displayVal = (MATERIAL_CATALOG[raw]||{}).label || raw;
        } else if (pd.type === 'grade_lookup') {
          displayVal = raw;
        } else if (pd.type === 'select') {
          displayVal = String(raw).replace(/_/g,' ');
        } else {
          displayVal = raw;
        }
        curSec.rows.push({label:pd.label, value:displayVal});
      }
    });
    if (curSec.rows.length) paramSections.push(curSec);

    var paramsHTML = paramSections.filter(function(s){return s.rows.length>0;}).map(function(sec){
      return '<div style="margin-bottom:14px">'+
        '<div style="font-size:7px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:1px solid '+C_border+';padding-bottom:4px;margin-bottom:6px">'+esc(sec.title)+'</div>'+
        '<table style="width:100%;border-collapse:collapse">'+
        sec.rows.map(function(r,ri){
          var bg=ri%2===0?'#f9fafb':'#fff';
          return '<tr style="background:'+bg+'">'+
            '<td style="padding:4px 8px 4px 0;font-size:9px;color:'+C_sub+';width:48%;border-bottom:1px solid #f0f2f4;vertical-align:top">'+esc(r.label)+'</td>'+
            '<td style="padding:4px 0;font-size:10px;font-weight:600;color:'+C_ink+';font-family:'+C_mono+';border-bottom:1px solid #f0f2f4">'+esc(String(r.value))+'</td>'+
          '</tr>';
        }).join('')+
        '</table></div>';
    }).join('');

    // Calc workings
    var calcsHTML = workings.map(function(w,wi){
      var isInfo = w.symbolic==='—';
      return '<div style="border:1px solid '+C_border+';border-radius:4px;margin-bottom:10px;overflow:hidden;page-break-inside:avoid">'+

        // Header row with title + number
        '<div style="background:#f0f4f8;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid '+C_border+'">'+
          '<div style="font-size:10px;font-weight:700;color:'+C_ink+'">'+esc(w.title)+'</div>'+
          '<div style="font-size:8px;color:'+C_faint+';font-family:'+C_mono+'">Calc '+(idx+1)+'.'+(wi+1)+'</div>'+
        '</div>'+

        // Description — blue callout
        '<div style="padding:8px 12px;background:'+C_bLt+';border-bottom:1px solid '+C_bBd+';font-size:10px;color:'+C_blue+';line-height:1.5;border-left:3px solid '+C_bBd+'">'+
          esc(w.desc)+
        '</div>'+

        (!isInfo?
          // Formula + substituted side-by-side
          '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid '+C_border+'">'+
            '<div style="padding:10px 12px;border-right:1px solid '+C_border+'">'+
              '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Symbolic Formula</div>'+
              '<div style="font-size:11px;font-family:'+C_mono+';color:'+C_blue+';line-height:1.6">'+esc(w.symbolic)+'</div>'+
            '</div>'+
            '<div style="padding:10px 12px">'+
              '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Values Substituted</div>'+
              '<div style="font-size:11px;font-family:'+C_mono+';color:'+C_sub+';line-height:1.6">'+esc(w.substituted)+'</div>'+
            '</div>'+
          '</div>'+
          // Answer
          '<div style="padding:10px 14px;background:'+C_aLt+';display:flex;align-items:center;gap:14px">'+
            '<div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_accent+';white-space:nowrap">Answer</div>'+
            '<div style="font-size:15px;font-weight:700;font-family:'+C_mono+';color:'+C_accent+'">'+esc(w.answer)+'</div>'+
          '</div>'
        : '') +
      '</div>';
    }).join('');

    // Mass flow banner
    var lc = step.massLoss>0?C_accent:C_faint;
    var massBar =
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:12px 14px;background:'+C_bLt+';border:1px solid '+C_bBd+';border-radius:4px;margin-bottom:16px">'+
        '<div><div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_blue+';margin-bottom:4px">Mass In</div>'+
          '<div style="font-size:16px;font-weight:700;font-family:'+C_mono+';color:'+C_blue+'">'+esc(dMass(step.massIn))+'</div></div>'+
        '<div><div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+lc+';margin-bottom:4px">Material Lost</div>'+
          '<div style="font-size:16px;font-weight:700;font-family:'+C_mono+';color:'+lc+'">'+
          (step.massLoss>0 ? '−'+esc(dMass(step.massLoss))+' <span style="font-size:10px;font-weight:400">('+step.lossPct+'%)</span>' : '—')+
          '</div></div>'+
        '<div><div style="font-size:7px;letter-spacing:2px;text-transform:uppercase;color:'+C_green+';margin-bottom:4px">Mass Out</div>'+
          '<div style="font-size:16px;font-weight:700;font-family:'+C_mono+';color:'+C_green+'">'+esc(dMass(step.massOut))+'</div></div>'+
      '</div>';

    return '<div style="page-break-before:always;padding:40px 48px 48px">'+

      // Step header
      '<div style="background:'+nc.bg+';border:2px solid '+nc.border+';border-radius:4px;padding:18px 22px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:center">'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+nc.text+'99;margin-bottom:5px">Step '+(idx+1)+' of '+chain.length+'</div>'+
          '<div style="font-size:22px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:'+nc.text+'">'+esc(step.label)+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+nc.text+'80;margin-bottom:5px">Type</div>'+
          '<div style="font-size:11px;font-weight:600;color:'+nc.text+'">'+esc((step.nodeType||'').replace(/_/g,' ').toUpperCase())+'</div>'+
        '</div>'+
      '</div>'+

      // Two-column: params | calcs
      '<div style="display:grid;grid-template-columns:260px 1fr;gap:22px">'+

        // LEFT — parameters
        '<div>'+
          '<div style="font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:2px solid '+C_border+';padding-bottom:6px;margin-bottom:14px">All Parameters</div>'+
          (paramsHTML||'<div style="color:'+C_faint+';font-size:10px;padding:8px 0">No parameters set</div>')+
        '</div>'+

        // RIGHT — mass flow + workings
        '<div>'+
          '<div style="font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:2px solid '+C_border+';padding-bottom:6px;margin-bottom:14px">Mass Flow</div>'+
          massBar+
          '<div style="font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:'+C_sub+';border-bottom:2px solid '+C_border+';padding-bottom:6px;margin:16px 0 14px">Calculation Workings — Step by Step</div>'+
          calcsHTML+
        '</div>'+

      '</div>'+

      // Footer
      '<div style="margin-top:24px;border-top:1px solid '+C_border+';padding-top:10px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
        '<span>Forgeworks · '+esc(step.label)+'</span>'+
        '<span>Job: '+esc(S.getGeneral().jobNumber||'—')+'</span>'+
        '<span>Step '+(idx+1)+' of '+chain.length+'</span>'+
      '</div>'+
    '</div>';
  }).join('');

  // ── FINAL SUMMARY TABLE PAGE ─────────────────────────────────────────────
  var summaryPage = '<div style="page-break-before:always;padding:40px 48px">'+
    '<div style="font-size:22px;font-weight:200;letter-spacing:8px;text-transform:uppercase;color:'+C_ink+';margin-bottom:4px">Mass Balance</div>'+
    '<div style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Complete chain summary</div>'+
    '<div style="height:2px;background:linear-gradient(to right,'+C_accent+',transparent);margin-bottom:24px"></div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:10px">'+
    '<thead><tr style="background:'+C_ink+'">'+
      '<th style="text-align:left;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">#</th>'+
      '<th style="text-align:left;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">STEP</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">MASS IN</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">LOSS</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">LOSS %</th>'+
      '<th style="text-align:right;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">MASS OUT</th>'+
      '<th style="text-align:left;padding:10px 12px;color:#fff;font-size:8px;letter-spacing:1.5px">KEY NOTES</th>'+
    '</tr></thead><tbody>'+
    chain.map(function(step,i){
      var bg  = i%2===0?'#f8f9fb':'#fff';
      var nc  = NODE_COLORS[step.nodeType]||{bg:'#333',text:'#fff',border:'#444'};
      var key = step.calcs.slice(0,3).map(function(c){return c.label+': '+c.result;}).join('  ·  ');
      return '<tr style="background:'+bg+';border-bottom:1px solid '+C_border+'">'+
        '<td style="padding:9px 12px;font-weight:700;color:'+C_faint+';font-size:11px">'+(i+1)+'</td>'+
        '<td style="padding:9px 12px"><span style="padding:3px 10px;border-radius:2px;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:'+nc.bg+';color:'+nc.text+';border:1px solid '+nc.border+'">'+esc(step.label)+'</span></td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';color:'+C_blue+'">'+esc(dMass(step.massIn))+'</td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';color:'+(step.massLoss>0?C_accent:C_faint)+'">'+
          (step.massLoss>0?'−'+esc(dMass(step.massLoss)):'—')+'</td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';color:'+(step.lossPct>0?C_accent:C_faint)+'">'+
          (step.lossPct>0?step.lossPct+'%':'—')+'</td>'+
        '<td style="padding:9px 12px;text-align:right;font-family:'+C_mono+';font-weight:700;color:'+C_green+'">'+esc(dMass(step.massOut))+'</td>'+
        '<td style="padding:9px 12px;color:'+C_sub+';font-size:9px">'+esc(key)+'</td>'+
      '</tr>';
    }).join('')+
    '</tbody><tfoot><tr style="background:'+C_ink+'">'+
      '<td colspan="2" style="padding:11px 12px;color:#fff;font-weight:700;font-size:9px;letter-spacing:1px">TOTALS</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#80d0ff;font-weight:700;font-family:'+C_mono+'">'+esc(dMass(massIn))+'</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#ff9070;font-weight:700;font-family:'+C_mono+'">−'+esc(dMass(totalLoss))+'</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#ff9070;font-weight:700;font-family:'+C_mono+'">'+round3(100-yieldPct)+'%</td>'+
      '<td style="padding:11px 12px;text-align:right;color:#80f0b0;font-weight:700;font-family:'+C_mono+'">'+esc(dMass(massOut))+'</td>'+
      '<td style="padding:11px 12px;color:#80f0b0;font-weight:700;font-size:12px">Yield: '+yieldPct+'%</td>'+
    '</tr></tfoot></table>'+

    '<div style="margin-top:40px;border-top:1px solid '+C_border+';padding-top:14px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
      '<span>Forgeworks · Manufacturing Review</span><span>Generated: '+esc(ts)+'</span><span>END OF REPORT</span>'+
    '</div></div>';

  var css = [
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{font-family:'+C_sans+';background:#f7f8fa;color:'+C_ink+';font-size:11px}',
    '@media print{',
    '  @page{margin:0;size:letter}',
    '  body{background:#fff}',
    '  .nobreak{page-break-inside:avoid}',
    '}',
  ].join('');

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>Forgeworks MFG Review \u2014 '+(S.getGeneral().jobNumber||'Export')+'</title>'+
    '<style>'+css+'</style></head><body>'+
    coverHTML + stepsHTML + summaryPage +
    '</body></html>';

  var win = window.open('','_blank','width=1060,height=860');
  win.document.write(html); win.document.close(); win.focus();
  setTimeout(function(){ win.print(); }, 600);
}

// ---------------------------------------------------------------------------
// Export — shared helpers
// ---------------------------------------------------------------------------

function exportGetChain() {
  var chain = computeChain();
  if (chain.length === 0) { alert('Build a process chain first.'); return null; }
  return chain;
}

function exportDownload(filename, content, mime) {
  var blob = new Blob([content], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
}

// ---------------------------------------------------------------------------
// Export — Excel (.xlsx via SpreadsheetML XML)
// ---------------------------------------------------------------------------

function exportToExcel() {
  var chain = exportGetChain(); if (!chain) return;
  var first = chain[0], last = chain[chain.length - 1];
  var massIn  = first.massOut;
  var massOut = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;

  // Build rows: summary block + step-by-step
  var rows = [];
  rows.push(['FORGEWORKS — MANUFACTURING REVIEW', '', '', '']);
  rows.push(['', '', '', '']);
  rows.push(['Job Number', S.getGeneral().jobNumber || '—', 'Customer', S.getGeneral().customer || '—']);
  rows.push(['Engineer',   S.getGeneral().engineer  || '—', 'Date',     S.getGeneral().dateCreated || '—']);
  rows.push(['Status',     S.getGeneral().status    || '—', 'Units',    S.getUnitSystem() === 'imperial' ? 'Imperial' : 'Metric']);
  rows.push(['', '', '', '']);
  rows.push(['SUMMARY', '', '', '']);
  rows.push(['Mass In', dMass(massIn), 'Mass Out', dMass(massOut)]);
  rows.push(['Yield', yieldPct + '%', 'Steps', chain.length]);
  rows.push(['', '', '', '']);
  rows.push(['STEP', 'PARAMETER', 'VALUE', 'LOSS']);

  chain.forEach(function(step) {
    var firstCalc = true;
    step.calcs.forEach(function(c) {
      rows.push([
        firstCalc ? step.label : '',
        c.label,
        c.result,
        firstCalc && step.massLoss > 0 ? '−' + dMass(step.massLoss) + ' (' + step.lossPct + '%)' : '',
      ]);
      firstCalc = false;
    });
    rows.push(['', '', '', '']);
  });

  // SpreadsheetML XML
  var xml = '<?xml version="1.0"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    '<Styles>' +
      '<Style ss:ID="h"><Font ss:Bold="1" ss:Size="11"/></Style>' +
      '<Style ss:ID="b"><Font ss:Bold="1"/></Style>' +
      '<Style ss:ID="s"><Interior ss:Color="#1a2a3a" ss:Pattern="Solid"/><Font ss:Color="#ffffff" ss:Bold="1"/></Style>' +
    '</Styles>\n' +
    '<Worksheet ss:Name="Mfg Review"><Table>\n';

  rows.forEach(function(row, ri) {
    var styleId = ri === 0 ? 'h' : (row[0] === 'SUMMARY' || row[0] === 'STEP' ? 'b' : '');
    xml += '<Row>';
    row.forEach(function(cell) {
      var val = String(cell || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      xml += '<Cell' + (styleId ? ' ss:StyleID="' + styleId + '"' : '') + '>' +
             '<Data ss:Type="String">' + val + '</Data></Cell>';
    });
    xml += '</Row>\n';
  });

  xml += '</Table></Worksheet></Workbook>';
  var fn = 'mfg-review-' + (S.getGeneral().jobNumber || 'export').replace(/\s+/g,'-') + '.xls';
  exportDownload(fn, xml, 'application/vnd.ms-excel');
}

// ---------------------------------------------------------------------------
// Export — CSV
// ---------------------------------------------------------------------------

function exportToCSV() {
  var chain = exportGetChain(); if (!chain) return;
  var first = chain[0], last = chain[chain.length - 1];
  var massIn  = first.massOut;
  var massOut = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;

  function csvRow(cells) {
    return cells.map(function(c) {
      var s = String(c || '');
      if (s.indexOf(',') > -1 || s.indexOf('"') > -1 || s.indexOf('\n') > -1)
        s = '"' + s.replace(/"/g,'""') + '"';
      return s;
    }).join(',');
  }

  var lines = [];
  lines.push(csvRow(['Forgeworks Manufacturing Review']));
  lines.push(csvRow(['Job', S.getGeneral().jobNumber||'', 'Customer', S.getGeneral().customer||'']));
  lines.push(csvRow(['Engineer', S.getGeneral().engineer||'', 'Date', S.getGeneral().dateCreated||'']));
  lines.push(csvRow(['Units', S.getUnitSystem() === 'imperial' ? 'Imperial' : 'Metric']));
  lines.push('');
  lines.push(csvRow(['SUMMARY', '', '', '']));
  lines.push(csvRow(['Mass In', dMass(massIn), 'Mass Out', dMass(massOut)]));
  lines.push(csvRow(['Yield', yieldPct + '%', 'Steps', chain.length]));
  lines.push('');
  lines.push(csvRow(['Step', 'Parameter', 'Value', 'Loss']));

  chain.forEach(function(step) {
    var firstCalc = true;
    step.calcs.forEach(function(c) {
      lines.push(csvRow([
        firstCalc ? step.label : '',
        c.label, c.result,
        firstCalc && step.massLoss > 0 ? '-' + dMass(step.massLoss) + ' (' + step.lossPct + '%)' : '',
      ]));
      firstCalc = false;
    });
    lines.push('');
  });

  var fn = 'mfg-review-' + (S.getGeneral().jobNumber || 'export').replace(/\s+/g,'-') + '.csv';
  exportDownload(fn, lines.join('\r\n'), 'text/csv');
}

// ---------------------------------------------------------------------------
// Export — plain text
// ---------------------------------------------------------------------------

function exportToTxt() {
  var chain = exportGetChain(); if (!chain) return;
  var first = chain[0], last = chain[chain.length - 1];
  var massIn  = first.massOut;
  var massOut = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var HR = '─'.repeat(56);
  var lines = [];

  lines.push('FORGEWORKS  ·  MANUFACTURING REVIEW');
  lines.push(HR);
  lines.push('Job       ' + (S.getGeneral().jobNumber  || '—'));
  lines.push('Customer  ' + (S.getGeneral().customer   || '—'));
  lines.push('Engineer  ' + (S.getGeneral().engineer   || '—'));
  lines.push('Date      ' + (S.getGeneral().dateCreated|| '—'));
  lines.push('Status    ' + (S.getGeneral().status     || '—'));
  lines.push('Units     ' + (S.getUnitSystem() === 'imperial' ? 'Imperial' : 'Metric'));
  lines.push(HR);
  lines.push('SUMMARY');
  lines.push('  Mass In   ' + dMass(massIn));
  lines.push('  Mass Out  ' + dMass(massOut));
  lines.push('  Yield     ' + yieldPct + '%');
  lines.push('  Steps     ' + chain.length);
  lines.push(HR);

  chain.forEach(function(step, i) {
    lines.push((i + 1) + '.  ' + step.label.toUpperCase());
    if (step.massLoss > 0) {
      lines.push('    Loss  −' + dMass(step.massLoss) + '  (' + step.lossPct + '%)');
    }
    step.calcs.forEach(function(c) {
      var pad = '    ' + c.label;
      while (pad.length < 28) pad += ' ';
      lines.push(pad + c.result);
    });
    lines.push('');
  });

  lines.push(HR);
  lines.push('Generated  ' + new Date().toLocaleString());
  lines.push('Forgeworks MFG-REVIEW v2.0');

  var fn = 'mfg-review-' + (S.getGeneral().jobNumber || 'export').replace(/\s+/g,'-') + '.txt';
  exportDownload(fn, lines.join('\n'), 'text/plain');
}


// ===========================================================================
// REUSABLE INPUT COMPONENTS
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

function refreshStatusBadge() {
  var el = document.getElementById('mr-g-status-badge');
  if (!el) return;
  var colors = {
    draft:    { bg: 'rgba(255,255,255,0.06)', color: '#99aacc', border: 'rgba(255,255,255,0.20)' },
    review:   { bg: 'rgba(233,196,106,0.10)', color: '#e9c46a', border: 'rgba(233,196,106,0.35)' },
    approved: { bg: 'rgba(80,200,120,0.10)',  color: '#50d080', border: 'rgba(80,200,120,0.35)'  },
    released: { bg: 'rgba(80,160,255,0.10)',  color: '#60b0ff', border: 'rgba(80,160,255,0.35)'  },
    obsolete: { bg: 'rgba(160,80,80,0.10)',   color: '#cc8888', border: 'rgba(160,80,80,0.35)'   },
  };
  var c = colors[S.getGeneral().status] || colors.draft;
  el.textContent = S.getGeneral().status.toUpperCase();
  el.style.background = c.bg;
  el.style.color = c.color;
  el.style.borderColor = c.border;
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


// ===========================================================================
// STYLES
// ===========================================================================

function injectStyles() {
  if (document.getElementById('mr-styles')) return;
  var style = document.createElement('style');
  style.id = 'mr-styles';
  style.textContent =
    '#forgeworks-mfg-review ::-webkit-scrollbar{width:5px}' +
    '#forgeworks-mfg-review ::-webkit-scrollbar-track{background:rgba(0,0,0,0.2)}' +
    '#forgeworks-mfg-review ::-webkit-scrollbar-thumb{background:' + ACCENT_DIM + '0.2);border-radius:3px}' +
    '#forgeworks-mfg-review ::-webkit-scrollbar-thumb:hover{background:' + ACCENT_DIM + '0.4)}' +
    '#forgeworks-mfg-review input[type=number]::-webkit-inner-spin-button{opacity:0.3}' +
    '#forgeworks-mfg-review select option{background:#0d1520;color:#aabbcc}' +
    '.mr-node:active{cursor:grabbing!important}' +
    '#mr-ctx-menu{user-select:none}';
  document.head.appendChild(style);
}


// ===========================================================================
// DEFAULT GRAPH
// ===========================================================================

function buildDefaultGraph() {
  var sp = NODE_W + 80;
  var sx = 60, sy = 160;
  // stock_in → heat → forge → heat_treat → inspect → stock_out
  var n0 = createNode('stock_in',   sx,        sy);
  var n1 = createNode('heat',       sx+sp,     sy);
  var n2 = createNode('forge',      sx+sp*2,   sy);
  var n3 = createNode('heat_treat', sx+sp*3,   sy);
  var n4 = createNode('inspect',    sx+sp*4,   sy);
  var n5 = createNode('stock_out',  sx+sp*5,   sy);
  addConnection(n0.id, n1.id);
  addConnection(n1.id, n2.id);
  addConnection(n2.id, n3.id);
  addConnection(n3.id, n4.id);
  addConnection(n4.id, n5.id);
  refreshRightPanel(); refreshCalcPanel();
}


// ===========================================================================
// PUBLIC API
// ===========================================================================

export function show() {
  buildOverlay();
  S.getOverlay().style.display = 'flex';
  S.setVisible(true);
  setDisplaySystem(S.getUnitSystem());   // sync unit lib to current default
  refreshLeftPanel();
  refreshStatusBadge();
  if (S.getNodes().length === 0) {
    S.resetViewport();
    buildDefaultGraph();
  }
  applyWorldTransform();
}

export function hide() {
  if (S.getOverlay()) S.getOverlay().style.display = 'none';
  S.setVisible(false);
  dismissContextMenu();
}

export function isVisible() { return S.isVisible(); }

export function onBack(callback) { S.setBackCallback(callback); }