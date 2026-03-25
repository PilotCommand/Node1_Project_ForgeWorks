// ============================================================================
// manufacturingreview_estimates.js — Right Panel & Step Workings
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Owns the right "Estimates" panel (per-node detail view) and buildStepWorkings,
// the formula engine that generates symbolic + numeric breakdowns for every
// node type.  Both the right panel and the summary calc strip (and PDF export)
// consume buildStepWorkings.
//
// Imports:  manufacturingreview_states.js (S)
//           manufacturingreview.js (computeChain, round3, fmtVol,
//                                   dMass, dLen, dTemp, dVol, dDensity, dLenUnit,
//                                   NODE_DEFS, MATERIAL_CATALOG, ACCENT, ACCENT_DIM)
//           manufacturingreview_process.js (selectNode)
// Exports:  buildRightPanel(), showRightPlaceholder(),
//           refreshRightPanel(), buildStepWorkings()
// ============================================================================

import * as S from './manufacturingreview_states.js';
import {
  computeChain,
  round3, fmtVol,
  dMass, dLen, dTemp, dVol, dDensity, dLenUnit,
  NODE_DEFS, MATERIAL_CATALOG,
  ACCENT, ACCENT_DIM,
} from './manufacturingreview_defs.js';
import { selectNode } from './manufacturingreview_process.js';

// ---------------------------------------------------------------------------
// Right Panel
// ---------------------------------------------------------------------------

export function buildRightPanel() {
  var panel = document.createElement('div');
  panel.id = 'mr-right';
  Object.assign(panel.style, {
    width: '300px', minWidth: '60px', maxWidth: '800px', flexShrink: '0',
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

export function showRightPlaceholder() {
  var content = document.getElementById('mr-right-content');
  if (!content) return;
  content.innerHTML = '';
  var ph = document.createElement('div');
  Object.assign(ph.style, { color: '#3a5060', fontSize: '10px', textAlign: 'center', marginTop: '40px', lineHeight: '1.8', whiteSpace: 'pre-line' });
  ph.textContent = 'Connect a Stock In node\nto begin.';
  content.appendChild(ph);
}

// ---------------------------------------------------------------------------
// buildStepWorkings — returns array of:
//   { title, desc, symbolic, substituted, answer }
// ---------------------------------------------------------------------------

export function buildStepWorkings(step) {
  var p   = (S.getNodes().find(function(n) { return n.id === step.nodeId; }) || {}).params || {};
  var out = [];

  // Tag lookup — classifies each working title for the summary panel.
  // 'information' = static facts (material, procurement, part identity, requirements)
  // 'direction'   = operational parameters (temperature, timing, setup instructions)
  // 'calculation' = formulas with numeric results (volume, mass, loss, ratios)
  var WORKING_TAGS = {
    'Procurement':                  'information',
    'Stock Type':                   'information',
    'Material & Condition':         'information',
    'Prior Processing':             'information',
    'Cross-Section Geometry':       'information',
    'Cross-Section Area':           'calculation',
    'Volume per Piece':             'calculation',
    'Mass per Piece':               'calculation',
    'Total Incoming Mass':          'calculation',
    'Purpose':                      'information',
    'Saw Setup':                    'direction',
    'Crop Loss':                    'calculation',
    'Kerf Loss':                    'calculation',
    'Total Cut Loss':               'calculation',
    'Mass Out':                     'calculation',
    'Furnace Setup':                'direction',
    'Scale (Oxidation) Loss':       'calculation',
    'Mass After Heating':           'calculation',
    'Forging Temperature Window':   'direction',
    'Soak Time':                    'direction',
    'Equipment & Process':          'information',
    'Die Setup':                    'information',
    'Flash Loss':                   'calculation',
    'Mass Out of Forge':            'calculation',
    'Forge Ratio':                  'calculation',
    'True (Logarithmic) Strain':    'calculation',
    '% Height Reduction':           'calculation',
    'Ring Mill Process':            'information',
    'Ring Dimensions':              'direction',
    'Contour':                      'information',
    'Ring Volume':                  'calculation',
    'Trim Condition':               'information',
    'Flash Removed':                'calculation',
    'Flash Disposition':            'information',
    'Mass After Trimming':          'calculation',
    'Process & Specification':      'information',
    'Furnace':                      'direction',
    'Quench':                       'direction',
    'Temper':                       'direction',
    'Target Hardness':              'direction',
    'Mass Balance':                 'calculation',
    'Equipment & Operation':        'information',
    'Input Volume':                 'calculation',
    'Final Machined Volume':        'calculation',
    'Volume Removed (Chips)':       'calculation',
    'Chip Mass':                    'calculation',
    'Quality Requirements':         'information',
    'Final Part Mass':              'calculation',
    'Weld Process':                 'information',
    'Passes':                       'direction',
    'Post-Weld Treatment':          'direction',
    'Inspection Method':            'information',
    'Required Checks':              'information',
    'Sampling Plan':                'direction',
    'Disposition':                  'direction',
    'Product Description':          'information',
    'Part Identification':          'information',
    'Customer & Shipping':          'information',
    'Certification':                'information',
    'Final Mass Out':               'calculation',
    'Mass Flow':                    'calculation',
  };

  function w(title, desc, symbolic, substituted, answer) {
    out.push({ title: title, desc: desc, symbolic: symbolic, substituted: substituted, answer: answer,
               tag: WORKING_TAGS[title] || 'information' });
  }

  switch (step.nodeType) {

    case 'stock_in': {
      var geomW = p.geometry || 'round_cylinder';
      var densW = p.density || S.getGeneral().density;
      var Lw    = p.length || 0;
      var qty   = p.quantity || 1;
      var Aw, vol_mm3w, shapeDesc, volFormula, volSubst;

      if (geomW === 'rectangular_prism') {
        var Ww = p.width || 0; var Hw = p.sectionHeight || 0;
        Aw = Ww * Hw;
        vol_mm3w = Aw * Lw;
        shapeDesc = dLen(Ww) + ' W × ' + dLen(Hw) + ' H × ' + dLen(Lw) + ' L';
        volFormula = 'V = W × H × L';
        volSubst   = 'V = ' + dLen(Ww) + ' × ' + dLen(Hw) + ' × ' + dLen(Lw);
      } else if (geomW === 'round_corner_square') {
        var Sw = p.side || 0; var Rw = p.cornerRadius || 0;
        Aw = Math.max(0, Sw * Sw - (4 - Math.PI) * Rw * Rw);
        Aw = round3(Aw);
        vol_mm3w = Aw * Lw;
        shapeDesc = dLen(Sw) + ' side  ×  ' + dLen(Lw) + ' L  (R ' + dLen(Rw) + ' corners)';
        volFormula = 'A_RCS = S² − (4−π)·R²,  V = A × L';
        volSubst   = 'A = ' + dLen(Sw) + '² − (4−π)×' + dLen(Rw) + '² = ' + Aw + '  ·  V = A × ' + dLen(Lw);
      } else {
        var Dw = p.diameter || 0; var rw = Dw / 2;
        Aw = round3(Math.PI * rw * rw);
        vol_mm3w = round3(Math.PI * rw * rw * Lw);
        shapeDesc = dLen(Dw) + ' Ø × ' + dLen(Lw) + ' L';
        volFormula = 'V = π × (D ÷ 2)² × L';
        volSubst   = 'V = π × (' + dLen(Dw) + ' ÷ 2)² × ' + dLen(Lw);
      }
      vol_mm3w = round3(vol_mm3w);
      var vol_cm3w = round3(vol_mm3w / 1e6);
      var mPc      = round3(vol_cm3w * densW);
      var mTotW    = round3(mPc * qty);

      w('Procurement',
        'Purchase order, heat and lot numbers, supplier, and mill certification — traceability chain for the raw material.',
        '—',
        'PO: ' + (p.poNumber||'—') + '  ·  Heat: ' + (p.heatNumber||'—') + '  ·  Supplier: ' + (p.supplier||'—'),
        p.certNumber ? 'Cert: ' + p.certNumber : 'No cert recorded');

      w('Stock Type',
        'Ingots are as-cast. Billets are partially-wrought — previously forged or rolled from an ingot, giving finer grain and less porosity.',
        '—',
        (p.stockType||'billet'),
        (p.stockType||'billet'));

      w('Material & Condition',
        'Alloy grade and incoming metallurgical condition. Affects forgeability window, die load, and required preheat temperature.',
        '—',
        (p.grade||'—') + '  ·  ' + ((MATERIAL_CATALOG[p.materialFamily]||{}).label||'') + '  ·  ' + (p.condition||'').replace(/_/g,' '),
        'ρ = ' + dDensity(densW));

      w('Prior Processing',
        'Manufacturing origin and any heat treatment already applied. Ingot-cast stock has coarser grain; previously forged billets have superior grain structure.',
        '—',
        (p.mfgMethod||'').replace(/_/g,' ') + '  ·  Prior HT: ' + (p.priorHT||'none').replace(/_/g,' ') +
          (p.grainSize ? '  ·  Grain: ASTM ' + p.grainSize : '') +
          '  ·  Grain dir: ' + (p.grainDir||'').replace(/_/g,' '),
        (p.mfgMethod||'—').replace(/_/g,' '));

      w('Cross-Section Geometry',
        'Incoming stock cross-section. Round cylinder: standard bar/billet. Rectangular prism: slab or flat. Round-corner square (RCS): octagonal-emphasis square with chamfered corners — common for large alloy steel billets.',
        '—',
        geomW.replace(/_/g,' ') + '  ·  ' + shapeDesc,
        geomW.replace(/_/g,' '));

      w('Cross-Section Area',
        'Area of one cross-section slice — basis for volume calculation.',
        'A (see formula for shape)',
        volSubst,
        Aw + ' ' + dLenUnit() + '²');

      w('Volume per Piece',
        'Cross-section area × length = total piece volume.',
        volFormula,
        volSubst + '  ×  ' + dLen(Lw),
        dVol(vol_mm3w));

      w('Mass per Piece',
        'Volume converted to mass using the alloy density (' + dDensity(densW) + ').',
        'M = V_cm³ × ρ ÷ 1000',
        'M = ' + vol_cm3w + ' cm³ × ' + densW + ' ÷ 1000',
        dMass(mPc));

      w('Total Incoming Mass',
        'Total mass of all pieces entering the process for this order.',
        'M_total = M_pc × qty',
        'M_total = ' + dMass(mPc) + ' × ' + qty,
        dMass(mTotW));
      break;
    }

    case 'cut': {
      var geomCW  = step.dimsIn.geometry || 'round_cylinder';
      var densW2  = S.getGeneral().density;
      var AcW;
      if (geomCW === 'rectangular_prism') {
        AcW = (step.dimsIn.width || 0) * (step.dimsIn.height || 0);
      } else {
        var DcW = step.dimsIn.diameter || 0;
        AcW = round3(Math.PI * Math.pow(DcW / 2, 2));
      }
      var cropHW  = p.cropBothEnds === 'yes' ? (p.cropHeadMm || 0) : 0;
      var cropTW  = p.cropBothEnds === 'yes' ? (p.cropTailMm || 0) : 0;
      var kerfW   = p.kerfMm || 0;
      var nCuts   = (p.numPieces || 1) + (p.cropBothEnds === 'yes' ? 1 : 0);
      var kLoss   = round3(AcW * kerfW * nCuts / 1e6 * densW2);
      var cLoss   = round3(AcW * (cropHW + cropTW) / 1e6 * densW2);

      w('Purpose',
        'Cut to length: size the billet/ingot to the required blank length for forging. Crop ends: remove the head and tail of an ingot or billet — these zones contain shrinkage pipe, segregation, and inclusion-rich material that must be discarded before forging. Section: divide a large piece into multiple forgeable billets.',
        '—',
        (p.purpose||'cut_to_length').replace(/_/g,' '),
        (p.purpose||'cut_to_length').replace(/_/g,' '));

      w('Saw Setup',
        'Band saw is most common for large billet cross-sections — slow but economical on blade life and kerf. Cold saw uses a toothed disc and produces a very clean, square cut with minimal kerf.',
        '—',
        (p.sawType||'band_saw').replace(/_/g,' ') + '  ·  blade: ' + (p.bladeType||'bi_metal').replace(/_/g,' ') + '  ·  coolant: ' + (p.coolant||'flood'),
        (p.sawType||'band_saw').replace(/_/g,' '));

      w('Crop Loss',
        'Crop ends are discarded material from the head and tail of the ingot or billet. The head contains the shrinkage pipe (voids from solidification). The tail can contain segregation, inclusions, and poor-grain zones. Cropping is mandatory for quality forgings.',
        'M_crop = A_cs × (L_head + L_tail) ÷ 1 000 000 × ρ',
        'M_crop = ' + AcW + ' × (' + dLen(cropHW) + ' + ' + dLen(cropTW) + ') ÷ 1 000 000 × ' + densW2,
        dMass(cLoss));

      w('Kerf Loss',
        'Material consumed by the saw blade on each cut. Kerf = blade thickness. For large billets, kerf per cut can represent significant mass — especially on high-alloy materials.',
        'M_kerf = A_cs × kerf × n_cuts ÷ 1 000 000 × ρ',
        'M_kerf = ' + AcW + ' × ' + dLen(kerfW) + ' × ' + nCuts + ' cuts ÷ 1 000 000 × ' + densW2,
        dMass(kLoss));

      w('Total Cut Loss',
        'Sum of crop end loss and all kerf losses. This material is scrap — returned for remelt.',
        'M_loss = M_crop + M_kerf',
        'M_loss = ' + dMass(cLoss) + ' + ' + dMass(kLoss),
        dMass(round3(cLoss + kLoss)));

      w('Mass Out',
        'Usable billet mass proceeding to the furnace.',
        'M_out = M_in − M_loss',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(round3(cLoss + kLoss)),
        dMass(step.massOut));
      break;
    }

    case 'heat': {
      var sLossPct = p.scaleLossPct || 0;
      var sLoss    = round3(step.massIn * sLossPct / 100);
      var mOut2    = round3(step.massIn - sLoss);

      w('Furnace Setup',
        'Gas furnaces are primary; electric is used for small or precision jobs. Atmosphere controls scale formation — air causes the most oxidation, nitrogen or controlled carbon dramatically reduces it.',
        '—',
        (p.furnaceType||'gas') + ' furnace  ·  atmosphere: ' + (p.atmosphere||'air') + '  ·  load: ' + (p.loadMethod||'batch').replace(/_/g,' '),
        p.furnaceId ? 'Furnace ID: ' + p.furnaceId : (p.furnaceType||'gas') + ' furnace');

      w('Scale (Oxidation) Loss',
        'At forging temperature iron oxidises rapidly, forming iron-oxide scale (Fe₂O₃, Fe₃O₄) that flakes off. Air atmosphere: typically 1.5–3% loss. Nitrogen / controlled atmosphere: 0.2–0.5%.',
        'M_scale = M_in × (scale% ÷ 100)',
        'M_scale = ' + dMass(step.massIn) + ' × (' + sLossPct + ' ÷ 100)',
        dMass(sLoss));

      w('Mass After Heating',
        'Mass entering the forge after scale loss — the effective billet mass for flash and forge-ratio calculations.',
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
        'Press: slow, high tonnage, controlled stroke — ideal for large open-die work and complex sections. Hammer: rapid blows, high strain rate, excellent grain refinement — faster cycling for smaller work.',
        '—',
        (p.equipment||'press') + '  ·  ' + (p.process||'open_die').replace(/_/g,' ') + '  ·  ' + (p.pressTonnage||'—') + ' ton  ·  ' + (p.numHits||1) + ' hit' + ((p.numHits||1)>1?'s':''),
        p.dieNumber ? 'Die: ' + p.dieNumber : (p.process||'open_die').replace(/_/g,' '));

      w('Die Setup',
        'Die preheat (typically 150–300 °C) prevents thermal shock cracking and slows surface chilling of the workpiece, improving metal flow and reducing required tonnage. Graphite lubricant reduces friction and eases part ejection.',
        '—',
        'Die preheat: ' + dTemp(p.dieTemp||200) + '  ·  Lubricant: ' + (p.lubricant||'graphite').replace(/_/g,' '),
        dTemp(p.dieTemp||200));

      w('Flash Loss',
        'Flash is intentional excess metal pushed out at the die parting line to ensure complete cavity fill. Flash % is of billet mass entering the die. Open-die work typically has 0% intentional flash; closed-die 10–20%.',
        'M_flash = M_in × (flash% ÷ 100)',
        'M_flash = ' + dMass(step.massIn) + ' × (' + fPct + ' ÷ 100)',
        dMass(fLoss));

      w('Mass Out of Forge',
        'Forged part mass (including any flash still attached). Flash is removed at the Trim Flash step.',
        'M_out = M_in − M_flash',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(fLoss),
        dMass(mOut3));

      w('Forge Ratio',
        'Cross-sectional area reduction from billet to forged shape. R ≥ 3:1 breaks up cast structure and closes ingot porosity. R ≥ 5:1 achieves full grain refinement in most alloy steels. Critical applications often require R ≥ 4:1 minimum.',
        'R = A_in ÷ A_out',
        'R (target) = ' + R,
        R + ' : 1' + (R >= 5 ? '  ✓ excellent' : R >= 3 ? '  ✓ acceptable' : '  ⚠ below 3:1 minimum'));

      w('True (Logarithmic) Strain',
        'True strain ε = ln(h₀/h₁) — additive across passes, accurately representing large plastic deformations. Engineering strain underestimates at high reductions. Cumulative true strain tracks total plastic work.',
        'ε = ln( h₀ ÷ h₁ )',
        eps !== null
          ? 'ε = ln( ' + dLen(h0_) + ' ÷ ' + dLen(h1_) + ' )  =  ln( ' + round3(h0_/h1_) + ' )'
          : 'ε = ln( h₀ ÷ h₁ )  — set input / output heights',
        eps !== null ? 'ε = ' + eps : '—');

      w('% Height Reduction',
        'Engineering height reduction — quick reference for press tonnage estimation and operator targets. Not additive across passes; use true strain for cumulative tracking.',
        '%R = (h₀ − h₁) ÷ h₀ × 100',
        pctR !== null
          ? '%R = (' + dLen(h0_) + ' − ' + dLen(h1_) + ') ÷ ' + dLen(h0_) + ' × 100'
          : '%R — set input / output heights',
        pctR !== null ? pctR + '%' : '—');
      break;
    }

    case 'ring_mill': {
      var odRM = p.outOD || 0; var idRM = p.outID || 0; var htRM = p.outHeight || 0;
      var wallRM = round3((odRM - idRM) / 2);
      var volRM  = round3(Math.max(0, Math.PI / 4 * (odRM * odRM - idRM * idRM) * htRM));
      var mRM    = round3(volRM / 1e6 * S.getGeneral().density);
      var mLossRM= round3(Math.max(0, step.massIn - mRM));

      w('Ring Mill Process',
        'The ring mill drives a mandrel through the preform bore while a drive roll compresses the OD, reducing wall thickness and increasing diameter. The axial rolls control ring height simultaneously.',
        '—',
        'Preform: ' + (p.preformType||'pierced_disc').replace(/_/g,' ') + '  ·  mandrel Ø ' + dLen(p.mandrelDiam||0) + '  ·  ' + (p.rollPasses||1) + ' passes',
        (p.preformType||'pierced_disc').replace(/_/g,' '));

      w('Ring Dimensions',
        'Final rolled ring geometry. Wall thickness = (OD − ID) ÷ 2. Tighter wall-to-height ratios require more passes and careful temperature control.',
        'Wall = (OD − ID) ÷ 2',
        'Wall = (' + dLen(odRM) + ' − ' + dLen(idRM) + ') ÷ 2',
        'Wall = ' + dLen(wallRM) + '  ·  OD ' + dLen(odRM) + '  ·  ID ' + dLen(idRM) + '  ·  H ' + dLen(htRM));

      w('Contour',
        'OD and ID contours can be forged-in by profiled rolls (net-shape forging) or machined afterward. Forged contours save machining stock but require purpose-built tooling. Example: bearing races use profiled OD/ID contours.',
        '—',
        'OD contour: ' + (p.odContour||'none') + '  ·  ID contour: ' + (p.idContour||'none'),
        (p.odContour||'none') !== 'none' || (p.idContour||'none') !== 'none' ? 'contoured ring' : 'plain ring');

      w('Ring Volume',
        'Volume of a hollow cylinder = (π ÷ 4) × (OD² − ID²) × H.',
        'V = π ÷ 4 × (OD² − ID²) × H',
        'V = π ÷ 4 × (' + dLen(odRM) + '² − ' + dLen(idRM) + '²) × ' + dLen(htRM),
        dVol(volRM));

      w('Mass Out',
        'Ring mass. Loss reflects material that was in the preform but not captured in the final ring — flash, scale, or piercing slugs already removed upstream.',
        'M_out = V ÷ 1 000 000 × ρ',
        'M_out = ' + fmtVol(volRM) + ' ÷ 1 000 000 × ' + S.getGeneral().density,
        dMass(mRM));
      break;
    }

    case 'trim': {
      var tFPct = p.flashPct || 0;
      var tLoss = round3(step.massIn * tFPct / 100);
      var tOut  = round3(step.massIn - tLoss);

      w('Trim Condition',
        'Hot trimming (immediately post-forge, above ~650 °C) requires less force and preserves trim die life. Cold trimming gives a cleaner cut and better dimensional control but demands higher forces and can introduce residual stress.',
        '—',
        (p.trimCondition||'hot') + ' trim  ·  ' + (p.dieType||'conventional').replace(/_/g,' ') + ' die' + (p.dieNumber ? '  ·  Die #' + p.dieNumber : ''),
        (p.trimCondition||'hot') + ' trim');

      w('Flash Removed',
        'Flash mass removed at this step — the intentional overflow from the forge die parting line.',
        'M_trim = M_in × (flash% ÷ 100)',
        'M_trim = ' + dMass(step.massIn) + ' × (' + tFPct + ' ÷ 100)',
        dMass(tLoss));

      w('Flash Disposition',
        'Reforging retains the most value (alloy + thermal energy partly recovered). Remelt recovers alloy value. Scrap recycling is lowest value but simplest.',
        '—',
        (p.flashDisposition||'scrap_recycle').replace(/_/g,' '),
        (p.flashDisposition||'scrap_recycle').replace(/_/g,' '));

      w('Mass After Trimming',
        'Net forging mass proceeding to heat treatment or machining.',
        'M_out = M_in − M_trim',
        'M_out = ' + dMass(step.massIn) + ' − ' + dMass(tLoss),
        dMass(tOut));
      break;
    }

    case 'heat_treat': {
      var htHardStr = (p.targetHardnessMin > 0 || p.targetHardnessMax > 0)
        ? p.targetHardnessMin + '–' + p.targetHardnessMax + ' ' + (p.hardnessScale||'HB')
        : 'not specified';

      w('Process & Specification',
        'Normalize: air-cool from austenitize — refines grain, relieves stress. Anneal: slow furnace cool — maximum softness. Quench & Temper: water quench then temper — maximises strength and toughness. Stress Relief: below Ac1 — removes residual stress without phase change.',
        '—',
        (p.process||'normalize').replace(/_/g,' ') + (p.specNumber ? '  ·  ' + p.specNumber : ''),
        (p.process||'normalize').replace(/_/g,' '));

      w('Furnace',
        'Gas furnace is primary. Electric is used for small or precision jobs where tighter temperature uniformity is needed.',
        '—',
        (p.furnaceType||'gas') + ' furnace  ·  heat to ' + dTemp(p.targetTemp||0) + '  ·  soak ' + (p.soakMin||60) + ' min',
        (p.furnaceType||'gas') + ' furnace');

      w('Quench',
        'This forge currently uses water quench tanks. Water is the fastest quench medium — highest hardness potential but highest risk of quench cracking, particularly in large sections or complex shapes.',
        '—',
        (p.quenchant||'water') + '  ·  agitation: ' + (p.quenchAgitation||'still'),
        (p.quenchant||'water'));

      if ((p.temperTemp||0) > 0) {
        w('Temper',
          'As-quenched martensite is hard but brittle. Tempering recovers toughness by allowing carbon redistribution in the martensitic matrix. Higher temper temperature = lower hardness, higher toughness and ductility.',
          'T_temper  <  Ac1',
          'T_temper = ' + dTemp(p.temperTemp) + '  ·  soak = ' + (p.temperSoakMin||0) + ' min',
          dTemp(p.temperTemp));
      }

      w('Target Hardness',
        'Measured using Brinell hardness tester. Brinell (HB) is appropriate for forgings — the large ball indenter averages over a larger area and is not sensitive to surface scale or decarb layers.',
        '—',
        'Target: ' + htHardStr,
        htHardStr);

      w('Mass Balance',
        'Heat treatment has negligible mass loss when conducted in a furnace with controlled atmosphere. No material is removed in this step.',
        'M_out = M_in',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    case 'machine': {
      var dI  = step.dimsIn.diameter || step.dimsIn.od || 100;
      var hI  = step.dimsIn.height   || 150;
      var dO  = p.outDiameter || dI;
      var hO  = p.outHeight   || hI;
      var vI  = round3(Math.PI * Math.pow(dI/2, 2) * hI);
      var vO  = round3(Math.PI * Math.pow(dO/2, 2) * hO);
      var dV  = round3(Math.max(0, vI - vO));
      var cM  = round3(dV / 1e6 * S.getGeneral().density);
      var mO  = round3(Math.max(0, step.massIn - cM));

      w('Equipment & Operation',
        'Lathe: turning, facing, boring, threading on round parts. Vertical Mill: face milling, contouring on flat or prismatic features. Boullard (vertical boring mill): large diameter boring, facing, turning — suited to large forgings too heavy for a conventional lathe. Drill Press: hole drilling. Saw: cutoff. Sander/Grinder: surface dressing.',
        '—',
        (p.equipment||'lathe').replace(/_/g,' ') + '  ·  ' + (p.operation||'turn') + '  ·  ' + (p.numSetups||1) + ' setup' + ((p.numSetups||1)>1?'s':''),
        p.programNumber ? 'Ref: ' + p.programNumber : (p.operation||'turn'));

      w('Input Volume',
        'Volume of the forging as received at machining — deliberately oversized by the machining stock allowance to guarantee finish dimensions can be hit.',
        'V_in = π × (D_in ÷ 2)² × H_in',
        'V_in = π × (' + dLen(dI) + ' ÷ 2)² × ' + dLen(hI),
        dVol(vI));

      w('Final Machined Volume',
        'Target finished volume after all operations.',
        'V_out = π × (D_out ÷ 2)² × H_out',
        'V_out = π × (' + dLen(dO) + ' ÷ 2)² × ' + dLen(hO),
        dVol(vO));

      w('Volume Removed (Chips)',
        'The planned material removal. This is why forgings are intentionally oversized — the stock allowance ensures metal exists to achieve final dimensions.',
        'ΔV = V_in − V_out',
        'ΔV = ' + dVol(vI) + ' − ' + dVol(vO),
        dVol(dV));

      w('Chip Mass',
        'Mass of removed chips and swarf. Chips are recycled as scrap but represent alloy value, heating energy, and forging energy already invested.',
        'M_chips = ΔV ÷ 1 000 000 × ρ',
        'M_chips = ' + fmtVol(dV) + ' ÷ 1 000 000 × ' + S.getGeneral().density,
        dMass(cM));

      w('Quality Requirements',
        'Surface finish Ra (roughness average) and IT tolerance class define the precision required. Ra 125 μin = standard turned. Ra 63 μin = fine turned. Ra 32 μin = ground. IT7 = standard machined, IT6 = precision.',
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

    case 'weld': {
      w('Weld Process',
        'Arc welding and MIG (GMAW) with argon or 730 shielding gas. Used for repair, build-up, or joining operations. 730 is a mixed argon/CO₂ blend suited to structural carbon and alloy steels.',
        '—',
        (p.process||'arc') + ' weld  ·  gas: ' + (p.shieldingGas||'argon') + (p.filler ? '  ·  filler: ' + p.filler : ''),
        (p.process||'arc') + ' weld');

      w('Passes',
        'Multi-pass welds build up material in layers. Each pass must be cleaned of slag before the next. More passes = more heat input = larger heat-affected zone.',
        '—',
        (p.passes||1) + ' pass' + ((p.passes||1) > 1 ? 'es' : ''),
        (p.passes||1) + ' pass' + ((p.passes||1) > 1 ? 'es' : ''));

      w('Post-Weld Treatment',
        'Stress relief (typically 550–650 °C for carbon/alloy steels) reduces residual weld stresses, lowers risk of delayed cracking, and improves dimensional stability in service.',
        '—',
        (p.pwht||'none').replace(/_/g,' '),
        (p.pwht||'none').replace(/_/g,' '));

      w('Mass Balance',
        'Weld filler adds a small amount of mass but is not tracked here — mass is treated as a pass-through for process flow purposes.',
        'M_out ≈ M_in',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    case 'inspect': {
      var checks2 = [];
      if (p.checkDimensional === 'yes') checks2.push('dimensional');
      if (p.checkHardness    === 'yes') checks2.push('Brinell hardness');
      if (p.checkTemp        === 'yes') checks2.push('temperature record');

      w('Inspection Method',
        'Dimensional: tape, calipers, gauges. Brinell Hardness: Brinell tester — large ball suited to coarse-grained forgings. Temperature: multiped recorder verifies furnace cycle was achieved and documents the thermal history.',
        '—',
        (p.method||'dimensional').replace(/_/g,' ') + (p.specNumber ? '  ·  ' + p.specNumber : ''),
        (p.method||'dimensional').replace(/_/g,' '));

      w('Required Checks',
        'All listed checks must pass before the part proceeds to the next step.',
        '—',
        checks2.length > 0 ? checks2.join('  ·  ') : 'per method above',
        checks2.length > 0 ? checks2.join(', ') : 'per method');

      w('Sampling Plan',
        '100% inspection is standard for forgings on first runs or critical applications. First article inspection qualifies the process before full production.',
        '—',
        (p.samplingPlan||'100_percent').replace(/_/g,' '),
        (p.samplingPlan||'100_percent').replace(/_/g,' '));

      w('Disposition',
        'Pass → proceeds. Hold → awaits engineering review. Conditional pass → accepted with documented deviation. Scrap → removed from flow.',
        '—',
        (p.result||'pending').replace(/_/g,' '),
        (p.result||'pending').replace(/_/g,' '));

      w('Mass Balance',
        'Inspection is non-destructive — mass passes through unchanged for conforming parts.',
        'M_out = M_in  (pass)',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    case 'stock_out': {
      var ptSO = p.productType || 'bar';
      var pdSO = '';
      if (ptSO === 'bar') {
        pdSO = (p.barShape||'round') + ' bar';
        if (p.isStepped === 'yes') pdSO += '  ·  ' + (p.numSteps||1) + '-step';
        pdSO += '  ·  L: ' + dLen(p.barLength||0);
      } else if (ptSO === 'disc') {
        pdSO = 'disc  Ø ' + dLen(p.discOD||0) + '  ×  ' + dLen(p.discThickness||0) + ' thick';
      } else if (ptSO === 'ring') {
        pdSO = 'ring  OD ' + dLen(p.ringOD||0) + '  ID ' + dLen(p.ringID||0) + '  H ' + dLen(p.ringHeight||0);
        if ((p.odContour||'none') !== 'none') pdSO += '  ·  OD: ' + p.odContour;
        if ((p.idContour||'none') !== 'none') pdSO += '  ·  ID: ' + p.idContour;
      } else if (ptSO === 'mushroom') {
        pdSO = 'mushroom  flange Ø ' + dLen(p.flangeDiam||0) + '  stem Ø ' + dLen(p.stemDiam||0) + '  H ' + dLen(p.totalHeight||0);
      }

      w('Product Description',
        'The finished forged product. Bars can be round, rectangular, hexagonal, or stepped (multiple sections of varying shape/size). Discs are pancake-form forgings. Rings are pierced discs — rolled on the ring mill. Mushrooms are flange-and-stem shapes for aerospace/turbine applications.',
        '—',
        pdSO,
        ptSO);

      w('Part Identification',
        'Part number, revision, and work order provide full traceability from customer drawing to shipped product.',
        '—',
        (p.partNumber||'—') + (p.partRevision ? '  Rev ' + p.partRevision : '') + (p.workOrderNumber ? '  ·  WO: ' + p.workOrderNumber : ''),
        p.partNumber||'—');

      w('Customer & Shipping',
        'Final delivery destination and method.',
        '—',
        (p.customerName||'—') + '  ·  ' + (p.shippingMethod||'ground').replace(/_/g,' '),
        p.customerName||'—');

      w('Certification',
        'C of C (Certificate of Conformance) and Material Test Reports are standard for industrial forgings. First Article and FAIR are required for aerospace customers.',
        '—',
        p.certRequired === 'yes' ? (p.certType||'C_of_C').replace(/_/g,' ') + ' required' : 'no certification required',
        p.certRequired === 'yes' ? (p.certType||'C_of_C').replace(/_/g,' ') : 'none');

      w('Final Mass Out',
        'Total mass shipped — the recoverable output of the entire process chain.',
        'M_shipped = M_in  (pass-through)',
        'M_shipped = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }

    default: {
      w('Mass Flow',
        'Pass-through step — mass is unchanged.',
        'M_out = M_in',
        'M_out = ' + dMass(step.massIn),
        dMass(step.massOut));
      break;
    }
  }

  return out;
}

export function refreshRightPanel() {
  var content = document.getElementById('mr-right-content');
  if (!content) return;
  content.innerHTML = '';

  if (!S.getActiveOrderId()) {
    var locked = document.createElement('div');
    Object.assign(locked.style, { color: '#3a5060', fontSize: '10px', textAlign: 'center', marginTop: '40px', lineHeight: '2.0', whiteSpace: 'pre-line' });
    locked.textContent = 'Open a delivery order\nto see estimates.';
    content.appendChild(locked);
    return;
  }

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
    var isSelected = step.nodeId === S.getSelectedId();
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