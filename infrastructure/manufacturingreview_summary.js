// ============================================================================
// manufacturingreview_summary.js — Summary Calculations Panel
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Owns the full-width strip at the bottom of the Manufacturing Review UI.
// Renders every step in the process chain as a calculation block showing
// mass flow, step header, and detailed formula workings.
//
// buildStepWorkings() is imported from manufacturingreview_estimates.js —
// both this panel and the print-to-PDF renderer share the same workings data.
//
// Imports:  manufacturingreview_states.js (S)
//           manufacturingreview.js (computeChain, NODE_DEFS, ACCENT, ACCENT_DIM)
//           manufacturingreview_estimates.js (buildStepWorkings)
//           manufacturingreview_process.js (selectNode)
// Exports:  buildCalcPanel(), refreshCalcPanel()
// ============================================================================

import * as S from './manufacturingreview_states.js';
import { computeChain, NODE_DEFS, ACCENT, ACCENT_DIM } from './manufacturingreview_defs.js';
import { buildStepWorkings } from './manufacturingreview_estimates.js';
import { selectNode } from './manufacturingreview_process.js';

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

export function buildCalcPanel() {
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
  htitle.textContent = 'Summary';
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

export function refreshCalcPanel() {
  var content = document.getElementById('mr-calc-content');
  if (!content) return;
  content.innerHTML = '';

  if (!S.getActiveOrderId()) {
    var locked = document.createElement('div');
    Object.assign(locked.style, { color: '#3a5060', fontSize: '10px', textAlign: 'center', padding: '32px', lineHeight: '2.0', whiteSpace: 'pre-line' });
    locked.textContent = 'Open a delivery order\nto see calculations.';
    content.appendChild(locked);
    return;
  }

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
    var isSelected = step.nodeId === S.getSelectedId();
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
      // Skip this working cell if its tag category is currently filtered out
      var tag = w.tag || 'information';
      if (tag === 'information' && !S.getShowTagInformation()) return;
      if (tag === 'direction'   && !S.getShowTagDirection())   return;
      if (tag === 'calculation' && !S.getShowTagCalculation()) return;

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

      // Title row (number + title + tag pill)
      var wTitleRow = document.createElement('div');
      Object.assign(wTitleRow.style, {
        display: 'flex', alignItems: 'center', gap: '7px',
        marginBottom: '2px',
      });
      var wTitle = document.createElement('div');
      Object.assign(wTitle.style, {
        fontSize: '8px', fontWeight: '700', letterSpacing: '1.5px',
        textTransform: 'uppercase', color: '#aabbcc',
        flex: '1',
      });
      wTitle.textContent = (idx + 1) + '.' + (wi + 1) + '  ' + w.title;

      // Tag pill
      var tagCfg = {
        information: { label: 'Information', bg: 'rgba(74,143,204,0.12)',  border: 'rgba(74,143,204,0.35)',  color: '#5ba3d9' },
        direction:   { label: 'Direction',   bg: 'rgba(196,154,60,0.12)',  border: 'rgba(196,154,60,0.35)',  color: '#c9a84c' },
        calculation: { label: 'Calculation', bg: 'rgba(90,158,111,0.12)', border: 'rgba(90,158,111,0.35)', color: '#6dbd8a' },
      }[w.tag] || { label: 'Information', bg: 'rgba(74,143,204,0.12)', border: 'rgba(74,143,204,0.35)', color: '#5ba3d9' };

      var tagPill = document.createElement('div');
      Object.assign(tagPill.style, {
        fontSize: '7px', fontWeight: '700', letterSpacing: '1px',
        textTransform: 'uppercase',
        padding: '1px 5px', borderRadius: '2px',
        background: tagCfg.bg, border: '1px solid ' + tagCfg.border, color: tagCfg.color,
        flexShrink: '0',
      });
      tagPill.textContent = tagCfg.label;
      wTitleRow.appendChild(wTitle);
      wTitleRow.appendChild(tagPill);

      // Description (hidden when user disables descriptions toggle)
      var wDesc = document.createElement('div');
      Object.assign(wDesc.style, {
        fontSize: '9px', color: '#7a9aaa', lineHeight: '1.4',
        marginBottom: '6px',
        display: S.getShowDescriptions() ? 'block' : 'none',
      });
      wDesc.textContent = w.desc;

      // Symbolic formula
      var wSym = document.createElement('div');
      Object.assign(wSym.style, {
        fontSize: '10px', color: '#8aa0b0',
        fontFamily: "'Consolas','SF Mono',monospace",
        letterSpacing: '0.3px', lineHeight: '1.5',
        display: S.getShowMathematics() ? 'block' : 'none',
      });
      wSym.textContent = w.symbolic;

      // Substituted formula (numbers)
      var wSub = document.createElement('div');
      Object.assign(wSub.style, {
        fontSize: '10px', color: '#a0b8c8',
        fontFamily: "'Consolas','SF Mono',monospace",
        letterSpacing: '0.3px', lineHeight: '1.5',
        display: S.getShowMathematics() ? 'block' : 'none',
      });
      wSub.textContent = w.substituted;

      // Divider line
      var divLine = document.createElement('div');
      Object.assign(divLine.style, {
        height: '1px', background: 'rgba(255,255,255,0.18)',
        margin: '5px 0',
        display: S.getShowMathematics() ? 'block' : 'none',
      });

      // Answer
      var wAns = document.createElement('div');
      Object.assign(wAns.style, {
        fontSize: '13px', fontWeight: '700', color: '#ddeeff',
        fontFamily: "'Consolas','SF Mono',monospace",
        letterSpacing: '0.5px',
      });
      wAns.textContent = '= ' + w.answer;

      cell.appendChild(wTitleRow);
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