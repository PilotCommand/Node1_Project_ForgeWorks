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

var NODE_W   = 180;
var NODE_H   = 72;
var PORT_R   = 6;
var PORT_HIT = 14;

var ACCENT     = '#e05c3a';
var ACCENT_DIM = 'rgba(224, 92, 58, ';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

var overlay      = null;
var backCallback = null;
var visible      = false;

var canvasArea   = null;
var svgLayer     = null;
var nodesLayer   = null;

var nodes        = [];
var connections  = [];
var _nid         = 0;
var _cid         = 0;

var selectedId     = null;
var selectedConnId = null;   // currently selected connection
var dragState      = null;
var ctxMenu      = null;
var leftMode     = 'general';  // 'general' | 'node_detail' | 'path'

// Canvas pan / zoom
var panX  = 0;
var panY  = 0;
var zoom  = 1;
var worldLayer = null;   // single div that holds nodesLayer + svgLayer, gets the transform

var general = {
  // Logistical fields (left panel)
  jobNumber:    'JOB-001',
  partNumber:   '',
  partName:     '',
  revision:     'A',
  customer:     '',
  engineer:     '',
  dateCreated:  new Date().toISOString().slice(0, 10),
  status:       'draft',
  notes:        '',
  // Material fields (used by calculations, set via Stock In node)
  material:     '4140',
  condition:    'annealed',
  density:      7.85,
};

// ---------------------------------------------------------------------------
// Reference Data
// ---------------------------------------------------------------------------

var MATERIALS = [
  { code: '1018',  name: '1018 Carbon Steel',      density: 7.87 },
  { code: '1045',  name: '1045 Medium Carbon',     density: 7.85 },
  { code: '4130',  name: '4130 Chromoly',           density: 7.85 },
  { code: '4140',  name: '4140 Chrome-Moly',        density: 7.85 },
  { code: '4340',  name: '4340 Ni-Cr-Mo',           density: 7.85 },
  { code: '8620',  name: '8620 Case Hardening',     density: 7.85 },
  { code: '304SS', name: '304 Stainless',           density: 7.93 },
  { code: '316SS', name: '316 Stainless',           density: 7.98 },
  { code: 'H13',   name: 'H13 Tool Steel',          density: 7.75 },
  { code: '6061',  name: '6061 Aluminium',          density: 2.70 },
  { code: '7075',  name: '7075 Aluminium',          density: 2.81 },
  { code: 'Ti64',  name: 'Ti-6Al-4V Titanium',      density: 4.43 },
];

// ---------------------------------------------------------------------------
// Node Type Definitions
// ---------------------------------------------------------------------------

var NODE_DEFS = {

  stock_in: {
    label: 'Stock In', color: '#3a1208', textColor: '#ffb090', borderColor: '#e05c3a',
    hasInput: false, hasOutput: true,
    defaultParams: {
      poNumber: '', heatNumber: '', supplier: '', certNumber: '',
      baseAlloy: 'carbon_alloy_steel', material: '4140', condition: 'annealed', density: 7.85,
      mfgMethod: 'continuous_cast', priorHT: 'none', grainDir: 'longitudinal', grainSize: '',
      geometry: 'round_bar', diameter: 150, length: 3000, wallThickness: 0, quantity: 1,
    },
    paramDefs: [
      { section: 'Procurement' },
      { key: 'poNumber',   label: 'PO Number',       type: 'text' },
      { key: 'heatNumber', label: 'Heat / Lot #',    type: 'text' },
      { key: 'supplier',   label: 'Supplier / Mill', type: 'text' },
      { key: 'certNumber', label: 'Mill Cert #',     type: 'text' },
      { section: 'Material Chemistry' },
      { key: 'baseAlloy', label: 'Alloy System', type: 'select', options: [
        'carbon_alloy_steel','stainless_steel','tool_steel','cast_iron',
        'aluminum','copper_brass','nickel','titanium',
        'cobalt','magnesium','tungsten','superalloy','other',
      ]},
      { key: 'material', label: 'Grade / Designation', type: 'select', options: [
        '1018','1045','1080','4130','4140','4340','4620','8620','52100',
        'H13','D2','M2','A2','S7',
        '304','316L','410','17-4PH','15-5PH',
        'inconel718','inconel625','waspaloy','hastelloy_X',
        'ti-6al-4v','ti-6al-2sn-4zr-2mo',
        '6061-T6','7075-T6','2024-T4',
        'C11000','C17200',
        'custom',
      ]},
      { key: 'condition', label: 'Incoming Condition', type: 'select', options: [
        'annealed','normalized','as_rolled','as_cast','quench_temper','stress_relief','unknown',
      ]},
      { key: 'density', label: 'Density', unitType: 'density', type: 'number', min: 0.5, max: 25, step: 0.01 },
      { section: 'Prior Processing' },
      { key: 'mfgMethod', label: 'Manufacturing Method', type: 'select', options: [
        'continuous_cast','ingot_cast','forged','rolled','extruded','drawn','sintered','unknown',
      ]},
      { key: 'priorHT', label: 'Prior Heat Treatment', type: 'select', options: [
        'none','annealed','normalized','quench_temper','stress_relief','case_hardened','unknown',
      ]},
      { key: 'grainDir',  label: 'Grain Direction',    type: 'select', options: ['longitudinal','transverse','unknown','not_applicable'] },
      { key: 'grainSize', label: 'Grain Size (ASTM #)', type: 'text' },
      { section: 'Geometry' },
      { key: 'geometry', label: 'Stock Form', type: 'select', options: [
        'round_bar','square_bar','flat_bar','hexagonal_bar',
        'billet','bloom','slab','ingot','tube','ring','plate','sheet',
      ]},
      { key: 'diameter',      label: 'Diameter / Width', unitType: 'length', type: 'number', min: 1,  max: 5000,  step: 1 },
      { key: 'length',        label: 'Length / Height',  unitType: 'length', type: 'number', min: 1,  max: 20000, step: 1 },
      { key: 'wallThickness', label: 'Wall Thickness',   unitType: 'length', type: 'number', min: 0,  max: 2000,  step: 0.5 },
      { section: 'Quantity' },
      { key: 'quantity', label: 'Pieces / Bars', type: 'number', min: 1, max: 9999, step: 1 },
    ],
  },

  cut: {
    label: 'Cut / Size', color: '#101820', textColor: '#99bbcc', borderColor: '#405060',
    hasInput: true, hasOutput: true,
    defaultParams: {
      method: 'saw', bladeType: 'bi_metal', coolant: 'flood',
      kerfMm: 4, cropLossMm: 150, targetLength: 200,
      surfaceReq: 'as_cut', notes: '',
    },
    paramDefs: [
      { section: 'Method' },
      { key: 'method',    label: 'Cutting Method', type: 'select', options: [
        'saw','shear','torch','abrasive_wheel','wire_edm','lathe_part_off',
      ]},
      { key: 'bladeType', label: 'Blade / Wheel',  type: 'select', options: [
        'bi_metal','carbide_tipped','diamond','abrasive_wheel','torch_tip','not_applicable',
      ]},
      { key: 'coolant',   label: 'Coolant',         type: 'select', options: ['flood','mist','dry','air_blast'] },
      { section: 'Dimensions' },
      { key: 'kerfMm',       label: 'Kerf Width',   unitType: 'length', type: 'number', min: 0,  max: 30,    step: 0.5 },
      { key: 'cropLossMm',   label: 'Crop Loss',    unitType: 'length', type: 'number', min: 0,  max: 1000,  step: 1   },
      { key: 'targetLength', label: 'Blank Length', unitType: 'length', type: 'number', min: 1,  max: 10000, step: 1   },
      { section: 'Quality' },
      { key: 'surfaceReq', label: 'End Condition', type: 'select', options: [
        'as_cut','deburred','faced','ground_flat','inspected',
      ]},
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  heat: {
    label: 'Heat', color: '#201000', textColor: '#ffe090', borderColor: '#b07010',
    hasInput: true, hasOutput: true,
    defaultParams: {
      furnaceType: 'gas_fired', atmosphere: 'air', loadMethod: 'batch',
      targetTemp: 1200, minTemp: 1100, soakMin: 30, scaleLossPct: 1.5,
      furnaceId: '',
    },
    paramDefs: [
      { section: 'Furnace' },
      { key: 'furnaceType', label: 'Furnace Type', type: 'select', options: [
        'gas_fired','electric_resistance','induction','salt_bath','fluidized_bed','radiant_tube','car_bottom',
      ]},
      { key: 'atmosphere',  label: 'Atmosphere',   type: 'select', options: [
        'air','nitrogen','endothermic','exothermic','vacuum','argon','salt',
      ]},
      { key: 'loadMethod',  label: 'Loading Method', type: 'select', options: [
        'single_piece','batch','conveyor','rotary_hearth','walking_beam',
      ]},
      { key: 'furnaceId',   label: 'Furnace ID / #', type: 'text' },
      { section: 'Temperature' },
      { key: 'targetTemp',   label: 'Target Temp',    unitType: 'temp', type: 'number', min: 0, max: 1450, step: 10 },
      { key: 'minTemp',      label: 'Min Forge Temp', unitType: 'temp', type: 'number', min: 0, max: 1450, step: 10 },
      { key: 'soakMin',      label: 'Soak Time (min)',                  type: 'number', min: 1, max: 600,  step: 1  },
      { section: 'Scale Loss' },
      { key: 'scaleLossPct', label: 'Scale Loss (%)', type: 'number', min: 0, max: 10, step: 0.1 },
    ],
  },

  forge: {
    label: 'Forge', color: '#200800', textColor: '#ffaa70', borderColor: '#a03008',
    hasInput: true, hasOutput: true,
    defaultParams: {
      process: 'open_die', equipment: 'hydraulic_press',
      pressTonnage: 2500, numHits: 3,
      dieTemp: 200, lubricant: 'graphite', dieNumber: '',
      flashPct: 15, forgeRatio: 3.0,
      outDiameter: 100, outHeight: 150,
    },
    paramDefs: [
      { section: 'Process' },
      { key: 'process',   label: 'Process Type', type: 'select', options: [
        'open_die','closed_die','upset','ring_roll','hammer','isothermal','near_net_shape',
      ]},
      { key: 'equipment', label: 'Equipment',    type: 'select', options: [
        'hydraulic_press','mechanical_press','screw_press',
        'drop_hammer','counterblow','ring_mill','forge_roll',
      ]},
      { key: 'pressTonnage', label: 'Press Tonnage (ton)', type: 'number', min: 10, max: 50000, step: 50 },
      { key: 'numHits',      label: 'Hits / Strokes',      type: 'number', min: 1,  max: 100,   step: 1  },
      { section: 'Tooling' },
      { key: 'dieNumber', label: 'Die / Tool #',     type: 'text' },
      { key: 'dieTemp',   label: 'Die Preheat Temp', unitType: 'temp', type: 'number', min: 0, max: 500, step: 10 },
      { key: 'lubricant', label: 'Lubricant',         type: 'select', options: [
        'graphite','glass','oil_graphite','molybdenum_disulfide','dry','none',
      ]},
      { section: 'Material Flow' },
      { key: 'flashPct',   label: 'Flash Allowance (%)', type: 'number', min: 0,  max: 50, step: 0.5 },
      { key: 'forgeRatio', label: 'Forge Ratio (R)',     type: 'number', min: 1,  max: 20, step: 0.1 },
      { section: 'Output Dimensions' },
      { key: 'outDiameter', label: 'Output Diameter', unitType: 'length', type: 'number', min: 1, max: 5000, step: 1 },
      { key: 'outHeight',   label: 'Output Height',   unitType: 'length', type: 'number', min: 1, max: 5000, step: 1 },
    ],
  },

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
      { key: 'dieType',       label: 'Trim Die Type',  type: 'select', options: [
        'conventional','progressive','compound','precision',
      ]},
      { key: 'dieNumber',     label: 'Die Number',     type: 'text' },
      { section: 'Flash' },
      { key: 'flashPct',         label: 'Flash to Remove (%)', type: 'number', min: 0, max: 50, step: 0.5 },
      { key: 'flashDisposition', label: 'Flash Disposition',   type: 'select', options: [
        'scrap_recycle','remelt','reforge','discard',
      ]},
    ],
  },

  heat_treat: {
    label: 'Heat Treat', color: '#140828', textColor: '#c0a0f0', borderColor: '#5838a8',
    hasInput: true, hasOutput: true,
    defaultParams: {
      process: 'normalize', specNumber: '',
      furnaceType: 'electric_resistance', atmosphere: 'air',
      austenitizeTemp: 900, soakMin: 60,
      quenchant: 'air', quenchAgitation: 'still',
      temperTemp: 0, temperSoakMin: 0,
      hardnessScale: 'HRC', targetHardnessMin: 0, targetHardnessMax: 0,
      caseDepth: 0,
    },
    paramDefs: [
      { section: 'Process' },
      { key: 'process',    label: 'Process Type', type: 'select', options: [
        'normalize','anneal','stress_relief',
        'quench_temper','martempering','austempering',
        'case_harden','carbonitriding','nitriding',
        'solution_anneal','precipitation_harden','cryogenic',
      ]},
      { key: 'specNumber', label: 'Spec / AMS #', type: 'text' },
      { section: 'Furnace' },
      { key: 'furnaceType', label: 'Furnace Type', type: 'select', options: [
        'electric_resistance','gas_fired','vacuum','salt_bath','fluid_bed','induction','car_bottom',
      ]},
      { key: 'atmosphere',  label: 'Atmosphere',  type: 'select', options: [
        'air','nitrogen','endothermic','vacuum','argon','salt','controlled_carbon',
      ]},
      { section: 'Austenitize / Heat' },
      { key: 'austenitizeTemp', label: 'Heat Temp',    unitType: 'temp', type: 'number', min: 100, max: 1300, step: 10 },
      { key: 'soakMin',         label: 'Soak (min)',                     type: 'number', min: 1,   max: 2400, step: 5  },
      { section: 'Quench' },
      { key: 'quenchant',       label: 'Quench Medium',    type: 'select', options: [
        'air','oil','water','polymer','salt','press_quench','none',
      ]},
      { key: 'quenchAgitation', label: 'Quench Agitation', type: 'select', options: [
        'still','mild','moderate','vigorous','spray',
      ]},
      { section: 'Temper' },
      { key: 'temperTemp',    label: 'Temper Temp',  unitType: 'temp', type: 'number', min: 0, max: 750, step: 10 },
      { key: 'temperSoakMin', label: 'Temper Soak (min)',               type: 'number', min: 0, max: 600, step: 5  },
      { section: 'Target Properties' },
      { key: 'hardnessScale',     label: 'Hardness Scale', type: 'select', options: ['HRC','HRB','HB','HV','HRA'] },
      { key: 'targetHardnessMin', label: 'Min Hardness',  type: 'number', min: 0, max: 1000, step: 1 },
      { key: 'targetHardnessMax', label: 'Max Hardness',  type: 'number', min: 0, max: 1000, step: 1 },
      { key: 'caseDepth',         label: 'Case Depth',    unitType: 'length', type: 'number', min: 0, max: 10, step: 0.05 },
    ],
  },

  machine: {
    label: 'Machine', color: '#081a14', textColor: '#70e0c0', borderColor: '#187050',
    hasInput: true, hasOutput: true,
    defaultParams: {
      operation: 'turn', machineType: 'cnc_lathe', numSetups: 1, coolant: 'flood',
      programNumber: '', setupNumber: '',
      stockPerSurface: 3, outDiameter: 94, outHeight: 144,
      surfaceFinish: '125', toleranceClass: 'IT7',
    },
    paramDefs: [
      { section: 'Operation' },
      { key: 'operation',   label: 'Primary Operation', type: 'select', options: [
        'turn','mill','grind','drill','bore','thread','broach','hob','ream',
      ]},
      { key: 'machineType', label: 'Machine Type',      type: 'select', options: [
        'cnc_lathe','cnc_mill','cnc_grinder','multi_axis','manual_lathe','manual_mill','transfer_line','edm',
      ]},
      { key: 'numSetups',   label: 'Number of Setups',  type: 'number', min: 1, max: 20, step: 1 },
      { key: 'coolant',     label: 'Coolant',           type: 'select', options: [
        'flood','mist','dry','through_tool','air_blast','cryogenic',
      ]},
      { section: 'Programs & Fixtures' },
      { key: 'programNumber', label: 'CNC Program #', type: 'text' },
      { key: 'setupNumber',   label: 'Setup Sheet #',  type: 'text' },
      { section: 'Output Dimensions' },
      { key: 'stockPerSurface', label: 'Stock / Surface', unitType: 'length', type: 'number', min: 0,  max: 25,   step: 0.5 },
      { key: 'outDiameter',     label: 'Final OD',        unitType: 'length', type: 'number', min: 1,  max: 5000, step: 1   },
      { key: 'outHeight',       label: 'Final Height',    unitType: 'length', type: 'number', min: 1,  max: 5000, step: 1   },
      { section: 'Quality' },
      { key: 'surfaceFinish',  label: 'Surface Finish (Ra μin)', type: 'select', options: ['16','32','63','125','250','500'] },
      { key: 'toleranceClass', label: 'Tolerance Class',         type: 'select', options: ['IT4','IT5','IT6','IT7','IT8','IT9','IT10','IT11'] },
    ],
  },

  inspect: {
    label: 'Inspect', color: '#081a0a', textColor: '#80e090', borderColor: '#188030',
    hasInput: true, hasOutput: true,
    defaultParams: {
      method: 'dimensional', standard: 'customer_dwg', specNumber: '',
      samplingPlan: '100_percent', aqlLevel: '1.0',
      checkDimensional: 'yes', checkHardness: 'no',
      checkNdt: 'no', ndtMethod: 'none',
      result: 'pending',
    },
    paramDefs: [
      { section: 'Inspection Type' },
      { key: 'method',    label: 'Primary Method', type: 'select', options: [
        'visual','dimensional','cmm','hardness',
        'ultrasonic','magnetic_particle','dye_penetrant','x_ray','eddy_current',
      ]},
      { key: 'standard',   label: 'Standard',     type: 'select', options: [
        'customer_dwg','ASTM','AMS','MIL_SPEC','ISO','NADCAP','in_house',
      ]},
      { key: 'specNumber', label: 'Spec / Dwg #', type: 'text' },
      { section: 'Sampling' },
      { key: 'samplingPlan', label: 'Sampling Plan', type: 'select', options: [
        '100_percent','first_article_only','AQL','skip_lot','statistical',
      ]},
      { key: 'aqlLevel', label: 'AQL Level', type: 'select', options: [
        '0.065','0.10','0.25','0.65','1.0','1.5','2.5','4.0',
      ]},
      { section: 'Required Checks' },
      { key: 'checkDimensional', label: 'Dimensional', type: 'select', options: ['yes','no'] },
      { key: 'checkHardness',    label: 'Hardness',    type: 'select', options: ['yes','no'] },
      { key: 'checkNdt',         label: 'NDT',         type: 'select', options: ['yes','no'] },
      { key: 'ndtMethod',        label: 'NDT Method',  type: 'select', options: [
        'none','ultrasonic','magnetic_particle','dye_penetrant','x_ray','eddy_current',
      ]},
      { section: 'Disposition' },
      { key: 'result', label: 'Result / Status', type: 'select', options: [
        'pending','pass','fail','conditional_pass','hold_for_review','scrap',
      ]},
    ],
  },

  stock_out: {
    label: 'Stock Out', color: '#001828', textColor: '#80d0f0', borderColor: '#0070a0',
    hasInput: true, hasOutput: false,
    defaultParams: {
      partNumber: '', partRevision: '', workOrderNumber: '',
      destination: 'customer', customerName: '', shippingMethod: 'ground',
      packagingType: 'standard_crate', cleaningReq: 'clean_and_oil', preservative: 'none',
      certRequired: 'yes', certType: 'C_of_C',
    },
    paramDefs: [
      { section: 'Identification' },
      { key: 'partNumber',      label: 'Part Number',  type: 'text' },
      { key: 'partRevision',    label: 'Revision',     type: 'text' },
      { key: 'workOrderNumber', label: 'Work Order #', type: 'text' },
      { section: 'Destination' },
      { key: 'destination',    label: 'Destination',    type: 'select', options: [
        'customer','warehouse','next_operation','subcontractor','inspection_hold',
      ]},
      { key: 'customerName',   label: 'Customer / Dest.', type: 'text' },
      { key: 'shippingMethod', label: 'Shipping Method',  type: 'select', options: [
        'ground','air_freight','ocean_freight','will_call','internal_transfer',
      ]},
      { section: 'Packaging & Preservation' },
      { key: 'packagingType', label: 'Packaging',    type: 'select', options: [
        'standard_crate','custom_crate','bulk_bin','individual_bag','vacuum_sealed','returnable_rack',
      ]},
      { key: 'cleaningReq',   label: 'Cleaning',     type: 'select', options: [
        'as_is','clean_and_oil','degrease','passivate','clean_only',
      ]},
      { key: 'preservative',  label: 'Preservative', type: 'select', options: [
        'none','rust_preventive_oil','VCI_paper','desiccant','wax',
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

function computeChain() {
  var startNode = nodes.find(function(n) { return n.type === 'stock_in'; });
  if (!startNode) return [];

  var chain = [];
  var visited = {};
  var current = startNode;
  var massKg = 0;
  var dims = {};

  while (current && !visited[current.id]) {
    visited[current.id] = true;

    var conn = connections.find(function(c) { return c.fromId === current.id; });

    // Compute current node (pass 1 / only pass)
    var step = computeStep(current, massKg, dims);
    chain.push(step);
    massKg = step.massOut;
    dims   = step.dimsOut;

    if (!conn) break;

    var nextNode = nodes.find(function(n) { return n.id === conn.toId; });
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
      var dens       = p.density || general.density;
      var vol_mm3    = Math.PI * Math.pow(p.diameter / 2, 2) * p.length;
      var massPerBar = round3(vol_mm3 / 1e6 * dens);
      var totalMass  = round3(massPerBar * p.quantity);
      step.massIn  = 0;
      step.massOut = totalMass;
      step.dimsOut = { diameter: p.diameter, length: p.length, geometry: p.geometry };
      step.calcs   = [
        { label: 'Material',      result: (p.material || '—') + '  (' + (p.condition || '').replace(/_/g,' ') + ')' },
        { label: 'Form',          result: (p.geometry || '—').replace(/_/g,' ') + (p.mfgMethod ? '  ·  ' + p.mfgMethod.replace(/_/g,' ') : '') },
        { label: 'PO / Heat',     result: [(p.poNumber||'—'), (p.heatNumber||'—')].join('  /  ') },
        { label: 'Volume / bar',  result: dVol(vol_mm3) },
        { label: 'Mass / bar',    result: dMass(massPerBar) },
        { label: 'Total mass',    result: dMass(totalMass) + '  (' + p.quantity + ' pc' + (p.quantity > 1 ? 's' : '') + ')' },
      ];
      break;
    }

    case 'cut': {
      var diam        = dimsIn.diameter || p.diameter || 150;
      var barLen      = dimsIn.length   || 3000;
      var usable      = barLen - p.cropLossMm;
      var blanksPerBar= Math.max(0, Math.floor(usable / (p.targetLength + p.kerfMm)));
      var blankVol    = Math.PI * Math.pow(diam / 2, 2) * p.targetLength;
      var blankMass   = round3(blankVol / 1e6 * general.density);
      var massOut     = round3(blankMass * blanksPerBar);
      step.massOut    = massOut;
      step.massLoss   = round3(Math.max(0, massIn - massOut));
      step.dimsOut    = { diameter: diam, length: p.targetLength };
      step.calcs      = [
        { label: 'Method',         result: (p.method||'saw').replace(/_/g,' ') + (p.bladeType && p.bladeType !== 'not_applicable' ? '  ·  ' + p.bladeType.replace(/_/g,' ') : '') },
        { label: 'Usable length',  result: dLen(usable) + '  (crop ' + dLen(p.cropLossMm) + ')' },
        { label: 'Blanks / bar',   result: blanksPerBar + '  (kerf ' + dLen(p.kerfMm) + ')' },
        { label: 'Mass / blank',   result: dMass(blankMass) },
        { label: 'Total out',      result: dMass(massOut) },
        { label: 'Cut loss',       result: dMass(step.massLoss) },
      ];
      break;
    }

    case 'heat': {
      var scaleLoss  = round3(massIn * (p.scaleLossPct / 100));
      step.massOut   = round3(massIn - scaleLoss);
      step.massLoss  = scaleLoss;
      step.dimsOut   = Object.assign({}, dimsIn);
      step.calcs     = [
        { label: 'Furnace',      result: (p.furnaceType||'').replace(/_/g,' ') + '  ·  ' + (p.atmosphere||'air') },
        { label: 'Loading',      result: (p.loadMethod||'batch').replace(/_/g,' ') },
        { label: 'Target temp',  result: dTemp(p.targetTemp) + '  (min: ' + dTemp(p.minTemp) + ')' },
        { label: 'Soak',         result: p.soakMin + ' min' },
        { label: 'Scale loss',   result: dMass(scaleLoss) + '  (' + p.scaleLossPct + '%)' },
        { label: 'Mass out',     result: dMass(step.massOut) },
      ];
      break;
    }

    case 'forge': {
      var h0  = dimsIn.length || dimsIn.height || 0;
      var h1  = p.outHeight;
      var eps = (h0 > 0 && h1 > 0) ? round3(Math.log(h0 / h1)) : null;
      var pct = (h0 > 0) ? round3((h0 - h1) / h0 * 100) : null;
      var flashLoss = round3(massIn * (p.flashPct / 100));
      step.massOut  = round3(massIn - flashLoss);
      step.massLoss = flashLoss;
      step.dimsOut  = { diameter: p.outDiameter, height: p.outHeight };
      step.calcs    = [
        { label: 'Process',       result: (p.process||'').replace(/_/g,' ') + '  ·  ' + (p.equipment||'').replace(/_/g,' ') },
        { label: 'Press / Hits',  result: (p.pressTonnage||'—') + ' ton  ×  ' + (p.numHits||1) + ' hit' + ((p.numHits||1) > 1 ? 's' : '') },
        { label: 'Die temp',      result: dTemp(p.dieTemp||200) + '  ·  ' + (p.lubricant||'graphite').replace(/_/g,' ') },
        { label: 'Flash loss',    result: dMass(flashLoss) + '  (' + p.flashPct + '%)' },
        { label: 'Mass out',      result: dMass(step.massOut) },
        { label: 'Forge ratio R', result: p.forgeRatio + ' : 1' + (p.forgeRatio >= 3 ? '  ✓' : '  ⚠') },
        { label: 'True strain ε', result: eps !== null ? '' + eps : '—' },
        { label: '% Height red.', result: pct !== null ? pct + '%' : '—' },
      ];
      break;
    }

    case 'trim': {
      var trimLoss  = round3(massIn * (p.flashPct / 100));
      step.massOut  = round3(massIn - trimLoss);
      step.massLoss = trimLoss;
      step.dimsOut  = Object.assign({}, dimsIn);
      step.calcs    = [
        { label: 'Condition',     result: (p.trimCondition||'hot') + '  ·  ' + (p.dieType||'conventional').replace(/_/g,' ') + ' die' },
        { label: 'Flash removed', result: dMass(trimLoss) + '  (' + p.flashPct + '%)' },
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
        ? p.targetHardnessMin + '–' + p.targetHardnessMax + ' ' + p.hardnessScale
        : '—';
      step.calcs    = [
        { label: 'Process',    result: (p.process||'').replace(/_/g,' ') + (p.specNumber ? '  ·  ' + p.specNumber : '') },
        { label: 'Furnace',    result: (p.furnaceType||'').replace(/_/g,' ') + '  ·  ' + (p.atmosphere||'air') },
        { label: 'Heat temp',  result: dTemp(p.austenitizeTemp) + '  ·  ' + (p.soakMin||60) + ' min' },
        { label: 'Quench',     result: (p.quenchant||'air') + '  (' + (p.quenchAgitation||'still') + ')' },
        { label: 'Temper',     result: p.temperTemp > 0 ? dTemp(p.temperTemp) + '  ·  ' + (p.temperSoakMin||0) + ' min' : 'none' },
        { label: 'Target HRD', result: htHardness },
        { label: 'Case depth', result: p.caseDepth > 0 ? dLen(p.caseDepth) : '—' },
        { label: 'Mass',       result: dMass(massIn) + '  (no loss)' },
      ];
      break;
    }

    case 'machine': {
      var dIn  = dimsIn.diameter || dimsIn.outDiameter || 100;
      var hIn  = dimsIn.height || dimsIn.outHeight || 150;
      var volIn  = Math.PI * Math.pow(dIn  / 2, 2) * hIn;
      var volOut = Math.PI * Math.pow(p.outDiameter / 2, 2) * p.outHeight;
      var chipMass = round3(Math.max(0, (volIn - volOut) / 1e6 * general.density));
      step.massOut  = round3(Math.max(0, massIn - chipMass));
      step.massLoss = chipMass;
      step.dimsOut  = { diameter: p.outDiameter, height: p.outHeight };
      step.calcs    = [
        { label: 'Operation',    result: (p.operation||'turn') + '  ·  ' + (p.machineType||'').replace(/_/g,' ') },
        { label: 'Setups',       result: (p.numSetups||1) + ' setup' + ((p.numSetups||1) > 1 ? 's' : '') },
        { label: 'Stock/surface',result: dLen(p.stockPerSurface) },
        { label: 'Final OD',     result: dLen(p.outDiameter) },
        { label: 'Final H',      result: dLen(p.outHeight) },
        { label: 'Finish / Tol', result: p.surfaceFinish + ' Ra  ·  ' + (p.toleranceClass||'IT7') },
        { label: 'Chip loss',    result: dMass(chipMass) },
        { label: 'Mass out',     result: dMass(step.massOut) },
      ];
      break;
    }

    case 'inspect': {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      var checks = [];
      if (p.checkDimensional === 'yes') checks.push('dimensional');
      if (p.checkHardness    === 'yes') checks.push('hardness');
      if (p.checkNdt         === 'yes') checks.push(p.ndtMethod || 'NDT');
      step.calcs    = [
        { label: 'Method',    result: (p.method||'dimensional').replace(/_/g,' ') + '  ·  ' + (p.standard||'').replace(/_/g,' ') },
        { label: 'Sampling',  result: (p.samplingPlan||'100_percent').replace(/_/g,' ') + (p.samplingPlan === 'AQL' ? '  AQL ' + p.aqlLevel : '') },
        { label: 'Checks',    result: checks.length > 0 ? checks.join(', ') : 'see method' },
        { label: 'Result',    result: (p.result||'pending').replace(/_/g,' ') },
        { label: 'Mass',      result: dMass(massIn) + '  (pass-through)' },
      ];
      break;
    }

    case 'stock_out': {
      step.massOut  = massIn;
      step.massLoss = 0;
      step.dimsOut  = Object.assign({}, dimsIn);
      step.calcs    = [
        { label: 'Part',         result: (p.partNumber||'—') + (p.partRevision ? '  Rev ' + p.partRevision : '') },
        { label: 'Destination',  result: (p.destination||'customer').replace(/_/g,' ') + (p.customerName ? '  ·  ' + p.customerName : '') },
        { label: 'Shipping',     result: (p.shippingMethod||'ground').replace(/_/g,' ') },
        { label: 'Packaging',    result: (p.packagingType||'standard_crate').replace(/_/g,' ') },
        { label: 'Cert',         result: p.certRequired === 'yes' ? (p.certType||'C_of_C').replace(/_/g,' ') : 'none required' },
        { label: 'Mass out',     result: dMass(massIn) },
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

function fmtVol(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(3) + ' ×10⁶';
  return Math.round(v).toLocaleString();
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ---------------------------------------------------------------------------
// Unit System — import helpers from measurementunits.js and wrap them
// ---------------------------------------------------------------------------

import { setDisplaySystem, formatValue, convert, celsiusToFahrenheit } from './measurementunits.js';

var unitSystem = 'imperial'; // 'si' | 'imperial'

function setUnitSystem(sys) {
  unitSystem = sys;
  setDisplaySystem(sys);
  // Refresh all node card previews on canvas
  nodes.forEach(function(n) { refreshNodeEl(n.id); });
  // Refresh all display panels
  refreshRightPanel(); refreshCalcPanel();
  refreshLeftPanel();
}

// Display wrappers — all internal values are SI; these convert for display only.

function dMass(kg) {
  if (unitSystem === 'imperial') {
    return round3(kg * 2.20462) + ' lb';
  }
  return kg + ' kg';
}

function dLen(mm) {
  if (unitSystem === 'imperial') {
    return round3(mm / 25.4) + ' in';
  }
  return mm + ' mm';
}

function dTemp(celsius) {
  if (unitSystem === 'imperial') {
    return round3(celsius * 9 / 5 + 32) + ' °F';
  }
  return celsius + ' °C';
}

function dVol(mm3) {
  if (unitSystem === 'imperial') {
    return round3(mm3 / 16387.064) + ' in³';
  }
  return fmtVol(mm3) + ' mm³';
}

function dDensity(g_cm3) {
  if (unitSystem === 'imperial') {
    return round3(g_cm3 * 0.036127) + ' lb/in³';
  }
  return g_cm3 + ' g/cm³';
}

function dMassUnit()   { return unitSystem === 'imperial' ? 'lb'    : 'kg';    }
function dLenUnit()    { return unitSystem === 'imperial' ? 'in'    : 'mm';    }
function dTempUnit()   { return unitSystem === 'imperial' ? '°F'   : '°C';   }
function dVolUnit()    { return unitSystem === 'imperial' ? 'in³'  : 'mm³';  }
function dDensUnit()   { return unitSystem === 'imperial' ? 'lb/in³': 'g/cm³'; }


// ===========================================================================
// DOM BUILDER
// ===========================================================================

function buildOverlay() {
  if (overlay) return;
  injectStyles();

  overlay = document.createElement('div');
  overlay.id = 'forgeworks-mfg-review';
  Object.assign(overlay.style, {
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
  overlay.appendChild(bg);

  overlay.appendChild(buildTopBar());

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
  overlay.appendChild(outer);

  overlay.appendChild(buildActionBar());
  document.body.appendChild(overlay);

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
  backBtn.addEventListener('click', function() { if (backCallback) backCallback(); });
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
  hint.textContent = 'Drag canvas to pan  ·  Scroll to zoom  ·  Right-click canvas to add  ·  Click connection to select  ·  Del to remove';
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
// Left Panel
// ---------------------------------------------------------------------------

function buildLeftPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-left';
  Object.assign(panel.style, {
    width: '280px', minWidth: '240px', maxWidth: '320px', flexShrink: '0',
    display: 'flex', flexDirection: 'column',
    borderRight: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(4,8,14,0.5)',
  });

  var tabs = document.createElement('div');
  Object.assign(tabs.style, { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.20)', flexShrink: '0' });
  ['General', 'Node', 'Path'].forEach(function(label, i) {
    var key = label.toLowerCase().replace(' ', '_');
    var modeVal = key === 'node' ? 'node_detail' : key;
    var tab = document.createElement('div');
    tab.id = 'mr-tab-' + key;
    Object.assign(tab.style, {
      flex: '1', padding: '10px 0', textAlign: 'center',
      fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase',
      cursor: 'pointer', transition: 'all 0.2s ease',
      color: i === 0 ? ACCENT : '#7a9aaa',
      borderBottom: i === 0 ? '2px solid ' + ACCENT : '2px solid transparent',
    });
    tab.textContent = label;
    tab.addEventListener('click', function() {
      leftMode = modeVal;
      refreshLeftPanel();
    });
    tabs.appendChild(tab);
  });
  panel.appendChild(tabs);

  // Status badge strip — always visible below tabs
  var statusStrip = document.createElement('div');
  Object.assign(statusStrip.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 14px', flexShrink: '0',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0,0,0,0.2)',
  });
  var jobLabel = document.createElement('div');
  Object.assign(jobLabel.style, { fontSize: '9px', color: '#7a9aaa', letterSpacing: '0.5px' });
  jobLabel.id = 'mr-strip-job';
  jobLabel.textContent = general.jobNumber || '—';
  var statusBadge = document.createElement('div');
  statusBadge.id = 'mr-g-status-badge';
  Object.assign(statusBadge.style, {
    fontSize: '8px', fontWeight: '700', letterSpacing: '1.5px',
    textTransform: 'uppercase', padding: '2px 8px', borderRadius: '2px',
    border: '1px solid', transition: 'all 0.2s ease',
  });
  statusStrip.appendChild(jobLabel);
  statusStrip.appendChild(statusBadge);
  panel.appendChild(statusStrip);

  var content = document.createElement('div');
  content.id = 'mr-left-content';
  Object.assign(content.style, { flex: '1', overflowY: 'auto', padding: '16px' });
  panel.appendChild(content);
  return panel;
}

function refreshLeftPanel() {
  var gTab = document.getElementById('mr-tab-general');
  var nTab = document.getElementById('mr-tab-node');
  var pTab = document.getElementById('mr-tab-path');
  [
    { el: gTab, mode: 'general'     },
    { el: nTab, mode: 'node_detail' },
    { el: pTab, mode: 'path'        },
  ].forEach(function(t) {
    if (!t.el) return;
    var active = leftMode === t.mode;
    t.el.style.color        = active ? ACCENT : '#7a9aaa';
    t.el.style.borderBottom = active ? '2px solid ' + ACCENT : '2px solid transparent';
  });

  var content = document.getElementById('mr-left-content');
  if (!content) return;
  content.innerHTML = '';

  if (leftMode === 'general') {
    content.appendChild(buildGeneralInputs());
  } else if (leftMode === 'node_detail') {
    var node = nodes.find(function(n) { return n.id === selectedId; });
    if (node) {
      content.appendChild(buildNodeDetail(node));
    } else {
      var ph = document.createElement('div');
      Object.assign(ph.style, { color: '#607888', fontSize: '10px', textAlign: 'center', marginTop: '40px' });
      ph.textContent = 'Click a node to edit its parameters';
      content.appendChild(ph);
    }
  } else if (leftMode === 'path') {
    var conn = connections.find(function(c) { return c.id === selectedConnId; });
    if (conn) {
      content.appendChild(buildPathDetail(conn));
    } else {
      var ph2 = document.createElement('div');
      Object.assign(ph2.style, { color: '#607888', fontSize: '10px', textAlign: 'center', marginTop: '40px', lineHeight: '1.8' });
      ph2.textContent = 'Click a connection to edit its path settings';
      content.appendChild(ph2);
    }
  }
}

function buildGeneralInputs() {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '18px' });

  wrap.appendChild(buildInputSection('Document', [
    buildTextInput('Job Number',  'mr-g-job',  general.jobNumber,  function(v) {
      general.jobNumber = v;
      var s = document.getElementById('mr-strip-job');
      if (s) s.textContent = v || '—';
    }),
    buildTextInput('Part Number', 'mr-g-pn',   general.partNumber, function(v) { general.partNumber = v; }),
    buildTextInput('Part Name',   'mr-g-pname',general.partName,   function(v) { general.partName   = v; }),
    buildTextInput('Revision',    'mr-g-rev',  general.revision,   function(v) { general.revision   = v; }),
  ]));

  wrap.appendChild(buildInputSection('People', [
    buildTextInput('Customer',   'mr-g-customer', general.customer, function(v) { general.customer = v; }),
    buildTextInput('Engineer',   'mr-g-engineer', general.engineer, function(v) { general.engineer = v; }),
  ]));

  wrap.appendChild(buildInputSection('Status', [
    buildTextInput('Date',  'mr-g-date', general.dateCreated, function(v) { general.dateCreated = v; }),
    buildSelectEl('Status', 'mr-g-status', [
      { value: 'draft',     label: 'Draft'      },
      { value: 'review',    label: 'In Review'  },
      { value: 'approved',  label: 'Approved'   },
      { value: 'released',  label: 'Released'   },
      { value: 'obsolete',  label: 'Obsolete'   },
    ], general.status, function(v) { general.status = v; refreshStatusBadge(); }),
  ]));

  wrap.appendChild(buildInputSection('Notes', [
    buildTextareaInput('Notes', 'mr-g-notes', general.notes, function(v) { general.notes = v; }),
  ]));

  return wrap;
}

// Convert SI-stored value to display value for a given unitType
function toDisplay(v, unitType) {
  if (unitType === 'length')  return unitSystem === 'imperial' ? round3(v / 25.4) : v;
  if (unitType === 'temp')    return unitSystem === 'imperial' ? round3(v * 9 / 5 + 32) : v;
  if (unitType === 'density') return unitSystem === 'imperial' ? round3(v * 0.036127) : v;
  return v;
}
function fromDisplay(v, unitType) {
  if (unitType === 'length')  return unitSystem === 'imperial' ? round3(v * 25.4) : v;
  if (unitType === 'temp')    return unitSystem === 'imperial' ? round3((v - 32) * 5 / 9) : v;
  if (unitType === 'density') return unitSystem === 'imperial' ? round3(v / 0.036127) : v;
  return v;
}
function unitSuffix(unitType) {
  if (unitType === 'length')  return unitSystem === 'imperial' ? ' (in)'     : ' (mm)';
  if (unitType === 'temp')    return unitSystem === 'imperial' ? ' (°F)'    : ' (°C)';
  if (unitType === 'density') return unitSystem === 'imperial' ? ' (lb/in³)' : ' (g/cm³)';
  return '';
}
function scaleParam(pd) {
  if (!pd.unitType) return { min: pd.min, max: pd.max, step: pd.step || 1 };
  if (pd.unitType === 'length' && unitSystem === 'imperial') {
    return { min: round3(pd.min / 25.4), max: round3(pd.max / 25.4), step: round3((pd.step || 1) / 25.4) };
  }
  if (pd.unitType === 'temp' && unitSystem === 'imperial') {
    return { min: round3(pd.min * 9/5 + 32), max: round3(pd.max * 9/5 + 32), step: pd.step ? round3(pd.step * 9/5) : 1 };
  }
  if (pd.unitType === 'density' && unitSystem === 'imperial') {
    return { min: round3(pd.min * 0.036127), max: round3(pd.max * 0.036127), step: round3((pd.step || 0.01) * 0.036127) };
  }
  return { min: pd.min, max: pd.max, step: pd.step || 1 };
}

function buildNodeDetail(node) {
  var def = NODE_DEFS[node.type];
  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '16px' });

  var badge = document.createElement('div');
  Object.assign(badge.style, {
    padding: '8px 12px', borderRadius: '3px',
    background: def.color, border: '2px solid ' + def.borderColor,
    fontSize: '10px', fontWeight: '700', letterSpacing: '2px',
    textTransform: 'uppercase', color: def.textColor, textAlign: 'center',
  });
  badge.textContent = def.label;
  wrap.appendChild(badge);

  wrap.appendChild(buildInputSection('Label', [
    buildTextInput('Label', 'mr-node-label', node.label || def.label, function(v) {
      node.label = v; refreshNodeEl(node.id);
    }),
  ]));

  if (def.paramDefs.length > 0) {
    // Group paramDefs by section
    var sections = [];
    var currentSection = { title: 'Parameters', defs: [] };
    def.paramDefs.forEach(function(pd) {
      if (pd.section !== undefined) {
        if (currentSection.defs.length > 0) sections.push(currentSection);
        currentSection = { title: pd.section, defs: [] };
      } else {
        currentSection.defs.push(pd);
      }
    });
    if (currentSection.defs.length > 0) sections.push(currentSection);

    sections.forEach(function(sec) {
      var fields = sec.defs.map(function(pd) {
        if (pd.type === 'select') {
          return buildSelectEl(pd.label, 'mr-nd-' + pd.key,
            pd.options.map(function(o) { return { value: o, label: o.replace(/_/g, ' ') }; }),
            node.params[pd.key] !== undefined ? node.params[pd.key] : '',
            function(v) { node.params[pd.key] = v; refreshRightPanel(); refreshCalcPanel(); refreshNodeEl(node.id); }
          );
        }
        if (pd.type === 'text') {
          return buildTextInput(pd.label, 'mr-nd-' + pd.key,
            node.params[pd.key] !== undefined ? node.params[pd.key] : '',
            function(v) { node.params[pd.key] = v; }
          );
        }
        // Number — convert to display units
        var sc        = scaleParam(pd);
        var dispVal   = toDisplay(node.params[pd.key] !== undefined ? node.params[pd.key] : 0, pd.unitType);
        var fullLabel = pd.label + unitSuffix(pd.unitType);
        return buildNumberInputEl(fullLabel, 'mr-nd-' + pd.key,
          dispVal, sc.min, sc.max, sc.step,
          function(v) {
            node.params[pd.key] = fromDisplay(v, pd.unitType);
            refreshRightPanel(); refreshCalcPanel(); refreshNodeEl(node.id);
          }
        );
      });
      wrap.appendChild(buildInputSection(sec.title, fields));
    });
  }

  // Unit system note
  var unitNote = document.createElement('div');
  Object.assign(unitNote.style, {
    fontSize: '8px', color: '#506070', letterSpacing: '0.5px',
    textAlign: 'right', marginTop: '-8px',
  });
  unitNote.textContent = 'Values stored as SI · displaying ' + (unitSystem === 'imperial' ? 'Imperial' : 'Metric');
  wrap.appendChild(unitNote);

  var delBtn = document.createElement('button');
  Object.assign(delBtn.style, {
    marginTop: '8px', padding: '8px', background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '3px',
    color: '#ef7777', fontSize: '10px', fontFamily: 'inherit',
    letterSpacing: '1px', cursor: 'pointer', transition: 'all 0.2s ease',
  });
  delBtn.textContent = 'Delete Node';
  delBtn.addEventListener('mouseenter', function() { delBtn.style.background = 'rgba(239,68,68,0.15)'; delBtn.style.borderColor = 'rgba(239,68,68,0.6)'; });
  delBtn.addEventListener('mouseleave', function() { delBtn.style.background = 'rgba(239,68,68,0.08)'; delBtn.style.borderColor = 'rgba(239,68,68,0.3)'; });
  delBtn.addEventListener('click', function() { deleteNode(node.id); });
  wrap.appendChild(delBtn);

  return wrap;
}

// ---------------------------------------------------------------------------
// Path Detail (left panel when a connection is selected)
// ---------------------------------------------------------------------------

function buildPathDetail(conn) {
  var fromNode = nodes.find(function(n) { return n.id === conn.fromId; });
  var toNode   = nodes.find(function(n) { return n.id === conn.toId;   });
  var fromDef  = fromNode ? NODE_DEFS[fromNode.type] : null;
  var toDef    = toNode   ? NODE_DEFS[toNode.type]   : null;

  var wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '20px' });

  // ── Connection badge ─────────────────────────────────────────────────────
  var badge = document.createElement('div');
  Object.assign(badge.style, {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 12px', borderRadius: '3px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.12)',
  });

  function nodePill(def, node) {
    var pill = document.createElement('div');
    Object.assign(pill.style, {
      flex: '1', padding: '5px 8px', borderRadius: '2px', textAlign: 'center',
      background: def ? def.color : 'rgba(255,255,255,0.05)',
      border: '1px solid ' + (def ? def.borderColor : 'rgba(255,255,255,0.2)'),
      fontSize: '8px', fontWeight: '700', letterSpacing: '1.5px',
      textTransform: 'uppercase', color: def ? def.textColor : '#aabbcc',
    });
    pill.textContent = (node && node.label) || (def && def.label) || '—';
    return pill;
  }
  var arr = document.createElement('div');
  Object.assign(arr.style, { color: '#4a6070', fontSize: '14px', flexShrink: '0' });
  arr.textContent = '→';

  badge.appendChild(nodePill(fromDef, fromNode));
  badge.appendChild(arr);
  badge.appendChild(nodePill(toDef, toNode));
  wrap.appendChild(badge);

  // ── Cycle count ──────────────────────────────────────────────────────────
  var cycleSection = buildInputSection('Cycle Count', []);
  wrap.appendChild(cycleSection);

  var cycleDesc = document.createElement('div');
  Object.assign(cycleDesc.style, {
    fontSize: '9px', color: '#7a9aaa', lineHeight: '1.6', marginBottom: '12px',
  });
  cycleDesc.textContent = 'Repeat the destination node N times before continuing. Mass from each pass feeds the next.';
  cycleSection.appendChild(cycleDesc);

  var btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '6px', marginBottom: '10px' });

  [1, 2, 3, 4, 5, 6].forEach(function(n) {
    var btn = document.createElement('button');
    var isActive = (conn.cycle || 1) === n;
    Object.assign(btn.style, {
      flex: '1', padding: '7px 0', borderRadius: '2px', cursor: 'pointer',
      fontSize: '10px', fontWeight: '700', letterSpacing: '1px',
      border: '1px solid ' + (isActive ? ACCENT : 'rgba(255,255,255,0.18)'),
      background: isActive ? ACCENT_DIM + '0.15)' : 'transparent',
      color: isActive ? ACCENT : '#7a9aaa',
      transition: 'all 0.15s ease',
    });
    btn.textContent = n + 'x';
    btn.addEventListener('click', function() {
      conn.cycle = n;
      refreshConnections();
      refreshRightPanel(); refreshCalcPanel();
      refreshLeftPanel();   // re-render buttons with new active state
    });
    btnRow.appendChild(btn);
  });
  cycleSection.appendChild(btnRow);

  // Preview of what the cycle means
  var preview = document.createElement('div');
  Object.assign(preview.style, {
    padding: '10px 12px', borderRadius: '3px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.10)',
    fontSize: '9px', color: '#7a9aaa', lineHeight: '1.8',
  });
  var toLabel = (toNode && (toNode.label || (toDef && toDef.label))) || 'node';
  var cyc = conn.cycle || 1;
  if (cyc === 1) {
    preview.textContent = 'No repetition — passes through ' + toLabel + ' once.';
  } else {
    var seq = [];
    for (var i = 0; i < cyc; i++) seq.push(toLabel + ' [pass ' + (i + 1) + ']');
    preview.textContent = seq.join('  →  ');
  }
  cycleSection.appendChild(preview);

  // ── Delete connection ────────────────────────────────────────────────────
  var delBtn = document.createElement('button');
  Object.assign(delBtn.style, {
    marginTop: 'auto', padding: '9px', borderRadius: '2px', cursor: 'pointer',
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
    color: '#ef9999', fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
    transition: 'all 0.2s ease',
  });
  delBtn.textContent = 'Delete Connection';
  delBtn.addEventListener('mouseenter', function() { delBtn.style.background = 'rgba(239,68,68,0.18)'; });
  delBtn.addEventListener('mouseleave', function() { delBtn.style.background = 'rgba(239,68,68,0.08)'; });
  delBtn.addEventListener('click', function() { deleteConn(conn.id); });
  wrap.appendChild(delBtn);

  return wrap;
}

// ---------------------------------------------------------------------------
// Canvas Panel
// ---------------------------------------------------------------------------

function buildCanvasPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-canvas-panel';
  Object.assign(panel.style, {
    flex: '1', position: 'relative', overflow: 'hidden',
    background: '#070d14',
    cursor: 'default',
  });

  // Dot-grid rendered on the panel itself (doesn't move with pan)
  // We'll update backgroundPosition to track the pan for a nice parallax effect
  panel.style.backgroundImage = 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)';
  panel.style.backgroundSize = '28px 28px';

  // World layer — everything inside this gets panned + zoomed
  var wl = document.createElement('div');
  wl.id = 'mr-world';
  Object.assign(wl.style, {
    position: 'absolute', top: '0', left: '0',
    width: '0', height: '0',   // zero-size, contents overflow
    transformOrigin: '0 0',
    willChange: 'transform',
  });
  panel.appendChild(wl);
  worldLayer = wl;

  // SVG layer inside world
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'mr-svg';
  Object.assign(svg.style, {
    position: 'absolute', top: '0', left: '0',
    width: '8000px', height: '8000px',
    pointerEvents: 'none', overflow: 'visible',
  });
  svg.innerHTML = '<defs><marker id="mr-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.25)"/></marker></defs>';
  wl.appendChild(svg);
  svgLayer = svg;

  // Nodes layer inside world
  var nl = document.createElement('div');
  nl.id = 'mr-nodes';
  Object.assign(nl.style, { position: 'absolute', top: '0', left: '0' });
  wl.appendChild(nl);
  nodesLayer = nl;

  panel.addEventListener('contextmenu', onCanvasContextMenu);
  panel.addEventListener('mousedown',   onCanvasMouseDown);
  panel.addEventListener('wheel',       onCanvasWheel, { passive: false });

  canvasArea = panel;
  return panel;
}

function applyWorldTransform() {
  if (!worldLayer) return;
  worldLayer.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + zoom + ')';
  if (canvasArea) {
    canvasArea.style.backgroundPosition = (panX % 28) + 'px ' + (panY % 28) + 'px';
  }
  updateZoomIndicator();
}

function updateZoomIndicator() {
  var el = document.getElementById('mr-zoom-indicator');
  if (el) el.textContent = Math.round(zoom * 100) + '%';
}

// ---------------------------------------------------------------------------
// Right Panel
// ---------------------------------------------------------------------------

function buildRightPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-right';
  Object.assign(panel.style, {
    width: '300px', minWidth: '260px', maxWidth: '360px', flexShrink: '0',
    display: 'flex', flexDirection: 'column',
    borderLeft: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(4,8,14,0.5)',
  });

  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.20)',
    fontSize: '9px', letterSpacing: '2.5px', textTransform: 'uppercase', color: ACCENT, flexShrink: '0',
  });
  hdr.textContent = 'Estimates';
  panel.appendChild(hdr);

  var content = document.createElement('div');
  content.id = 'mr-right-content';
  Object.assign(content.style, { flex: '1', overflowY: 'auto', padding: '14px' });
  panel.appendChild(content);

  showRightPlaceholder();
  return panel;
}

function showRightPlaceholder() {
  var content = document.getElementById('mr-right-content');
  if (!content) return;
  content.innerHTML = '';
  var ph = document.createElement('div');
  Object.assign(ph.style, { color: '#607888', fontSize: '10px', textAlign: 'center', marginTop: '40px', lineHeight: '1.8' });
  ph.textContent = 'Connect a Stock In node to begin';
  content.appendChild(ph);
}

// ---------------------------------------------------------------------------
// General Calculations Panel (full-width strip below the three panels)
// ---------------------------------------------------------------------------

// ===========================================================================
// GENERAL CALCULATIONS PANEL
// ===========================================================================
//
// Layout: full-width panel, vertical scroll.
// Each step is a full-width block.
// Each calculation within a step has:
//   - Title + one-line description of what/why
//   - Symbolic formula
//   - Same formula with numbers substituted in
//   - Answer (highlighted)

function buildCalcPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-calc-panel';
  Object.assign(panel.style, {
    height: '280px', minHeight: '220px',
    flexShrink: '0',
    display: 'flex', flexDirection: 'column',
    borderTop: '2px solid rgba(255,255,255,0.22)',
    background: 'rgba(3,6,10,0.92)',
    position: 'relative', zIndex: '2',
  });

  // Header
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    display: 'flex', alignItems: 'center', gap: '16px',
    padding: '0 28px', height: '38px', minHeight: '38px',
    borderBottom: '1px solid rgba(255,255,255,0.18)',
    flexShrink: '0',
  });
  var htitle = document.createElement('div');
  Object.assign(htitle.style, { fontSize: '9px', letterSpacing: '2.5px', textTransform: 'uppercase', color: ACCENT });
  htitle.textContent = 'Summary Calculations';
  hdr.appendChild(htitle);
  var hsep = document.createElement('div');
  Object.assign(hsep.style, { flex: '1', height: '1px', background: 'rgba(255,255,255,0.14)' });
  hdr.appendChild(hsep);
  var hnote = document.createElement('div');
  Object.assign(hnote.style, { fontSize: '9px', letterSpacing: '1px', color: '#607888' });
  hnote.textContent = 'Full step-by-step workings  ·  scroll ↕ for all steps';
  hdr.appendChild(hnote);
  panel.appendChild(hdr);

  // Scrollable body
  var content = document.createElement('div');
  content.id = 'mr-calc-content';
  Object.assign(content.style, {
    flex: '1', overflowY: 'auto', overflowX: 'hidden',
    padding: '0',
  });
  var ph = document.createElement('div');
  Object.assign(ph.style, { color: '#607888', fontSize: '10px', textAlign: 'center', padding: '32px' });
  ph.textContent = 'Connect a Stock In node to begin';
  content.appendChild(ph);
  panel.appendChild(content);
  return panel;
}

function refreshCalcPanel() {
  var content = document.getElementById('mr-calc-content');
  if (!content) return;
  content.innerHTML = '';

  var chain = computeChain();
  if (chain.length === 0) {
    var ph = document.createElement('div');
    Object.assign(ph.style, { color: '#607888', fontSize: '10px', textAlign: 'center', padding: '32px' });
    ph.textContent = 'Connect a Stock In node to begin';
    content.appendChild(ph);
    return;
  }

  chain.forEach(function(step, idx) {
    var def = NODE_DEFS[step.nodeType] || {};
    var isSelected = step.nodeId === selectedId;
    var workings = buildStepWorkings(step);

    // ── Step block ──────────────────────────────────────────────────────────
    var block = document.createElement('div');
    Object.assign(block.style, {
      borderBottom: '1px solid rgba(255,255,255,0.16)',
      background: isSelected ? 'rgba(255,255,255,0.055)' : 'transparent',
      transition: 'background 0.2s ease',
      cursor: 'pointer',
    });
    block.addEventListener('click', function() { selectNode(step.nodeId); });

    // Step header bar (full-width, color-coded to node type)
    var stepHdr = document.createElement('div');
    Object.assign(stepHdr.style, {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '8px 28px',
      background: isSelected
        ? (def.color ? def.color : 'rgba(255,255,255,0.04)')
        : 'rgba(255,255,255,0.03)',
      borderLeft: '3px solid ' + (def.borderColor || '#445566'),
    });

    // Step number
    var numEl = document.createElement('div');
    Object.assign(numEl.style, {
      fontSize: '9px', fontWeight: '700', color: def.textColor || '#667788',
      minWidth: '24px',
    });
    numEl.textContent = 'STEP ' + (idx + 1);

    // Step name
    var nameEl = document.createElement('div');
    Object.assign(nameEl.style, {
      fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px',
      textTransform: 'uppercase', color: def.textColor || '#aabbcc',
      flex: '1',
    });
    nameEl.textContent = step.label;

    // Cycle badge
    if (step.isCycle) {
      var cycleBadge = document.createElement('div');
      Object.assign(cycleBadge.style, {
        fontSize: '8px', fontWeight: '700', letterSpacing: '1px',
        padding: '2px 6px', borderRadius: '2px',
        background: ACCENT_DIM + '0.15)', border: '1px solid ' + ACCENT_DIM + '0.4)',
        color: ACCENT, flexShrink: '0',
      });
      cycleBadge.textContent = 'CYCLE';
      stepHdr.appendChild(nameEl);
      stepHdr.appendChild(cycleBadge);
    } else {
      stepHdr.appendChild(nameEl);
    }
    var flowTag = document.createElement('div');
    Object.assign(flowTag.style, {
      fontSize: '9px', color: '#8899aa', display: 'flex', alignItems: 'center', gap: '8px',
    });
    var massInEl = document.createElement('span');
    massInEl.textContent = step.nodeType === 'stock_in' ? '— kg in' : step.massIn + ' kg in';
    var arrEl = document.createElement('span');
    Object.assign(arrEl.style, { color: '#607888' });
    arrEl.textContent = '→';
    var massOutEl = document.createElement('span');
    Object.assign(massOutEl.style, { color: step.massLoss > 0 ? '#e9c46a' : '#80d090', fontWeight: '700' });
    massOutEl.textContent = step.massOut + ' kg out';
    flowTag.appendChild(massInEl); flowTag.appendChild(arrEl); flowTag.appendChild(massOutEl);

    // Loss badge
    if (step.massLoss > 0) {
      var lossBadge = document.createElement('div');
      Object.assign(lossBadge.style, {
        fontSize: '8px', letterSpacing: '1px', padding: '2px 8px',
        background: step.lossPct > 10 ? 'rgba(239,68,68,0.12)' : 'rgba(233,196,106,0.10)',
        border: '1px solid ' + (step.lossPct > 10 ? 'rgba(239,68,68,0.3)' : 'rgba(233,196,106,0.25)'),
        color: step.lossPct > 10 ? '#ef8888' : '#e9c46a',
        borderRadius: '2px',
      });
      lossBadge.textContent = '−' + step.lossPct + '% loss';
      flowTag.appendChild(lossBadge);
    }

    stepHdr.appendChild(numEl);
    // nameEl already appended inside the isCycle branch above
    if (!step.isCycle) {
      // Non-cycle: nameEl was appended in the else branch, flowTag comes after
    }
    stepHdr.appendChild(flowTag);
    block.appendChild(stepHdr);

    // Workings grid (full-width row of calc cells)
    var grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
      padding: '10px 28px 14px',
      gap: '10px',
      borderLeft: '3px solid rgba(255,255,255,0.10)',
      background: 'rgba(0,0,0,0.15)',
    });

    workings.forEach(function(w, wi) {
      var cell = document.createElement('div');
      Object.assign(cell.style, {
        minWidth: '200px', flex: '1',
        padding: '10px 14px',
        marginRight: wi < workings.length - 1 ? '10px' : '0',
        display: 'flex', flexDirection: 'column', gap: '3px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '4px',
        border: '1px solid rgba(255,255,255,0.10)',
      });

      // Title
      var wTitle = document.createElement('div');
      Object.assign(wTitle.style, {
        fontSize: '8px', fontWeight: '700', letterSpacing: '1.5px',
        textTransform: 'uppercase', color: '#aabbcc',
        marginBottom: '2px',
      });
      wTitle.textContent = (idx + 1) + '.' + (wi + 1) + '  ' + w.title;

      // Description
      var wDesc = document.createElement('div');
      Object.assign(wDesc.style, {
        fontSize: '9px', color: '#7a9aaa', lineHeight: '1.4',
        marginBottom: '6px',
      });
      wDesc.textContent = w.desc;

      // Symbolic formula
      var wSym = document.createElement('div');
      Object.assign(wSym.style, {
        fontSize: '10px', color: '#8aa0b0',
        fontFamily: "'Consolas','SF Mono',monospace",
        letterSpacing: '0.3px', lineHeight: '1.5',
      });
      wSym.textContent = w.symbolic;

      // Substituted formula (numbers)
      var wSub = document.createElement('div');
      Object.assign(wSub.style, {
        fontSize: '10px', color: '#a0b8c8',
        fontFamily: "'Consolas','SF Mono',monospace",
        letterSpacing: '0.3px', lineHeight: '1.5',
      });
      wSub.textContent = w.substituted;

      // Divider line
      var divLine = document.createElement('div');
      Object.assign(divLine.style, {
        height: '1px', background: 'rgba(255,255,255,0.18)',
        margin: '5px 0',
      });

      // Answer
      var wAns = document.createElement('div');
      Object.assign(wAns.style, {
        fontSize: '13px', fontWeight: '700', color: '#ddeeff',
        fontFamily: "'Consolas','SF Mono',monospace",
        letterSpacing: '0.5px',
      });
      wAns.textContent = '= ' + w.answer;

      cell.appendChild(wTitle);
      cell.appendChild(wDesc);
      cell.appendChild(wSym);
      cell.appendChild(wSub);
      cell.appendChild(divLine);
      cell.appendChild(wAns);
      grid.appendChild(cell);
    });

    block.appendChild(grid);
    content.appendChild(block);
  });
}

// ---------------------------------------------------------------------------
// buildStepWorkings — returns array of:
//   { title, desc, symbolic, substituted, answer }
// ---------------------------------------------------------------------------

function buildStepWorkings(step) {
  var p   = (nodes.find(function(n) { return n.id === step.nodeId; }) || {}).params || {};
  var out = [];

  function w(title, desc, symbolic, substituted, answer) {
    out.push({ title: title, desc: desc, symbolic: symbolic, substituted: substituted, answer: answer });
  }

  switch (step.nodeType) {

    case 'stock_in': {
      var D   = p.diameter || 0;
      var L   = p.length   || 0;
      var qty = p.quantity  || 1;
      var dens = p.density || general.density;
      var r   = D / 2;
      var A   = round3(Math.PI * r * r);
      var vol_mm3 = round3(Math.PI * r * r * L);
      var vol_cm3 = round3(vol_mm3 / 1e6);
      var mBar    = round3(vol_cm3 * dens);
      var mTotal  = round3(mBar * qty);

      w('Procurement',
        'Purchase order, heat/lot traceability, and supplier identification.',
        '—',
        'PO: ' + (p.poNumber||'—') + '  ·  Heat: ' + (p.heatNumber||'—') + '  ·  Supplier: ' + (p.supplier||'—'),
        (p.certNumber ? 'Cert: ' + p.certNumber : 'No cert recorded'));

      w('Material Grade & Condition',
        'Alloy grade and incoming metallurgical condition — determines forgeability, die life, and required preheat.',
        '—',
        (p.material||'—') + '  ·  ' + (p.condition||'').replace(/_/g,' '),
        'ρ = ' + dDensity(dens));

      w('Prior Processing',
        'How the stock was originally made and any heat treatment already applied. Affects grain structure and residual stress.',
        '—',
        (p.mfgMethod||'').replace(/_/g,' ') + '  ·  Prior HT: ' + (p.priorHT||'').replace(/_/g,' ') +
          (p.grainSize ? '  ·  Grain: ASTM ' + p.grainSize : '') +
          '  ·  Grain dir: ' + (p.grainDir||'').replace(/_/g,' '),
        (p.mfgMethod||'—').replace(/_/g,' '));

      w('Stock Form',
        'Geometry of the incoming stock piece.',
        '—',
        (p.geometry||'—').replace(/_/g,' ') + '  ·  ' + dLen(D) + ' Ø × ' + dLen(L) +
          (p.wallThickness > 0 ? '  ·  wall ' + dLen(p.wallThickness) : ''),
        (p.geometry||'—').replace(/_/g,' '));

      w('Cross-section Area',
        'Area of the circular cross-section — basis for volume calculation.',
        'A = π × (D / 2)²',
        'A = π × (' + dLen(D) + ' / 2)²  =  π × ' + dLen(r) + '²',
        A + ' ' + dLenUnit() + '²');

      w('Volume per Piece',
        'Cross-section area × length gives total piece volume.',
        'V = A × L',
        'V = ' + A + ' × ' + dLen(L),
        dVol(vol_mm3));

      w('Mass per Piece',
        'Volume converted to mass using the material density (' + dDensity(dens) + ').',
        'M = V_cm³ × ρ  ÷  1000',
        'M = ' + vol_cm3 + ' cm³ × ' + dens + '  ÷  1000',
        dMass(mBar));

      w('Total Incoming Mass',
        'Total mass entering the process for this order.',
        'M_total = M_piece × qty',
        'M_total = ' + dMass(mBar) + ' × ' + qty,
        dMass(mTotal));
      break;
    }

    case 'cut': {
      var dIn    = step.dimsIn.diameter || 150;
      var barLen = step.dimsIn.length   || 3000;
      var crop   = p.cropLossMm  || 0;
      var kerf   = p.kerfMm      || 0;
      var tLen   = p.targetLength|| 0;
      var usable = barLen - crop;
      var blanks = Math.max(0, Math.floor(usable / (tLen + kerf)));
      var bVol   = round3(Math.PI * Math.pow(dIn / 2, 2) * tLen);
      var bMass  = round3(bVol / 1e6 * general.density);
      var mOut   = round3(bMass * blanks);
      var mLoss  = round3(Math.max(0, step.massIn - mOut));

      w('Cutting Method',
        'The method and tooling used to separate blanks from bar stock. Method affects kerf width, surface condition, and heat-affected zone.',
        '—',
        (p.method||'saw').replace(/_/g,' ') + '  ·  ' + (p.bladeType||'').replace(/_/g,' ') + '  ·  coolant: ' + (p.coolant||'flood'),
        (p.surfaceReq||'as_cut').replace(/_/g,' '));

      w('Usable Bar Length',
        'Subtract crop loss (discarded bar ends with poor grain structure / inclusion-rich zones) from total bar length.',
        'L_use = L_bar − L_crop',
        'L_use = ' + dLen(barLen) + ' − ' + dLen(crop),
        dLen(usable));

      w('Blanks per Bar',
        'How many blanks fit in the usable length. Each cut consumes kerf — material converted to swarf by the blade.',
        'n = ⌊ L_use ÷ (L_blank + kerf) ⌋',
        'n = ⌊ ' + dLen(usable) + ' ÷ (' + dLen(tLen) + ' + ' + dLen(kerf) + ') ⌋',
        blanks + ' blanks');

      w('Blank Volume',
        'Volume of one cylindrical blank — same diameter as the incoming bar, target blank length.',
        'V = π × (D ÷ 2)² × L_blank',
        'V = π × (' + dLen(dIn) + ' ÷ 2)² × ' + dLen(tLen),
        dVol(bVol));

      w('Mass per Blank',
        'Convert blank volume to mass using material density.',
        'M_blank = V_mm³ ÷ 1 000 000 × ρ',
        'M_blank = ' + fmtVol(bVol) + ' ÷ 1 000 000 × ' + general.density,
        dMass(bMass));

      w('Total Blank Mass Out',
        'Total usable mass leaving this step (n blanks × mass each).',
        'M_out = M_blank × n',
        'M_out = ' + dMass(bMass) + ' × ' + blanks,
        dMass(mOut));

      w('Cut Loss',
        'Material lost to saw kerf, crop ends, and bar remnant. Kerf loss = (n_cuts × kerf × A). Remnant = usable mod (L_blank + kerf).',
        'M_loss = M_in − M_out',
        'M_loss = ' + dMass(step.massIn) + ' − ' + dMass(mOut),
        dMass(mLoss));
      break;
    }

    case 'heat': {
      var sLossPct = p.scaleLossPct || 0;
      var sLoss    = round3(step.massIn * sLossPct / 100);
      var mOut2    = round3(step.massIn - sLoss);

      w('Furnace Setup',
        'Furnace type and atmosphere determine scale formation rate. Controlled atmospheres (N₂, endothermic, vacuum) dramatically reduce scale loss vs. open-air heating.',
        '—',
        (p.furnaceType||'gas_fired').replace(/_/g,' ') + '  ·  atmosphere: ' + (p.atmosphere||'air') + '  ·  load: ' + (p.loadMethod||'batch').replace(/_/g,' '),
        p.furnaceId ? 'Furnace: ' + p.furnaceId : (p.furnaceType||'gas_fired').replace(/_/g,' '));

      w('Scale (Oxidation) Loss',
        'At forge temperature, iron oxidises rapidly forming iron-oxide scale (Fe₂O₃, Fe₃O₄). Scale flakes off during forging. Air atmosphere: 1.5–3%. Controlled atmosphere: 0.2–0.5%. Salt bath: near 0%.',
        'M_scale = M_in × (scale% ÷ 100)',
        'M_scale = ' + dMass(step.massIn) + ' × (' + sLossPct + ' ÷ 100)',
        dMass(sLoss));

      w('Mass After Heating',
        'Mass entering the forge press after scale loss. This is the effective starting mass for flash and forge ratio calculations.',
        'M_out = M_in − M_scale',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(sLoss),
        dMass(mOut2));

      w('Forging Temperature Window',
        'Forge within this range. Below T_min: material is too stiff, risk of cracking, excessive press loads. Above T_target: grain growth, possible burning or liquation in high-alloy steels.',
        'T_min  ≤  T_forge  ≤  T_target',
        dTemp(p.minTemp||0) + '  ≤  T_forge  ≤  ' + dTemp(p.targetTemp||0),
        'Target: ' + dTemp(p.targetTemp||0));

      w('Soak Time',
        'Soak ensures thermal equilibration through the cross-section. Rule of thumb: 1 min per mm of minimum section thickness. Insufficient soak → cold core → internal cracking.',
        'Hold at T_target for t_soak',
        'Hold at ' + dTemp(p.targetTemp||0) + ' for ' + (p.soakMin||0) + ' min',
        (p.soakMin||0) + ' min');
      break;
    }

    case 'forge': {
      var h0_  = step.dimsIn.length || step.dimsIn.height || 0;
      var h1_  = p.outHeight || 0;
      var fPct = p.flashPct  || 0;
      var fLoss= round3(step.massIn * fPct / 100);
      var mOut3= round3(step.massIn - fLoss);
      var eps  = (h0_ > 0 && h1_ > 0) ? round3(Math.log(h0_ / h1_)) : null;
      var pctR = (h0_ > 0 && h1_ > 0) ? round3((h0_ - h1_) / h0_ * 100) : null;
      var R    = p.forgeRatio || 0;

      w('Equipment & Process',
        'Press type determines strain rate and deformation mode. Hydraulic presses: slow, controlled, good for complex shapes. Hammers: high strain rate, good grain refinement. Ring mills: continuous deformation for rings/donuts.',
        '—',
        (p.process||'').replace(/_/g,' ') + '  ·  ' + (p.equipment||'').replace(/_/g,' ') + '  ·  ' + (p.pressTonnage||'—') + ' ton  ·  ' + (p.numHits||1) + ' hit' + ((p.numHits||1)>1?'s':''),
        (p.dieNumber ? 'Die: ' + p.dieNumber : (p.process||'').replace(/_/g,' ')));

      w('Die Setup',
        'Die preheat prevents thermal shock cracking and improves metal flow. Cold dies chill the workpiece surface, increasing flow stress and die load. Lubricant reduces friction and die wear.',
        '—',
        'Die preheat: ' + dTemp(p.dieTemp||200) + '  ·  Lubricant: ' + (p.lubricant||'graphite').replace(/_/g,' '),
        dTemp(p.dieTemp||200));

      w('Flash Loss',
        'Flash is intentional excess metal squeezed out at the die parting line. It ensures complete cavity fill. Flash % is of the billet entering the die — typically 10–20% for closed-die forgings.',
        'M_flash = M_in × (flash% ÷ 100)',
        'M_flash = ' + dMass(step.massIn) + ' × (' + fPct + ' ÷ 100)',
        dMass(fLoss));

      w('Mass Out of Forge',
        'Forged part mass including flash still attached. Flash is removed at the Trim step.',
        'M_out = M_in − M_flash',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(fLoss),
        dMass(mOut3));

      w('Forge Ratio',
        'Forge ratio = cross-sectional area reduction. R ≥ 3:1 breaks up cast microstructure and closes porosity. R ≥ 5:1 achieves full grain refinement in most alloy steels. Values below 3:1 may leave inadequate grain structure for critical applications.',
        'R = A_in ÷ A_out',
        'R (target) = ' + R,
        R + ' : 1' + (R >= 5 ? '  ✓ excellent' : R >= 3 ? '  ✓ acceptable' : '  ⚠ below 3:1 minimum'));

      w('True (Logarithmic) Strain',
        'True strain ε = ln(h₀/h₁). Logarithmic strain is additive across deformation steps and accurately represents large plastic strains. Engineering strain would underestimate at high reductions.',
        'ε = ln( h₀ ÷ h₁ )',
        eps !== null
          ? 'ε = ln( ' + dLen(h0_) + ' ÷ ' + dLen(h1_) + ' )  =  ln( ' + round3(h0_/h1_) + ' )'
          : 'ε = ln( h₀ ÷ h₁ )  — set input/output heights',
        eps !== null ? 'ε = ' + eps : '—');

      w('% Height Reduction',
        'Engineering height reduction — useful for quick reference and press tonnage estimation. Not additive across passes (use true strain for that).',
        '%R = (h₀ − h₁) ÷ h₀ × 100',
        pctR !== null
          ? '%R = (' + dLen(h0_) + ' − ' + dLen(h1_) + ') ÷ ' + dLen(h0_) + ' × 100'
          : '%R — set input/output heights',
        pctR !== null ? pctR + '%' : '—');
      break;
    }

    case 'trim': {
      var tFPct = p.flashPct || 0;
      var tLoss = round3(step.massIn * tFPct / 100);
      var tOut  = round3(step.massIn - tLoss);

      w('Trim Condition',
        'Hot trimming (immediately after forge) requires less force and preserves die life. Cold trimming gives cleaner cut and better dimensional control but requires higher forces and can introduce residual stress.',
        '—',
        (p.trimCondition||'hot') + ' trim  ·  ' + (p.dieType||'conventional').replace(/_/g,' ') + ' die' + (p.dieNumber ? '  ·  ' + p.dieNumber : ''),
        (p.trimCondition||'hot') + ' trim');

      w('Flash Removed',
        'Flash mass = flash% of forged part mass. This is the mass that was intentionally pushed out at the parting line during forging.',
        'M_trim = M_in × (flash% ÷ 100)',
        'M_trim = ' + dMass(step.massIn) + ' × (' + tFPct + ' ÷ 100)',
        dMass(tLoss));

      w('Flash Disposition',
        'Trimmed flash disposition. Reforging is most efficient (reuses material). Remelt recovers alloy value. Scrap recycling loses value added in heating and forging.',
        '—',
        (p.flashDisposition||'scrap_recycle').replace(/_/g,' '),
        (p.flashDisposition||'scrap_recycle').replace(/_/g,' '));

      w('Mass After Trimming',
        'Net forging mass. This is the shape that proceeds to heat treatment or machining.',
        'M_out = M_in − M_trim',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(tLoss),
        dMass(tOut));
      break;
    }

    case 'heat_treat': {
      var htHardStr = (p.targetHardnessMin > 0 || p.targetHardnessMax > 0)
        ? p.targetHardnessMin + '–' + p.targetHardnessMax + ' ' + (p.hardnessScale||'HRC')
        : 'not specified';

      w('Process & Specification',
        'Heat treatment process selected based on required mechanical properties. Spec number provides audit traceability to customer or industry requirements.',
        '—',
        (p.process||'normalize').replace(/_/g,' ') + (p.specNumber ? '  ·  ' + p.specNumber : ''),
        (p.process||'normalize').replace(/_/g,' '));

      w('Furnace & Atmosphere',
        'Atmosphere controls decarburization and scale. Vacuum/controlled atmosphere prevents surface degradation — important for bearing steels, aerospace alloys, and tight-tolerance parts.',
        '—',
        (p.furnaceType||'electric_resistance').replace(/_/g,' ') + '  ·  ' + (p.atmosphere||'air'),
        (p.atmosphere||'air'));

      w('Austenitize / Heat',
        'Steel must be fully austenitized (above Ac3) before quenching to form martensite. Insufficient temperature → incomplete transformation → soft spots. Soak time ensures uniform carbon distribution.',
        'T_heat  >  Ac3,  soak for t',
        'T_heat = ' + dTemp(p.austenitizeTemp||0) + '  ·  soak = ' + (p.soakMin||60) + ' min',
        dTemp(p.austenitizeTemp||0));

      w('Quench',
        'Cooling rate must exceed critical cooling rate to form martensite. Water = fastest (risk of cracking). Oil = moderate. Air = slow (normalize). Press quench prevents distortion in thin-flanged parts.',
        '—',
        (p.quenchant||'air') + '  ·  agitation: ' + (p.quenchAgitation||'still'),
        (p.quenchant||'air'));

      if ((p.temperTemp||0) > 0) {
        w('Temper',
          'As-quenched martensite is extremely hard but brittle. Tempering reduces hardness and increases toughness by allowing carbon redistribution. Higher temper temp = lower hardness, higher toughness.',
          'T_temper  <  Ac1',
          'T_temper = ' + dTemp(p.temperTemp) + '  ·  soak = ' + (p.temperSoakMin||0) + ' min',
          dTemp(p.temperTemp));
      }

      w('Target Properties',
        'Hardness range is the primary acceptance criterion after heat treatment. Hardness correlates to tensile strength: for alloy steels, UTS ≈ HRC × 36 MPa (approx).',
        '—',
        'Target hardness: ' + htHardStr + (p.caseDepth > 0 ? '  ·  case depth: ' + dLen(p.caseDepth) : ''),
        htHardStr);

      w('Mass Balance',
        'Heat treatment does not remove material (assuming controlled atmosphere or salt bath). Scale loss in open-air heat treat is typically < 0.1% and considered negligible at this stage.',
        'M_out = M_in',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    case 'machine': {
      var dI  = step.dimsIn.diameter || step.dimsIn.outDiameter || 100;
      var hI  = step.dimsIn.height   || step.dimsIn.outHeight   || 150;
      var dO  = p.outDiameter || dI;
      var hO  = p.outHeight   || hI;
      var vI  = round3(Math.PI * Math.pow(dI/2, 2) * hI);
      var vO  = round3(Math.PI * Math.pow(dO/2, 2) * hO);
      var dV  = round3(Math.max(0, vI - vO));
      var cM  = round3(dV / 1e6 * general.density);
      var mO  = round3(Math.max(0, step.massIn - cM));

      w('Operation & Equipment',
        'Machine type and operation determine achievable tolerances and surface finish. CNC multi-axis enables complex geometries in fewer setups. More setups introduce datum shift errors.',
        '—',
        (p.operation||'turn') + '  ·  ' + (p.machineType||'cnc_lathe').replace(/_/g,' ') + '  ·  ' + (p.numSetups||1) + ' setup' + ((p.numSetups||1)>1?'s':'') + '  ·  coolant: ' + (p.coolant||'flood'),
        (p.programNumber ? 'Pgm: ' + p.programNumber : (p.operation||'turn')));

      w('Input Volume',
        'Volume of the forging as received at machining — intentionally oversized by the machining stock allowance.',
        'V_in = π × (D_in ÷ 2)² × H_in',
        'V_in = π × (' + dLen(dI) + ' ÷ 2)² × ' + dLen(hI),
        dVol(vI));

      w('Final Machined Volume',
        'Target volume of the finished part after all machining operations.',
        'V_out = π × (D_out ÷ 2)² × H_out',
        'V_out = π × (' + dLen(dO) + ' ÷ 2)² × ' + dLen(hO),
        dVol(vO));

      w('Volume Removed',
        'Chips/swarf. This planned material removal is why forgings are deliberately oversized — the stock allowance ensures enough material exists to hit final dimensions.',
        'ΔV = V_in − V_out',
        'ΔV = ' + dVol(vI) + ' − ' + dVol(vO),
        dVol(dV));

      w('Chip Mass',
        'Mass of removed material. Chips are recycled but this mass represents heating energy, forging energy, and alloy value already spent.',
        'M_chips = ΔV ÷ 1 000 000 × ρ',
        'M_chips = ' + fmtVol(dV) + ' ÷ 1 000 000 × ' + general.density,
        dMass(cM));

      w('Quality Requirements',
        'Surface finish Ra and IT tolerance class define the precision required. Ra 63 μin = fine turned. Ra 32 μin = ground. IT6 = precision, IT7 = standard CNC, IT9 = rough machined.',
        '—',
        'Surface: Ra ' + (p.surfaceFinish||'125') + ' μin  ·  Tolerance: ' + (p.toleranceClass||'IT7'),
        'Ra ' + (p.surfaceFinish||'125') + '  ' + (p.toleranceClass||'IT7'));

      w('Final Part Mass',
        'Mass of the finished machined part.',
        'M_out = M_in − M_chips',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(cM),
        dMass(mO));
      break;
    }

    case 'inspect': {
      w('Inspection Method & Standard',
        'Inspection method is determined by the characteristic being verified and the applicable specification. NDT methods detect internal or surface flaws not visible dimensionally.',
        '—',
        (p.method||'dimensional').replace(/_/g,' ') + '  ·  standard: ' + (p.standard||'customer_dwg').replace(/_/g,' ') + (p.specNumber ? '  (' + p.specNumber + ')' : ''),
        (p.method||'dimensional').replace(/_/g,' '));

      w('Sampling Plan',
        '100% inspection catches all defects but is costly. AQL (Acceptable Quality Limit) sampling accepts a defined defect rate. First article establishes conformance before production run. Skip-lot used for mature, high-confidence processes.',
        '—',
        (p.samplingPlan||'100_percent').replace(/_/g,' ') + (p.samplingPlan === 'AQL' ? '  ·  AQL ' + (p.aqlLevel||'1.0') : ''),
        (p.samplingPlan||'100_percent').replace(/_/g,' '));

      var checks2 = [];
      if (p.checkDimensional === 'yes') checks2.push('dimensional');
      if (p.checkHardness    === 'yes') checks2.push('hardness');
      if (p.checkNdt         === 'yes') checks2.push((p.ndtMethod||'NDT').replace(/_/g,' '));
      w('Required Checks',
        'Checks required at this inspection gate. All must pass for part to proceed.',
        '—',
        checks2.length > 0 ? checks2.join('  ·  ') : 'per method above',
        checks2.length > 0 ? checks2.join(', ') : 'per method');

      w('Disposition / Result',
        'Current inspection result. Pass → proceeds to next step. Hold → awaits engineering review. Conditional pass → accepted with documented deviation. Scrap → removed from process.',
        '—',
        (p.result||'pending').replace(/_/g,' '),
        (p.result||'pending').replace(/_/g,' '));

      w('Mass Balance',
        'Inspection is non-destructive for conforming parts — mass passes through unchanged. Scrapped parts remove their mass from the process flow.',
        'M_out = M_in  (if pass)',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    case 'stock_out': {
      w('Part Identification',
        'Final part number, revision, and work order link this output to the originating order and engineering drawing.',
        '—',
        (p.partNumber||'—') + (p.partRevision ? '  Rev ' + p.partRevision : '') + (p.workOrderNumber ? '  ·  WO: ' + p.workOrderNumber : ''),
        (p.partNumber||'unspecified'));

      w('Destination & Shipping',
        'Where the finished parts go. Internal transfer keeps parts in-house. Subcontractor sends for outside processing. Customer is final delivery.',
        '—',
        (p.destination||'customer').replace(/_/g,' ') + (p.customerName ? '  ·  ' + p.customerName : '') + '  ·  ' + (p.shippingMethod||'ground').replace(/_/g,' '),
        (p.destination||'customer').replace(/_/g,' '));

      w('Packaging & Preservation',
        'Packaging protects parts from mechanical damage and corrosion in transit and storage. VCI paper and rust preventive oil are standard for carbon and alloy steel. Desiccant required for humid environments.',
        '—',
        (p.packagingType||'standard_crate').replace(/_/g,' ') + '  ·  ' + (p.cleaningReq||'clean_and_oil').replace(/_/g,' ') + '  ·  preservative: ' + (p.preservative||'none').replace(/_/g,' '),
        (p.packagingType||'standard_crate').replace(/_/g,' '));

      w('Certification',
        'Certification documents link the shipped parts to material test reports, first article inspection, or conformance statements. Required for aerospace, defense, and safety-critical applications.',
        '—',
        p.certRequired === 'yes' ? (p.certType||'C_of_C').replace(/_/g,' ') + ' required' : 'no certification required',
        p.certRequired === 'yes' ? (p.certType||'C_of_C').replace(/_/g,' ') : 'none');

      w('Final Mass Out',
        'Total mass shipped. Represents the recoverable output of the entire process chain.',
        'M_shipped = M_in  (pass-through)',
        'M_shipped = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    default: {
      w('Mass Flow',
        'This node type is a pass-through — mass is unchanged.',
        'M_out = M_in',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }
  }

  return out;
}

function refreshRightPanel() {
  var content = document.getElementById('mr-right-content');
  if (!content) return;
  content.innerHTML = '';

  var chain = computeChain();
  if (chain.length === 0) { showRightPlaceholder(); return; }

  var first    = chain[0];
  var last     = chain[chain.length - 1];
  var massIn   = first.massOut;
  var massOut  = last.massOut;
  var yieldPct = massIn > 0 ? round3(massOut / massIn * 100) : 0;
  var totalLoss= round3(massIn - massOut);

  // Summary cards
  var grid = document.createElement('div');
  Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' });
  [
    { label: 'Mass In',    value: dMass(massIn),    hi: false },
    { label: 'Mass Out',   value: dMass(massOut),   hi: true  },
    { label: 'Yield',      value: yieldPct + '%',   hi: yieldPct >= 75 },
    { label: 'Total Loss', value: dMass(totalLoss), hi: false },
  ].forEach(function(c) {
    var card = document.createElement('div');
    Object.assign(card.style, {
      padding: '10px 12px', borderRadius: '3px',
      background: c.hi ? ACCENT_DIM + '0.08)' : 'rgba(255,255,255,0.04)',
      border: '2px solid ' + (c.hi ? ACCENT_DIM + '0.35)' : 'rgba(255,255,255,0.22)'),
    });
    var l = document.createElement('div');
    Object.assign(l.style, { fontSize: '8px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#99b0c0', marginBottom: '5px' });
    l.textContent = c.label;
    var v = document.createElement('div');
    Object.assign(v.style, { fontSize: '15px', fontWeight: '300', color: c.hi ? ACCENT : '#c0ccd8' });
    v.textContent = c.value;
    card.appendChild(l); card.appendChild(v);
    grid.appendChild(card);
  });
  content.appendChild(grid);

  // Section label
  var sl = document.createElement('div');
  Object.assign(sl.style, {
    fontSize: '8px', letterSpacing: '2.5px', textTransform: 'uppercase', color: ACCENT,
    marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid ' + ACCENT_DIM + '0.25)',
  });
  sl.textContent = 'Step Detail';
  content.appendChild(sl);

  chain.forEach(function(step) {
    var isSelected = step.nodeId === selectedId;
    var def = NODE_DEFS[step.nodeType] || {};

    var card = document.createElement('div');
    Object.assign(card.style, {
      marginBottom: '8px', padding: '10px 12px', borderRadius: '3px',
      background: isSelected ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.03)',
      border: '2px solid ' + (isSelected ? (def.borderColor || '#445566') : 'rgba(255,255,255,0.20)'),
      cursor: 'pointer', transition: 'border-color 0.2s ease',
    });

    var sHdr = document.createElement('div');
    Object.assign(sHdr.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' });
    var dot = document.createElement('div');
    Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%', flexShrink: '0', background: def.borderColor || '#556677' });
    var slbl = document.createElement('div');
    Object.assign(slbl.style, { fontSize: '9px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#aabbcc', flex: '1' });
    slbl.textContent = step.label;
    var mtag = document.createElement('div');
    Object.assign(mtag.style, { fontSize: '10px', color: '#99b0c0' });
    mtag.textContent = dMass(step.massOut);
    sHdr.appendChild(dot); sHdr.appendChild(slbl); sHdr.appendChild(mtag);
    card.appendChild(sHdr);

    // Loss bar
    if (step.massLoss > 0) {
      var lossRow = document.createElement('div');
      Object.assign(lossRow.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' });
      var barEl = document.createElement('div');
      Object.assign(barEl.style, { flex: '1', height: '3px', background: 'rgba(255,255,255,0.16)', borderRadius: '2px', overflow: 'hidden' });
      var fill = document.createElement('div');
      Object.assign(fill.style, { width: Math.min(step.lossPct, 100) + '%', height: '100%', background: step.lossPct > 10 ? '#ef4444' : '#e9c46a', borderRadius: '2px' });
      barEl.appendChild(fill);
      var lossLbl = document.createElement('div');
      Object.assign(lossLbl.style, { fontSize: '9px', color: '#99b0c0', whiteSpace: 'nowrap' });
      lossLbl.textContent = '−' + step.massLoss + ' kg (' + step.lossPct + '%)';
      lossRow.appendChild(barEl); lossRow.appendChild(lossLbl);
      card.appendChild(lossRow);
    }

    step.calcs.forEach(function(calc) {
      var row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px', gap: '8px' });
      var k = document.createElement('span'); Object.assign(k.style, { color: '#8899aa', flexShrink: '0' }); k.textContent = calc.label;
      var v = document.createElement('span'); Object.assign(v.style, { color: '#99aabb', textAlign: 'right' }); v.textContent = calc.result;
      row.appendChild(k); row.appendChild(v);
      card.appendChild(row);
    });

    card.addEventListener('click', function() { selectNode(step.nodeId); });
    content.appendChild(card);
  });
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
      textTransform: 'uppercase', color: unitSystem === value ? ACCENT : '#7a9aaa',
      transition: 'color 0.15s ease', userSelect: 'none',
    });
    wrap.id = 'mr-unit-label-' + value;

    var cb = document.createElement('input');
    cb.type = 'radio';
    cb.name = 'mr-unit-system';
    cb.value = value;
    cb.checked = unitSystem === value;
    Object.assign(cb.style, {
      accentColor: ACCENT, cursor: 'pointer', width: '11px', height: '11px',
    });
    cb.addEventListener('change', function() {
      if (cb.checked) {
        unitSystem = value;
        ['si', 'imperial'].forEach(function(v) {
          var lbl = document.getElementById('mr-unit-label-' + v);
          if (lbl) lbl.style.color = unitSystem === v ? ACCENT : '#7a9aaa';
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


// ===========================================================================
// NODE RENDERING
// ===========================================================================

function createNode(type, x, y) {
  var def = NODE_DEFS[type];
  if (!def) return null;
  var node = { id: 'n' + (_nid++), type: type, label: def.label, x: x, y: y, params: Object.assign({}, def.defaultParams) };
  nodes.push(node);
  renderNodeEl(node);
  refreshRightPanel(); refreshCalcPanel();
  return node;
}

function renderNodeEl(node) {
  var def = NODE_DEFS[node.type];

  var el = document.createElement('div');
  el.id = 'node-' + node.id;
  el.className = 'mr-node';
  Object.assign(el.style, {
    position: 'absolute', left: node.x + 'px', top: node.y + 'px',
    width: NODE_W + 'px', background: def.color,
    border: '2px solid ' + def.borderColor, borderRadius: '4px',
    userSelect: 'none', transition: 'box-shadow 0.2s ease', cursor: 'grab',
  });

  // Header
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    padding: '7px 10px', borderBottom: '1px solid rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  var hdot = document.createElement('div');
  Object.assign(hdot.style, { width: '6px', height: '6px', borderRadius: '50%', background: def.textColor, opacity: '0.7', flexShrink: '0' });
  var hlbl = document.createElement('div');
  hlbl.id = 'node-lbl-' + node.id;
  Object.assign(hlbl.style, {
    fontSize: '9px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: def.textColor, flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  hlbl.textContent = node.label || def.label;
  hdr.appendChild(hdot); hdr.appendChild(hlbl);
  el.appendChild(hdr);

  // Body — first 2 non-section params as preview
  var body = document.createElement('div');
  Object.assign(body.style, { padding: '5px 10px' });
  // Smart preview key selection per node type
  var allReal = def.paramDefs.filter(function(pd) { return pd.section === undefined; });
  var previewKeys = null;
  if (node.type === 'stock_in')   previewKeys = ['material', 'geometry'];
  if (node.type === 'cut')        previewKeys = ['method', 'targetLength'];
  if (node.type === 'heat')       previewKeys = ['targetTemp', 'furnaceType'];
  if (node.type === 'forge')      previewKeys = ['process', 'equipment'];
  if (node.type === 'trim')       previewKeys = ['trimCondition', 'flashPct'];
  if (node.type === 'heat_treat') previewKeys = ['process', 'austenitizeTemp'];
  if (node.type === 'machine')    previewKeys = ['operation', 'machineType'];
  if (node.type === 'inspect')    previewKeys = ['method', 'result'];
  if (node.type === 'stock_out')  previewKeys = ['destination', 'partNumber'];
  var previews = previewKeys
    ? previewKeys.map(function(k) { return allReal.find(function(pd) { return pd.key === k; }); }).filter(Boolean)
    : allReal.slice(0, 2);
  if (previews.length === 0) {
    var emp = document.createElement('div');
    Object.assign(emp.style, { fontSize: '9px', color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '5px 0' });
    emp.textContent = '—';
    body.appendChild(emp);
  } else {
    previews.forEach(function(pd) {
      var row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px' });
      var k = document.createElement('span');
      Object.assign(k.style, { color: 'rgba(255,255,255,0.28)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' });
      k.textContent = pd.label.split('(')[0].trim();
      var v = document.createElement('span');
      v.id = 'node-p-' + node.id + '-' + pd.key;
      Object.assign(v.style, { color: def.textColor, opacity: '0.85' });
      v.textContent = node.params[pd.key] !== undefined
        ? (function() {
            var raw = node.params[pd.key];
            if (!pd.unitType) return raw;
            var disp = toDisplay(raw, pd.unitType);
            if (pd.unitType === 'length')  return disp + (unitSystem === 'imperial' ? '"' : '');
            if (pd.unitType === 'temp')    return disp + (unitSystem === 'imperial' ? '°F' : '°C');
            if (pd.unitType === 'density') return disp + (unitSystem === 'imperial' ? ' lb/in³' : ' g/cm³');
            return disp;
          }())
        : '—';
      row.appendChild(k); row.appendChild(v);
      body.appendChild(row);
    });
  }
  el.appendChild(body);

  // Ports
  if (def.hasInput) {
    var inp = makePortEl('input', node.id);
    Object.assign(inp.style, { position: 'absolute', left: (-PORT_R) + 'px', top: (NODE_H / 2 - PORT_R) + 'px' });
    el.appendChild(inp);
  }
  if (def.hasOutput) {
    var outp = makePortEl('output', node.id);
    Object.assign(outp.style, { position: 'absolute', right: (-PORT_R) + 'px', top: (NODE_H / 2 - PORT_R) + 'px' });
    el.appendChild(outp);
  }

  el.addEventListener('mousedown', function(e) { onNodeMouseDown(e, node.id); });
  el.addEventListener('contextmenu', function(e) { onNodeContextMenu(e, node.id); });
  el.addEventListener('click', function(e) { if (!e.target.classList.contains('mr-port')) selectNode(node.id); });

  nodesLayer.appendChild(el);
}

function makePortEl(portType, nodeId) {
  var el = document.createElement('div');
  el.className = 'mr-port mr-port-' + portType;
  el.dataset.portType = portType;
  el.dataset.nodeId   = nodeId;
  Object.assign(el.style, {
    width: (PORT_R * 2) + 'px', height: (PORT_R * 2) + 'px', borderRadius: '50%',
    background: portType === 'output' ? ACCENT : '#2a3a55',
    border: '2px solid rgba(255,255,255,0.35)',
    cursor: 'crosshair', zIndex: '10',
    transition: 'transform 0.15s ease, background 0.15s ease',
  });
  el.addEventListener('mouseenter', function() { el.style.transform = 'scale(1.5)'; el.style.background = portType === 'output' ? '#ff8060' : '#4466aa'; });
  el.addEventListener('mouseleave', function() { el.style.transform = 'scale(1)';   el.style.background = portType === 'output' ? ACCENT : '#2a3a55'; });
  el.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    if (portType === 'output') {
      var pos = getCanvasPos(e);
      dragState = { type: 'connect', fromId: nodeId, mouseX: pos.x, mouseY: pos.y };
    }
  });
  return el;
}

function refreshNodeEl(nodeId) {
  var node = nodes.find(function(n) { return n.id === nodeId; });
  if (!node) return;
  var def = NODE_DEFS[node.type];
  var lbl = document.getElementById('node-lbl-' + nodeId);
  if (lbl) lbl.textContent = node.label || def.label;
  var allReal = def.paramDefs.filter(function(pd) { return pd.section === undefined; });
  var previewKeys = null;
  if (node.type === 'stock_in')   previewKeys = ['material', 'geometry'];
  if (node.type === 'cut')        previewKeys = ['method', 'targetLength'];
  if (node.type === 'heat')       previewKeys = ['targetTemp', 'furnaceType'];
  if (node.type === 'forge')      previewKeys = ['process', 'equipment'];
  if (node.type === 'trim')       previewKeys = ['trimCondition', 'flashPct'];
  if (node.type === 'heat_treat') previewKeys = ['process', 'austenitizeTemp'];
  if (node.type === 'machine')    previewKeys = ['operation', 'machineType'];
  if (node.type === 'inspect')    previewKeys = ['method', 'result'];
  if (node.type === 'stock_out')  previewKeys = ['destination', 'partNumber'];
  var previews = previewKeys
    ? previewKeys.map(function(k) { return allReal.find(function(pd) { return pd.key === k; }); }).filter(Boolean)
    : allReal.slice(0, 2);
  previews.forEach(function(pd) {
    var el = document.getElementById('node-p-' + nodeId + '-' + pd.key);
    if (!el) return;
    var raw = node.params[pd.key];
    if (raw === undefined) { el.textContent = '—'; return; }
    if (!pd.unitType) { el.textContent = String(raw).replace(/_/g, ' '); return; }
    var disp = toDisplay(raw, pd.unitType);
    if (pd.unitType === 'length')  el.textContent = disp + (unitSystem === 'imperial' ? '"' : '');
    else if (pd.unitType === 'temp') el.textContent = disp + (unitSystem === 'imperial' ? '°F' : '°C');
    else if (pd.unitType === 'density') el.textContent = disp + (unitSystem === 'imperial' ? ' lb/in³' : ' g/cm³');
    else el.textContent = disp;
  });
}

function removeNodeEl(nodeId) {
  var el = document.getElementById('node-' + nodeId);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function setNodeSelected(nodeId, selected) {
  var el = document.getElementById('node-' + nodeId);
  if (!el) return;
  var node = nodes.find(function(n) { return n.id === nodeId; });
  var def  = node ? (NODE_DEFS[node.type] || {}) : {};
  el.style.boxShadow = selected ? '0 0 0 2px ' + (def.borderColor || ACCENT) + ', 0 4px 24px rgba(0,0,0,0.7)' : 'none';
}

function selectNode(nodeId) {
  if (selectedId) setNodeSelected(selectedId, false);
  selectedId = nodeId;
  if (nodeId) {
    setNodeSelected(nodeId, true);
    leftMode = 'node_detail';
    // Clear connection selection
    if (selectedConnId) { selectedConnId = null; refreshConnections(); }
  }
  refreshLeftPanel();
  refreshRightPanel(); refreshCalcPanel();
}

function deleteNode(nodeId) {
  connections = connections.filter(function(c) { return c.fromId !== nodeId && c.toId !== nodeId; });
  nodes = nodes.filter(function(n) { return n.id !== nodeId; });
  removeNodeEl(nodeId);
  if (selectedId === nodeId) selectNode(null);
  refreshConnections();
  refreshRightPanel(); refreshCalcPanel();
}


// ===========================================================================
// SVG CONNECTIONS
// ===========================================================================

function getPortPos(node, portType) {
  if (portType === 'output') return { x: node.x + NODE_W + PORT_R, y: node.y + NODE_H / 2 };
  return { x: node.x - PORT_R, y: node.y + NODE_H / 2 };
}

// ---------------------------------------------------------------------------
// Orthogonal router — produces a rounded-elbow SVG path that avoids nodes.
//
// Strategy:
//   Stub: always leave/arrive horizontally (stub = 36px out from port).
//   Forward (target is to the right): go to midX, vertical bridge, continue.
//   Backward (target is to left or same X): loop — go right past source,
//     drop below all nodes involved, go left, rise to target Y.
// ---------------------------------------------------------------------------

var CONN_R = 8;
var STUB   = 28;

function routedPath(x1, y1, x2, y2, srcNode, tgtNode) {

  var srcRight  = srcNode ? srcNode.x + NODE_W  : x1;
  var srcBottom = srcNode ? srcNode.y + NODE_H   : y1 + NODE_H / 2;
  var srcTop    = srcNode ? srcNode.y             : y1 - NODE_H / 2;

  var tgtLeft   = tgtNode ? tgtNode.x             : x2;
  var tgtRight  = tgtNode ? tgtNode.x + NODE_W   : x2 + NODE_W;
  var tgtBottom = tgtNode ? tgtNode.y + NODE_H   : y2 + NODE_H / 2;
  var tgtTop    = tgtNode ? tgtNode.y             : y2 - NODE_H / 2;

  // ── CASE 1: Forward (target node starts right of source node) ────────────
  if (tgtLeft > srcRight + 1) {
    var cx = (x1 + x2) / 2;
    return 'M ' + r3(x1) + ' ' + r3(y1) +
           ' C ' + r3(cx) + ' ' + r3(y1) +
           ' ' + r3(cx) + ' ' + r3(y2) +
           ' ' + r3(x2) + ' ' + r3(y2);
  }

  // ── CASE 2: Backward / overlapping — check for vertical gap between nodes
  var nodesOverlapV = srcBottom > tgtTop + 2 && srcTop < tgtBottom - 2;

  if (!nodesOverlapV) {
    // Clear vertical corridor — route through the gap between the nodes.
    // Path: exit right → vertical to gap midpoint → LEFT to target approach → vertical to target port → enter.
    var gapY = srcBottom <= tgtTop
      ? (srcBottom + tgtTop) / 2      // source above target
      : (tgtBottom + srcTop) / 2;     // source below target

    var turnX    = srcRight + STUB;           // right of source, stub out
    var approachX = tgtNode ? tgtNode.x - STUB : x2 - STUB;  // LEFT of target node, arriving rightward

    // approachX must be left of x2 (the input port) so the final segment goes rightward into it
    approachX = Math.min(approachX, x2 - 4);

    return roundedOrtho([
      { x: x1,         y: y1   },
      { x: turnX,      y: y1   },
      { x: turnX,      y: gapY },
      { x: approachX,  y: gapY },
      { x: approachX,  y: y2   },
      { x: x2,         y: y2   },
    ], CONN_R);
  }

  // ── CASE 3: Nodes overlap vertically — must loop around the right side ───
  var loopX = Math.max(srcRight, tgtRight) + 48;
  var loopY = Math.max(srcBottom, tgtBottom) + 44;
  return roundedOrtho([
    { x: x1,        y: y1     },
    { x: loopX,     y: y1     },
    { x: loopX,     y: loopY  },
    { x: x2 - STUB, y: loopY  },
    { x: x2 - STUB, y: y2     },
    { x: x2,        y: y2     },
  ], CONN_R);
}

function roundedOrtho(pts, r) {
  if (pts.length < 2) return '';
  var d = 'M ' + r3(pts[0].x) + ' ' + r3(pts[0].y);
  for (var i = 1; i < pts.length - 1; i++) {
    var prev = pts[i - 1], curr = pts[i], next = pts[i + 1];
    var dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    var len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    var dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    var len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    var rr = Math.min(r, len1 / 2, len2 / 2);
    var bx = curr.x - (dx1 / len1) * rr;
    var by = curr.y - (dy1 / len1) * rr;
    var ax = curr.x + (dx2 / len2) * rr;
    var ay = curr.y + (dy2 / len2) * rr;
    d += ' L ' + r3(bx) + ' ' + r3(by);
    d += ' Q ' + r3(curr.x) + ' ' + r3(curr.y) + ' ' + r3(ax) + ' ' + r3(ay);
  }
  d += ' L ' + r3(pts[pts.length - 1].x) + ' ' + r3(pts[pts.length - 1].y);
  return d;
}

function r3(v) { return Math.round(v * 10) / 10; }

// ---------------------------------------------------------------------------
// Connection rendering
// Each connection renders as two SVG paths:
//   1. A wide transparent hit-area path (for click detection)
//   2. The visible styled path
// ---------------------------------------------------------------------------

function refreshConnections() {
  svgLayer.querySelectorAll('.mr-conn, .mr-conn-hit').forEach(function(el) {
    el.parentNode.removeChild(el);
  });

  connections.forEach(function(conn) {
    var fn = nodes.find(function(n) { return n.id === conn.fromId; });
    var tn = nodes.find(function(n) { return n.id === conn.toId;   });
    if (!fn || !tn) return;

    var p1  = getPortPos(fn, 'output');
    var p2  = getPortPos(tn, 'input');
    var def = NODE_DEFS[fn.type] || {};
    var d   = routedPath(p1.x, p1.y, p2.x, p2.y, fn, tn);
    var isSelected = conn.id === selectedConnId;

    // Visible path
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'mr-conn');
    path.setAttribute('data-conn-id', conn.id);
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', isSelected ? ACCENT : (def.borderColor || '#607888'));
    path.setAttribute('stroke-width', isSelected ? '2.5' : '1.8');
    path.setAttribute('stroke-opacity', isSelected ? '1' : '0.7');
    path.setAttribute('marker-end', 'url(#mr-arrow)');
    path.style.pointerEvents = 'none';
    if (isSelected) {
      path.setAttribute('stroke-dasharray', 'none');
      path.setAttribute('filter', 'drop-shadow(0 0 4px ' + ACCENT + ')');
    }
    svgLayer.appendChild(path);

    // Cycle badge — show Nx label at midpoint of path if cycle > 1
    var cycles = conn.cycle || 1;
    if (cycles > 1) {
      var midX = (p1.x + p2.x) / 2;
      var midY = (p1.y + p2.y) / 2;
      var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('class', 'mr-conn');
      bgRect.setAttribute('x', r3(midX - 14)); bgRect.setAttribute('y', r3(midY - 9));
      bgRect.setAttribute('width', '28'); bgRect.setAttribute('height', '16');
      bgRect.setAttribute('rx', '3');
      bgRect.setAttribute('fill', isSelected ? ACCENT : '#1a2a3a');
      bgRect.setAttribute('stroke', isSelected ? ACCENT : (def.borderColor || '#607888'));
      bgRect.setAttribute('stroke-width', '1');
      bgRect.style.pointerEvents = 'none';
      svgLayer.appendChild(bgRect);
      var badgeTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      badgeTxt.setAttribute('class', 'mr-conn');
      badgeTxt.setAttribute('x', r3(midX)); badgeTxt.setAttribute('y', r3(midY + 4));
      badgeTxt.setAttribute('text-anchor', 'middle');
      badgeTxt.setAttribute('font-size', '9');
      badgeTxt.setAttribute('font-weight', '700');
      badgeTxt.setAttribute('letter-spacing', '0.5');
      badgeTxt.setAttribute('fill', isSelected ? '#fff' : '#c0d8e8');
      badgeTxt.setAttribute('font-family', 'Consolas, monospace');
      badgeTxt.style.pointerEvents = 'none';
      badgeTxt.textContent = cycles + 'x';
      svgLayer.appendChild(badgeTxt);
    }

    // Hit-area path (wider, transparent, clickable)
    var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('class', 'mr-conn-hit');
    hit.setAttribute('data-conn-id', conn.id);
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.style.pointerEvents = 'stroke';
    hit.style.cursor = 'pointer';

    hit.addEventListener('click', function(e) {
      e.stopPropagation();
      selectConn(conn.id);
    });
    hit.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      selectConn(conn.id);
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Delete Connection', danger: true, action: function() { deleteConn(conn.id); } },
      ]);
    });
    hit.addEventListener('mouseenter', function() {
      if (conn.id !== selectedConnId) {
        path.setAttribute('stroke-opacity', '1');
        path.setAttribute('stroke-width', '2.2');
      }
    });
    hit.addEventListener('mouseleave', function() {
      if (conn.id !== selectedConnId) {
        path.setAttribute('stroke-opacity', '0.7');
        path.setAttribute('stroke-width', '1.8');
      }
    });

    svgLayer.appendChild(hit);
  });
}

// ---------------------------------------------------------------------------
// Live connection preview while dragging
// ---------------------------------------------------------------------------

function updateLiveConnection(x2, y2) {
  var live = document.getElementById('mr-live-conn');
  if (!live) {
    live = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    live.id = 'mr-live-conn';
    live.setAttribute('fill', 'none');
    live.setAttribute('stroke', ACCENT);
    live.setAttribute('stroke-width', '2');
    live.setAttribute('stroke-dasharray', '7 4');
    live.setAttribute('stroke-opacity', '0.9');
    live.style.pointerEvents = 'none';
    svgLayer.appendChild(live);
  }
  var fn = nodes.find(function(n) { return n.id === dragState.fromId; });
  if (!fn) return;
  var p1 = getPortPos(fn, 'output');
  live.setAttribute('d', routedPath(p1.x, p1.y, x2, y2, fn, null));
}

function removeLiveConnection() {
  var live = document.getElementById('mr-live-conn');
  if (live && live.parentNode) live.parentNode.removeChild(live);
}

// ---------------------------------------------------------------------------
// Connection add / select / delete
// ---------------------------------------------------------------------------

function addConnection(fromId, toId) {
  if (fromId === toId) return;
  if (connections.find(function(c) { return c.fromId === fromId && c.toId === toId; })) return;
  connections.push({ id: 'c' + (_cid++), fromId: fromId, toId: toId, cycle: 1 });
  refreshConnections();
  refreshRightPanel(); refreshCalcPanel();
}

function selectConn(connId) {
  if (selectedId) { setNodeSelected(selectedId, false); selectedId = null; }
  selectedConnId = connId;
  leftMode = 'path';
  refreshConnections();
  refreshLeftPanel();
}

function deleteConn(connId) {
  connections = connections.filter(function(c) { return c.id !== connId; });
  if (selectedConnId === connId) selectedConnId = null;
  refreshConnections();
  refreshRightPanel(); refreshCalcPanel();
}


// ===========================================================================
// CONTEXT MENU
// ===========================================================================

function showContextMenu(x, y, items) {
  dismissContextMenu();
  var menu = document.createElement('div');
  menu.id = 'mr-ctx-menu';
  Object.assign(menu.style, {
    position: 'fixed', left: x + 'px', top: y + 'px',
    background: '#0d1520', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '4px', zIndex: '99999', minWidth: '200px', padding: '4px 0',
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    fontFamily: "'Consolas','SF Mono',monospace",
  });

  items.forEach(function(item) {
    if (item.separator) {
      var sep = document.createElement('div');
      Object.assign(sep.style, { height: '1px', background: 'rgba(255,255,255,0.18)', margin: '4px 0' });
      menu.appendChild(sep); return;
    }
    if (item.header) {
      var hdr = document.createElement('div');
      Object.assign(hdr.style, { padding: '5px 16px 3px', fontSize: '8px', letterSpacing: '2px', textTransform: 'uppercase', color: '#6a8090' });
      hdr.textContent = item.header;
      menu.appendChild(hdr); return;
    }
    var row = document.createElement('div');
    Object.assign(row.style, {
      padding: '7px 16px', fontSize: '10px', letterSpacing: '0.5px',
      cursor: item.action ? 'pointer' : 'default',
      color: item.danger ? '#ef7777' : '#aabbcc',
      display: 'flex', alignItems: 'center', gap: '10px',
      transition: 'background 0.1s ease',
    });
    if (item.color) {
      var dot = document.createElement('div');
      Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%', background: item.color, flexShrink: '0' });
      row.appendChild(dot);
    }
    var lbl = document.createElement('span'); lbl.textContent = item.label; row.appendChild(lbl);
    if (item.action) {
      row.addEventListener('mouseenter', function() { row.style.background = item.danger ? 'rgba(239,119,119,0.08)' : 'rgba(255,255,255,0.14)'; });
      row.addEventListener('mouseleave', function() { row.style.background = 'none'; });
      row.addEventListener('mousedown', function(e) { e.stopPropagation(); dismissContextMenu(); item.action(); });
    }
    menu.appendChild(row);
  });

  document.body.appendChild(menu);
  ctxMenu = menu;
  setTimeout(function() { document.addEventListener('mousedown', dismissContextMenu, { once: true }); }, 0);
}

function dismissContextMenu() {
  if (ctxMenu && ctxMenu.parentNode) { ctxMenu.parentNode.removeChild(ctxMenu); ctxMenu = null; }
}

function onCanvasContextMenu(e) {
  e.preventDefault();
  var pos = getCanvasPos(e);
  var cx = pos.x - NODE_W / 2;
  var cy = pos.y - NODE_H / 2;

  var items = [{ header: 'Add Node' }];
  Object.keys(NODE_DEFS).forEach(function(type) {
    var def = NODE_DEFS[type];
    items.push({
      label: def.label, color: def.borderColor,
      action: (function(t, x, y) { return function() { createNode(t, x, y); }; })(type, cx, cy),
    });
  });
  showContextMenu(e.clientX, e.clientY, items);
}

function onNodeContextMenu(e, nodeId) {
  e.preventDefault(); e.stopPropagation();
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Delete Node', danger: true,  action: function() { deleteNode(nodeId); } },
    { separator: true },
    { label: 'Duplicate',   danger: false, action: function() {
      var orig = nodes.find(function(n) { return n.id === nodeId; });
      if (!orig) return;
      var newNode = createNode(orig.type, orig.x + 24, orig.y + 24);
      newNode.params = JSON.parse(JSON.stringify(orig.params));
      refreshNodeEl(newNode.id);
    }},
  ]);
}


// ===========================================================================
// INTERACTION HANDLERS
// ===========================================================================

function getCanvasPos(e) {
  var rect = canvasArea.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - panX) / zoom,
    y: (e.clientY - rect.top  - panY) / zoom,
  };
}

function findPortAtPoint(x, y) {
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var def  = NODE_DEFS[node.type];
    var px, py, dist;
    if (def.hasInput) {
      px = node.x - PORT_R; py = node.y + NODE_H / 2;
      dist = Math.sqrt(Math.pow(x - px, 2) + Math.pow(y - py, 2));
      if (dist < PORT_HIT) return { nodeId: node.id, portType: 'input' };
    }
    if (def.hasOutput) {
      px = node.x + NODE_W + PORT_R; py = node.y + NODE_H / 2;
      dist = Math.sqrt(Math.pow(x - px, 2) + Math.pow(y - py, 2));
      if (dist < PORT_HIT) return { nodeId: node.id, portType: 'output' };
    }
  }
  return null;
}

function onCanvasMouseDown(e) {
  var onBackground = e.target === canvasArea || e.target === nodesLayer || e.target.id === 'mr-svg' || e.target.id === 'mr-world';
  if (onBackground) {
    dismissContextMenu();
    selectNode(null);
    // Clear connection selection
    if (selectedConnId) { selectedConnId = null; refreshConnections(); }
    // Left button: start panning
    if (e.button === 0 || e.button === 1) {
      dragState = {
        type: 'pan',
        startClientX: e.clientX, startClientY: e.clientY,
        origPanX: panX, origPanY: panY,
      };
      canvasArea.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }
}

function onNodeMouseDown(e, nodeId) {
  if (e.target.classList.contains('mr-port')) return;
  e.stopPropagation();
  var node = nodes.find(function(n) { return n.id === nodeId; });
  if (!node) return;
  var pos = getCanvasPos(e);
  dragState = { type: 'node', nodeId: nodeId, startX: pos.x, startY: pos.y, origX: node.x, origY: node.y };
}

function onMouseMove(e) {
  if (!dragState || !canvasArea) return;

  if (dragState.type === 'pan') {
    panX = dragState.origPanX + (e.clientX - dragState.startClientX);
    panY = dragState.origPanY + (e.clientY - dragState.startClientY);
    applyWorldTransform();

  } else if (dragState.type === 'node') {
    var pos = getCanvasPos(e);
    var node = nodes.find(function(n) { return n.id === dragState.nodeId; });
    if (!node) return;
    node.x = Math.max(0, dragState.origX + (pos.x - dragState.startX));
    node.y = Math.max(0, dragState.origY + (pos.y - dragState.startY));
    var el = document.getElementById('node-' + node.id);
    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
    refreshConnections();

  } else if (dragState.type === 'connect') {
    var pos2 = getCanvasPos(e);
    updateLiveConnection(pos2.x, pos2.y);
  }
}

function onMouseUp(e) {
  if (!dragState) return;

  if (dragState.type === 'pan') {
    canvasArea.style.cursor = 'default';

  } else if (dragState.type === 'connect' && canvasArea) {
    var pos = getCanvasPos(e);
    var hit = findPortAtPoint(pos.x, pos.y);
    if (hit && hit.portType === 'input' && hit.nodeId !== dragState.fromId) {
      addConnection(dragState.fromId, hit.nodeId);
    }
    removeLiveConnection();
  }

  dragState = null;
}

function onKeyDown(e) {
  if (!visible) return;
  if ((e.code === 'Delete' || e.code === 'Backspace') && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    if (selectedId)     deleteNode(selectedId);
    if (selectedConnId) deleteConn(selectedConnId);
  }
  if (e.code === 'Escape') { dismissContextMenu(); selectNode(null); selectedConnId = null; refreshConnections(); }
}


function onCanvasWheel(e) {
  e.preventDefault();
  var rect   = canvasArea.getBoundingClientRect();
  var mouseX = e.clientX - rect.left;
  var mouseY = e.clientY - rect.top;

  var delta   = e.deltaY > 0 ? 0.9 : 1.1;
  var newZoom = Math.min(Math.max(zoom * delta, 0.2), 3);

  // Zoom toward the mouse cursor position
  panX = mouseX - (mouseX - panX) * (newZoom / zoom);
  panY = mouseY - (mouseY - panY) * (newZoom / zoom);
  zoom = newZoom;

  applyWorldTransform();
}

function resetView() {
  panX = 0; panY = 0; zoom = 1;
  applyWorldTransform();
}

var SAVE_VERSION = '3.0';

function saveConfig() {
  // Deep-copy nodes so we store clean plain objects (no DOM refs)
  var nodeSnapshot = nodes.map(function(n) {
    return { id: n.id, type: n.type, label: n.label, x: n.x, y: n.y,
             params: JSON.parse(JSON.stringify(n.params || {})) };
  });

  var payload = {
    _version:     SAVE_VERSION,
    _type:        'forgeworks-mfg-review',
    _savedAt:     new Date().toISOString(),
    _unitSystem:  unitSystem,
    _nid:         _nid,
    _cid:         _cid,
    general:      JSON.parse(JSON.stringify(general)),
    nodes:        nodeSnapshot,
    connections:  JSON.parse(JSON.stringify(connections)),
  };

  var json = JSON.stringify(payload, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');

  // Use job number + part number in filename if available
  var nameParts = ['mfg-review'];
  if (general.jobNumber)  nameParts.push(general.jobNumber.replace(/[^a-zA-Z0-9\-_]/g, '-'));
  if (general.partNumber) nameParts.push(general.partNumber.replace(/[^a-zA-Z0-9\-_]/g, '-'));
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
        Object.keys(general).forEach(function(k) {
          if (p.general && p.general[k] !== undefined) general[k] = p.general[k];
        });
        // Also pick up any keys in the saved file that we might not have defaulted
        if (p.general) Object.assign(general, p.general);

        // ── Counters ──────────────────────────────────────────────────────
        _nid = p._nid || 0;
        _cid = p._cid || 0;

        // ── Unit system ───────────────────────────────────────────────────
        if (p._unitSystem === 'si' || p._unitSystem === 'imperial') {
          unitSystem = p._unitSystem;
          setDisplaySystem(unitSystem);
          // Sync radio buttons if they exist
          ['si','imperial'].forEach(function(v) {
            var lbl = document.getElementById('mr-unit-label-' + v);
            if (lbl) lbl.style.color = unitSystem === v ? ACCENT : '#7a9aaa';
            var rb = document.querySelector('input[name="mr-unit-system"][value="' + v + '"]');
            if (rb) rb.checked = unitSystem === v;
          });
        }

        // ── Nodes — migrate params to fill in any new fields ──────────────
        nodes.forEach(function(n) { removeNodeEl(n.id); });
        nodes = [];
        connections = [];

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
          nodes.push(node);
          renderNodeEl(node);
        });

        // ── Connections ───────────────────────────────────────────────────
        // Validate that both endpoints still exist
        var validNodeIds = nodes.map(function(n) { return n.id; });
        connections = (p.connections || []).filter(function(c) {
          var ok = validNodeIds.indexOf(c.fromId) > -1 && validNodeIds.indexOf(c.toId) > -1;
          if (!ok) warnings.push('Connection ' + c.id + ' references missing node — removed.');
          return ok;
        });

        // ── Refresh everything ────────────────────────────────────────────
        refreshConnections();
        refreshLeftPanel();
        refreshRightPanel();
        refreshCalcPanel();
        panX = 0; panY = 0; zoom = 1;
        applyWorldTransform();

        // ── Feedback ─────────────────────────────────────────────────────
        var msg = 'Loaded: ' + file.name +
          '\n' + nodes.length + ' nodes · ' + connections.length + ' connections' +
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
  var unitLabel = unitSystem === 'imperial' ? 'Imperial (in / lb / °F)' : 'Metric (mm / kg / °C)';
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
            mRow('Job Number',  general.jobNumber  || '—')+
            mRow('Part Number', general.partNumber || '—')+
            mRow('Part Name',   general.partName   || '—')+
            mRow('Revision',    general.revision   || '—')+
            mRow('Customer',    general.customer   || '—')+
            mRow('Work Order',  general.workOrder  || '—')+
          '</table>'+
        '</div>'+
        '<div>'+
          '<div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:'+C_faint+';margin-bottom:10px;border-bottom:1px solid '+C_border+';padding-bottom:6px">Document Information</div>'+
          '<table style="border-collapse:collapse;width:100%">'+
            mRow('Engineer',      general.engineer     || '—')+
            mRow('Date Created',  general.dateCreated  || '—')+
            mRow('Status',       (general.status||'—').replace(/_/g,' '))+
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

      (general.notes?'<div style="padding:16px;border:1px solid '+C_border+';border-radius:4px;background:#fafafa">'+
        '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:'+C_faint+';margin-bottom:6px">Notes</div>'+
        '<div style="font-size:11px;color:'+C_ink+';line-height:1.6">'+esc(general.notes)+'</div></div>':'')+
    '</div>'+
    '<div style="border-top:1px solid '+C_border+';padding-top:12px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1px;color:'+C_faint+';text-transform:uppercase">'+
      '<span>Forgeworks · Manufacturing Review</span><span>CONFIDENTIAL — FOR INTERNAL USE</span><span>Page 1</span>'+
    '</div></div>';

  // ── ONE PAGE PER STEP ────────────────────────────────────────────────────
  var stepsHTML = chain.map(function(step, idx) {
    var node = nodes.find(function(n){ return n.id===step.nodeId; })||{};
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
        var displayVal = pd.unitType
          ? toDisplay(raw,pd.unitType)+unitSuffix(pd.unitType)
          : pd.type==='select' ? String(raw).replace(/_/g,' ') : raw;
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
        '<span>Job: '+esc(general.jobNumber||'—')+'</span>'+
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
    '<title>Forgeworks MFG Review \u2014 '+(general.jobNumber||'Export')+'</title>'+
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
  rows.push(['Job Number', general.jobNumber || '—', 'Customer', general.customer || '—']);
  rows.push(['Engineer',   general.engineer  || '—', 'Date',     general.dateCreated || '—']);
  rows.push(['Status',     general.status    || '—', 'Units',    unitSystem === 'imperial' ? 'Imperial' : 'Metric']);
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
  var fn = 'mfg-review-' + (general.jobNumber || 'export').replace(/\s+/g,'-') + '.xls';
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
  lines.push(csvRow(['Job', general.jobNumber||'', 'Customer', general.customer||'']));
  lines.push(csvRow(['Engineer', general.engineer||'', 'Date', general.dateCreated||'']));
  lines.push(csvRow(['Units', unitSystem === 'imperial' ? 'Imperial' : 'Metric']));
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

  var fn = 'mfg-review-' + (general.jobNumber || 'export').replace(/\s+/g,'-') + '.csv';
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
  lines.push('Job       ' + (general.jobNumber  || '—'));
  lines.push('Customer  ' + (general.customer   || '—'));
  lines.push('Engineer  ' + (general.engineer   || '—'));
  lines.push('Date      ' + (general.dateCreated|| '—'));
  lines.push('Status    ' + (general.status     || '—'));
  lines.push('Units     ' + (unitSystem === 'imperial' ? 'Imperial' : 'Metric'));
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

  var fn = 'mfg-review-' + (general.jobNumber || 'export').replace(/\s+/g,'-') + '.txt';
  exportDownload(fn, lines.join('\n'), 'text/plain');
}


// ===========================================================================
// REUSABLE INPUT COMPONENTS
// ===========================================================================

function buildInputSection(title, fields) {
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

function buildTextInput(label, id, value, onChange) {
  var wrap = fWrap();
  wrap.appendChild(fLabel(label, id));
  var inp = document.createElement('input');
  inp.type = 'text'; inp.id = id; inp.value = value || '';
  sInput(inp);
  inp.addEventListener('input', function() { if (onChange) onChange(inp.value); });
  wrap.appendChild(inp);
  return wrap;
}

function buildNumberInputEl(label, id, value, min, max, step, onChange) {
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

function buildSelectEl(label, id, options, value, onChange) {
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

function buildTextareaInput(label, id, value, onChange) {
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
  var c = colors[general.status] || colors.draft;
  el.textContent = general.status.toUpperCase();
  el.style.background = c.bg;
  el.style.color = c.color;
  el.style.borderColor = c.border;
}

function fWrap() {
  var el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: '4px' });
  return el;
}
function fLabel(text, forId) {
  var lbl = document.createElement('label');
  lbl.htmlFor = forId;
  Object.assign(lbl.style, { fontSize: '8px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#99b0c0' });
  lbl.textContent = text;
  return lbl;
}
function sInput(el) {
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
  var n0 = createNode('stock_in',   sx,        sy);
  var n1 = createNode('cut',        sx+sp,     sy);
  var n2 = createNode('heat',       sx+sp*2,   sy);
  var n3 = createNode('forge',      sx+sp*3,   sy);
  var n4 = createNode('heat_treat', sx+sp*4,   sy);
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
  overlay.style.display = 'flex';
  visible = true;
  setDisplaySystem(unitSystem);   // sync unit lib to current default
  refreshLeftPanel();
  refreshStatusBadge();
  if (nodes.length === 0) {
    panX = 0; panY = 0; zoom = 1;
    buildDefaultGraph();
  }
  applyWorldTransform();
}

export function hide() {
  if (overlay) overlay.style.display = 'none';
  visible = false;
  dismissContextMenu();
}

export function isVisible() { return visible; }

export function onBack(callback) { backCallback = callback; }