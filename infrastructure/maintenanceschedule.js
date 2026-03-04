// ============================================================================
// maintenanceschedule.js — Maintenance Schedule Calendar
// Forgeworks Infrastructure
// ============================================================================
// Full-screen page displaying a monthly calendar of scheduled maintenance
// events for all forge equipment. Includes an event detail sidebar, upcoming
// tasks list, and equipment health overview.
//
// Exports: show(), hide(), isVisible(), onBack(callback)
// ============================================================================

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

var overlay = null;
var backCallback = null;
var visible = false;
var viewYear = 2026;
var viewMonth = 2; // 0-indexed, 2 = March
var selectedDate = null;
var selectedEvent = null;

// ---------------------------------------------------------------------------
// Accent
// ---------------------------------------------------------------------------

var ACCENT = '#e9c46a';
var ACCENT_DIM = 'rgba(233, 196, 106, ';

// ---------------------------------------------------------------------------
// Equipment List
// ---------------------------------------------------------------------------

var EQUIPMENT = [
  { id: 'EQP-HP-2K',  name: '2000T Hydraulic Press',  bay: 'Press Bay 1',    health: 87 },
  { id: 'EQP-FF-01',  name: 'Gas Forge Furnace #1',   bay: 'Furnace Bay 1',  health: 72 },
  { id: 'EQP-FF-02',  name: 'Gas Forge Furnace #2',   bay: 'Furnace Bay 2',  health: 45 },
  { id: 'EQP-PH-500', name: 'Power Hammer 500kg',     bay: 'Hammer Bay',     health: 91 },
  { id: 'EQP-QT-5K',  name: 'Oil Quench Tank 5000L',  bay: 'Quench Bay',     health: 68 },
  { id: 'EQP-BC-5T',  name: '5T Bridge Crane',        bay: 'Main Hall',      health: 95 },
  { id: 'EQP-FL-25',  name: 'Forklift CAT DP25 (×2)', bay: 'Yard',           health: 82 },
  { id: 'EQP-RR-01',  name: 'Ring Rolling Mill',       bay: 'Ring Bay',       health: 76 },
];

// ---------------------------------------------------------------------------
// Maintenance Event Types
// ---------------------------------------------------------------------------

var EVENT_TYPES = {
  inspection:   { label: 'Inspection',         color: '#00b4d8', icon: '\u25CB' },
  preventive:   { label: 'Preventive Maint.',  color: '#22c55e', icon: '\u25D2' },
  repair:       { label: 'Repair',             color: '#ef4444', icon: '\u25A0' },
  calibration:  { label: 'Calibration',        color: '#a78bfa', icon: '\u25C7' },
  overhaul:     { label: 'Major Overhaul',     color: '#ff6a00', icon: '\u25C9' },
  lubrication:  { label: 'Lubrication',        color: '#2ec4b6', icon: '\u25CF' },
};

// ---------------------------------------------------------------------------
// Demo Maintenance Events
// ---------------------------------------------------------------------------

var EVENTS = [
  // February 2026
  { id: 'M-201', date: '2026-02-02', equipment: 'EQP-HP-2K',  type: 'lubrication',  duration: 2,  tech: 'J. Martinez', status: 'complete', notes: 'Hydraulic oil replaced. Cylinder seals inspected — no wear.' },
  { id: 'M-202', date: '2026-02-09', equipment: 'EQP-FF-01',  type: 'inspection',   duration: 3,  tech: 'R. Chen',      status: 'complete', notes: 'Refractory lining at 70%. Schedule relining within 60 days.' },
  { id: 'M-203', date: '2026-02-16', equipment: 'EQP-QT-5K',  type: 'calibration',  duration: 1,  tech: 'A. Petrov',    status: 'complete', notes: 'Thermocouple probes recalibrated. Oil temp sensors within spec.' },
  { id: 'M-204', date: '2026-02-20', equipment: 'EQP-PH-500', type: 'preventive',   duration: 4,  tech: 'J. Martinez', status: 'complete', notes: 'Die guides replaced. Anvil cap resurfaced.' },
  { id: 'M-205', date: '2026-02-25', equipment: 'EQP-FL-25',  type: 'inspection',   duration: 2,  tech: 'S. Okafor',   status: 'complete', notes: 'Both units passed. Tire pressure adjusted on Unit 2.' },

  // March 2026
  { id: 'M-301', date: '2026-03-02', equipment: 'EQP-FF-02',  type: 'repair',       duration: 5,  tech: 'R. Chen',      status: 'in_progress', notes: 'Burner assembly replacement. Parts on order — ETA Mar 4.' },
  { id: 'M-302', date: '2026-03-05', equipment: 'EQP-HP-2K',  type: 'inspection',   duration: 3,  tech: 'J. Martinez', status: 'scheduled', notes: 'Quarterly hydraulic system inspection. Check accumulator pre-charge.' },
  { id: 'M-303', date: '2026-03-08', equipment: 'EQP-RR-01',  type: 'lubrication',  duration: 2,  tech: 'A. Petrov',    status: 'scheduled', notes: 'Bearing grease replacement. Check mandrel alignment.' },
  { id: 'M-304', date: '2026-03-10', equipment: 'EQP-BC-5T',  type: 'calibration',  duration: 1,  tech: 'S. Okafor',   status: 'scheduled', notes: 'Load cell calibration. Annual safety cert renewal.' },
  { id: 'M-305', date: '2026-03-12', equipment: 'EQP-QT-5K',  type: 'preventive',   duration: 3,  tech: 'R. Chen',      status: 'scheduled', notes: 'Oil change and filtration system service. Check agitator motor.' },
  { id: 'M-306', date: '2026-03-17', equipment: 'EQP-PH-500', type: 'inspection',   duration: 2,  tech: 'J. Martinez', status: 'scheduled', notes: 'Foundation bolt torque check. Inspect guide columns.' },
  { id: 'M-307', date: '2026-03-20', equipment: 'EQP-FF-01',  type: 'overhaul',     duration: 8,  tech: 'R. Chen',      status: 'scheduled', notes: 'Refractory relining. Full insulation replacement. 8-day downtime.' },
  { id: 'M-308', date: '2026-03-25', equipment: 'EQP-FL-25',  type: 'preventive',   duration: 2,  tech: 'S. Okafor',   status: 'scheduled', notes: 'Engine oil change, hydraulic filter replacement, brake inspection.' },
  { id: 'M-309', date: '2026-03-28', equipment: 'EQP-HP-2K',  type: 'lubrication',  duration: 2,  tech: 'J. Martinez', status: 'scheduled', notes: 'Guide rail lubrication. Top-up hydraulic reservoir.' },

  // April 2026
  { id: 'M-401', date: '2026-04-03', equipment: 'EQP-FF-02',  type: 'inspection',   duration: 3,  tech: 'R. Chen',      status: 'scheduled', notes: 'Post-repair verification. Full burner performance test.' },
  { id: 'M-402', date: '2026-04-07', equipment: 'EQP-RR-01',  type: 'preventive',   duration: 4,  tech: 'A. Petrov',    status: 'scheduled', notes: 'Drive roller resurfacing. Axial roll bearing replacement.' },
  { id: 'M-403', date: '2026-04-14', equipment: 'EQP-PH-500', type: 'calibration',  duration: 1,  tech: 'J. Martinez', status: 'scheduled', notes: 'Blow energy calibration. Stroke counter verification.' },
  { id: 'M-404', date: '2026-04-18', equipment: 'EQP-BC-5T',  type: 'inspection',   duration: 2,  tech: 'S. Okafor',   status: 'scheduled', notes: 'Wire rope inspection. Trolley wheel and brake check.' },
  { id: 'M-405', date: '2026-04-22', equipment: 'EQP-QT-5K',  type: 'calibration',  duration: 1,  tech: 'A. Petrov',    status: 'scheduled', notes: 'Flow meter calibration. Cooling jacket temp verification.' },
];


// ---------------------------------------------------------------------------
// Status Config
// ---------------------------------------------------------------------------

var STATUS_CFG = {
  complete:    { label: 'Complete',    color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  in_progress: { label: 'In Progress', color: '#ff6a00', bg: 'rgba(255,106,0,0.08)' },
  scheduled:   { label: 'Scheduled',  color: '#00b4d8', bg: 'rgba(0,180,216,0.08)' },
  overdue:     { label: 'Overdue',    color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
};

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];


// ---------------------------------------------------------------------------
// Build DOM
// ---------------------------------------------------------------------------

function buildOverlay() {
  if (overlay) return;
  injectStyles();

  overlay = document.createElement('div');
  overlay.id = 'forgeworks-maintenance';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '9999',
    display: 'flex', flexDirection: 'column',
    background: '#060b11',
    overflow: 'hidden',
    fontFamily: "'Consolas', 'SF Mono', 'Fira Code', 'Monaco', monospace",
    color: '#aabbcc',
  });

  // Background
  var bg = document.createElement('div');
  Object.assign(bg.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
    background:
      'radial-gradient(ellipse 60% 50% at 50% 110%, ' + ACCENT_DIM + '0.04) 0%, transparent 70%),' +
      'radial-gradient(ellipse 40% 40% at 90% 10%, rgba(100,80,20,0.03) 0%, transparent 60%)',
  });
  overlay.appendChild(bg);

  var gridTex = document.createElement('div');
  Object.assign(gridTex.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none', opacity: '0.02',
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  });
  overlay.appendChild(gridTex);

  // Top bar
  overlay.appendChild(buildTopBar());

  // Body = calendar + sidebar
  var body = document.createElement('div');
  Object.assign(body.style, {
    position: 'relative', zIndex: '2',
    flex: '1', display: 'flex',
    overflow: 'hidden',
  });

  body.appendChild(buildCalendarArea());
  body.appendChild(buildSidebar());

  overlay.appendChild(body);
  document.body.appendChild(overlay);
}


// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function buildTopBar() {
  var bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative', zIndex: '3',
    display: 'flex', alignItems: 'center',
    padding: '0 24px',
    height: '52px', minHeight: '52px',
    borderBottom: '1px solid ' + ACCENT_DIM + '0.15)',
    background: 'rgba(4, 8, 14, 0.9)',
    backdropFilter: 'blur(8px)',
  });

  // Back
  var backBtn = document.createElement('button');
  Object.assign(backBtn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px', color: '#667788', cursor: 'pointer',
    padding: '5px 12px', fontSize: '10px', fontFamily: 'inherit',
    letterSpacing: '1px', transition: 'all 0.2s ease',
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  backBtn.innerHTML = '<span style="font-size:14px;line-height:1">\u2039</span> MENU';
  backBtn.addEventListener('mouseenter', function() { backBtn.style.borderColor = ACCENT; backBtn.style.color = ACCENT; });
  backBtn.addEventListener('mouseleave', function() { backBtn.style.borderColor = 'rgba(255,255,255,0.1)'; backBtn.style.color = '#667788'; });
  backBtn.addEventListener('click', function() { if (backCallback) backCallback(); });
  bar.appendChild(backBtn);

  // Title
  var title = document.createElement('div');
  Object.assign(title.style, {
    marginLeft: '20px', fontSize: '12px', fontWeight: '600',
    letterSpacing: '3px', textTransform: 'uppercase', color: ACCENT,
  });
  title.textContent = 'Maintenance Schedule';
  bar.appendChild(title);

  // Accent line
  var accent = document.createElement('div');
  Object.assign(accent.style, {
    marginLeft: '16px', flex: '1', height: '1px',
    background: 'linear-gradient(90deg, ' + ACCENT_DIM + '0.3), transparent 60%)',
  });
  bar.appendChild(accent);

  // Legend
  var legend = document.createElement('div');
  Object.assign(legend.style, {
    display: 'flex', gap: '12px', alignItems: 'center',
  });
  var typeKeys = Object.keys(EVENT_TYPES);
  for (var i = 0; i < typeKeys.length; i++) {
    var et = EVENT_TYPES[typeKeys[i]];
    var item = document.createElement('div');
    Object.assign(item.style, {
      display: 'flex', alignItems: 'center', gap: '4px',
      fontSize: '8px', color: '#556677', letterSpacing: '0.5px',
    });
    var dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '6px', height: '6px', borderRadius: '50%',
      background: et.color, flexShrink: '0',
    });
    item.appendChild(dot);
    item.appendChild(document.createTextNode(et.label));
    legend.appendChild(item);
  }
  bar.appendChild(legend);

  return bar;
}


// ---------------------------------------------------------------------------
// Calendar Area (left)
// ---------------------------------------------------------------------------

function buildCalendarArea() {
  var area = document.createElement('div');
  area.id = 'maint-cal-area';
  Object.assign(area.style, {
    flex: '1', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  });

  // Month nav
  var nav = document.createElement('div');
  nav.id = 'maint-month-nav';
  Object.assign(nav.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '20px', padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    flexShrink: '0',
  });
  area.appendChild(nav);

  // Calendar grid
  var grid = document.createElement('div');
  grid.id = 'maint-cal-grid';
  Object.assign(grid.style, {
    flex: '1', padding: '8px 24px 24px',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  });
  area.appendChild(grid);

  return area;
}


function renderMonthNav() {
  var nav = document.getElementById('maint-month-nav');
  if (!nav) return;
  nav.innerHTML = '';

  var prevBtn = makeNavBtn('\u2039');
  prevBtn.addEventListener('click', function() {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    selectedDate = null;
    selectedEvent = null;
    renderCalendar();
    renderMonthNav();
    renderSidebarContent();
  });
  nav.appendChild(prevBtn);

  var label = document.createElement('div');
  Object.assign(label.style, {
    fontSize: '14px', fontWeight: '300', letterSpacing: '4px',
    textTransform: 'uppercase', color: '#c8cdd3',
    minWidth: '220px', textAlign: 'center',
  });
  label.textContent = MONTH_NAMES[viewMonth] + ' ' + viewYear;
  nav.appendChild(label);

  var nextBtn = makeNavBtn('\u203A');
  nextBtn.addEventListener('click', function() {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    selectedDate = null;
    selectedEvent = null;
    renderCalendar();
    renderMonthNav();
    renderSidebarContent();
  });
  nav.appendChild(nextBtn);

  // Today button
  var todayBtn = document.createElement('button');
  Object.assign(todayBtn.style, {
    position: 'absolute', right: '24px',
    background: 'none', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', color: '#556677', cursor: 'pointer',
    padding: '4px 10px', fontSize: '9px', fontFamily: 'inherit',
    letterSpacing: '1px', transition: 'all 0.2s ease',
  });
  todayBtn.textContent = 'TODAY';
  todayBtn.addEventListener('mouseenter', function() { todayBtn.style.borderColor = ACCENT; todayBtn.style.color = ACCENT; });
  todayBtn.addEventListener('mouseleave', function() { todayBtn.style.borderColor = 'rgba(255,255,255,0.08)'; todayBtn.style.color = '#556677'; });
  todayBtn.addEventListener('click', function() {
    viewYear = 2026; viewMonth = 2; // March 2026
    selectedDate = '2026-03-04';
    selectedEvent = null;
    renderCalendar();
    renderMonthNav();
    renderSidebarContent();
  });
  nav.appendChild(todayBtn);
}

function makeNavBtn(text) {
  var btn = document.createElement('button');
  Object.assign(btn.style, {
    background: 'none', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '3px', color: '#667788', cursor: 'pointer',
    width: '32px', height: '32px', fontSize: '18px', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.2s ease', lineHeight: '1',
  });
  btn.textContent = text;
  btn.addEventListener('mouseenter', function() { btn.style.borderColor = ACCENT; btn.style.color = ACCENT; });
  btn.addEventListener('mouseleave', function() { btn.style.borderColor = 'rgba(255,255,255,0.08)'; btn.style.color = '#667788'; });
  return btn;
}


function renderCalendar() {
  var grid = document.getElementById('maint-cal-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Day headers
  var headerRow = document.createElement('div');
  Object.assign(headerRow.style, {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px', marginBottom: '1px',
  });
  for (var d = 0; d < 7; d++) {
    var dh = document.createElement('div');
    Object.assign(dh.style, {
      textAlign: 'center', padding: '6px 0',
      fontSize: '8px', letterSpacing: '2px', textTransform: 'uppercase',
      color: d === 0 || d === 6 ? '#4a3a2a' : '#445566',
    });
    dh.textContent = DAY_NAMES[d];
    headerRow.appendChild(dh);
  }
  grid.appendChild(headerRow);

  // Compute days
  var firstDay = new Date(viewYear, viewMonth, 1).getDay();
  var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  var totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  var calGrid = document.createElement('div');
  Object.assign(calGrid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px', flex: '1',
  });

  var todayStr = '2026-03-04'; // simulated today

  for (var c = 0; c < totalCells; c++) {
    var dayNum = c - firstDay + 1;
    var isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
    var dateStr = isCurrentMonth ? formatDate(viewYear, viewMonth, dayNum) : null;
    var dayEvents = dateStr ? getEventsForDate(dateStr) : [];
    var isToday = dateStr === todayStr;
    var isSelected = dateStr === selectedDate;
    var isWeekend = (c % 7 === 0 || c % 7 === 6);

    var cell = document.createElement('div');
    cell.dataset.date = dateStr || '';
    Object.assign(cell.style, {
      position: 'relative',
      minHeight: '0',
      padding: '4px 6px',
      background: isSelected ? ACCENT_DIM + '0.06)' :
                  isToday ? 'rgba(255,255,255,0.02)' :
                  isWeekend && isCurrentMonth ? 'rgba(0,0,0,0.15)' :
                  isCurrentMonth ? 'rgba(0,8,16,0.3)' : 'rgba(0,0,0,0.25)',
      border: isSelected ? '1px solid ' + ACCENT_DIM + '0.3)' :
              isToday ? '1px solid rgba(255,255,255,0.08)' :
              '1px solid rgba(255,255,255,0.02)',
      borderRadius: '2px',
      cursor: isCurrentMonth ? 'pointer' : 'default',
      transition: 'background 0.15s ease, border-color 0.15s ease',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    });

    // Day number
    var num = document.createElement('div');
    Object.assign(num.style, {
      fontSize: '11px', fontWeight: isToday ? '700' : '400',
      color: !isCurrentMonth ? '#222a33' :
             isToday ? ACCENT :
             isWeekend ? '#4a4030' : '#667788',
      marginBottom: '2px',
    });
    num.textContent = isCurrentMonth ? dayNum : '';
    cell.appendChild(num);

    // Today marker
    if (isToday) {
      var marker = document.createElement('div');
      Object.assign(marker.style, {
        position: 'absolute', top: '4px', right: '6px',
        fontSize: '7px', letterSpacing: '1px',
        color: ACCENT, opacity: '0.6',
      });
      marker.textContent = 'TODAY';
      cell.appendChild(marker);
    }

    // Event dots / chips
    if (dayEvents.length > 0) {
      var evWrap = document.createElement('div');
      Object.assign(evWrap.style, {
        display: 'flex', flexDirection: 'column', gap: '1px',
        flex: '1', overflow: 'hidden',
      });

      for (var e = 0; e < dayEvents.length && e < 3; e++) {
        var ev = dayEvents[e];
        var et = EVENT_TYPES[ev.type] || EVENT_TYPES.inspection;
        var equip = getEquipmentById(ev.equipment);

        var chip = document.createElement('div');
        Object.assign(chip.style, {
          fontSize: '7px', lineHeight: '1.3',
          padding: '1px 4px', borderRadius: '1px',
          background: et.color + '15',
          borderLeft: '2px solid ' + et.color,
          color: et.color,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        });
        chip.textContent = equip ? equip.name.split(' ')[0] : ev.equipment;
        evWrap.appendChild(chip);
      }

      if (dayEvents.length > 3) {
        var more = document.createElement('div');
        Object.assign(more.style, { fontSize: '7px', color: '#556677', paddingLeft: '4px' });
        more.textContent = '+' + (dayEvents.length - 3) + ' more';
        evWrap.appendChild(more);
      }

      cell.appendChild(evWrap);
    }

    // Click handler
    if (isCurrentMonth) {
      (function(ds, evts) {
        cell.addEventListener('click', function() {
          selectedDate = ds;
          selectedEvent = evts.length > 0 ? evts[0] : null;
          renderCalendar();
          renderSidebarContent();
        });
        cell.addEventListener('mouseenter', function() {
          if (ds !== selectedDate) {
            cell.style.borderColor = ACCENT_DIM + '0.15)';
          }
        });
        cell.addEventListener('mouseleave', function() {
          if (ds !== selectedDate) {
            cell.style.borderColor = ds === todayStr ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)';
          }
        });
      })(dateStr, dayEvents);
    }

    calGrid.appendChild(cell);
  }

  grid.appendChild(calGrid);
}


// ---------------------------------------------------------------------------
// Sidebar (right)
// ---------------------------------------------------------------------------

function buildSidebar() {
  var sidebar = document.createElement('div');
  sidebar.id = 'maint-sidebar';
  Object.assign(sidebar.style, {
    width: '320px', minWidth: '320px',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(4, 8, 14, 0.5)',
    borderLeft: '1px solid rgba(255,255,255,0.04)',
    overflowY: 'auto',
  });

  var content = document.createElement('div');
  content.id = 'maint-sidebar-content';
  content.style.flex = '1';
  sidebar.appendChild(content);

  return sidebar;
}


function renderSidebarContent() {
  var el = document.getElementById('maint-sidebar-content');
  if (!el) return;
  el.innerHTML = '';

  // Section 1: Selected date / event detail
  if (selectedDate) {
    el.appendChild(renderDateDetail());
  }

  // Section 2: Upcoming tasks
  el.appendChild(renderUpcoming());

  // Section 3: Equipment health
  el.appendChild(renderEquipmentHealth());
}


function renderDateDetail() {
  var wrap = document.createElement('div');
  wrap.style.padding = '16px 16px 8px';

  // Date header
  var dateObj = parseDate(selectedDate);
  var header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '10px', fontWeight: '600', letterSpacing: '2px',
    textTransform: 'uppercase', color: ACCENT,
    marginBottom: '12px', paddingBottom: '6px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    display: 'flex', alignItems: 'center', gap: '8px',
  });
  var dot = document.createElement('span');
  Object.assign(dot.style, { width: '4px', height: '4px', borderRadius: '50%', background: ACCENT });
  header.appendChild(dot);
  header.appendChild(document.createTextNode(
    DAY_NAMES[dateObj.getDay()] + ', ' + MONTH_NAMES[dateObj.getMonth()] + ' ' + dateObj.getDate()
  ));
  wrap.appendChild(header);

  var dayEvents = getEventsForDate(selectedDate);

  if (dayEvents.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      fontSize: '10px', color: '#445566', padding: '8px 0 16px',
    });
    empty.textContent = 'No maintenance scheduled for this date.';
    wrap.appendChild(empty);
    return wrap;
  }

  for (var i = 0; i < dayEvents.length; i++) {
    var ev = dayEvents[i];
    var et = EVENT_TYPES[ev.type] || EVENT_TYPES.inspection;
    var equip = getEquipmentById(ev.equipment);
    var sts = STATUS_CFG[ev.status] || STATUS_CFG.scheduled;

    var card = document.createElement('div');
    Object.assign(card.style, {
      padding: '12px',
      background: selectedEvent && selectedEvent.id === ev.id ? ACCENT_DIM + '0.05)' : 'rgba(0,8,16,0.4)',
      border: '1px solid ' + (selectedEvent && selectedEvent.id === ev.id ? ACCENT_DIM + '0.2)' : 'rgba(255,255,255,0.04)'),
      borderLeft: '3px solid ' + et.color,
      borderRadius: '3px',
      marginBottom: '8px',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    });

    (function(event) {
      card.addEventListener('click', function() {
        selectedEvent = event;
        renderSidebarContent();
      });
    })(ev);

    // Type + status row
    var typeRow = document.createElement('div');
    Object.assign(typeRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' });

    var typeBadge = document.createElement('span');
    Object.assign(typeBadge.style, {
      fontSize: '8px', letterSpacing: '1px', textTransform: 'uppercase',
      color: et.color, fontWeight: '600',
    });
    typeBadge.textContent = et.icon + ' ' + et.label;
    typeRow.appendChild(typeBadge);

    var stsBadge = document.createElement('span');
    Object.assign(stsBadge.style, {
      fontSize: '7px', letterSpacing: '0.5px', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: '2px',
      color: sts.color, background: sts.bg,
      border: '1px solid ' + sts.color + '22',
    });
    stsBadge.textContent = sts.label;
    typeRow.appendChild(stsBadge);
    card.appendChild(typeRow);

    // Equipment name
    var eqName = document.createElement('div');
    Object.assign(eqName.style, { fontSize: '11px', fontWeight: '600', color: '#b0bec5', marginBottom: '4px' });
    eqName.textContent = equip ? equip.name : ev.equipment;
    card.appendChild(eqName);

    // Details
    var detailLines = [
      { label: 'Location', value: equip ? equip.bay : '—' },
      { label: 'Duration', value: ev.duration + ' hrs' },
      { label: 'Technician', value: ev.tech },
      { label: 'ID', value: ev.id },
    ];

    for (var d = 0; d < detailLines.length; d++) {
      var row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', justifyContent: 'space-between',
        fontSize: '9px', marginBottom: '1px',
      });
      var lbl = document.createElement('span');
      lbl.style.color = '#556677';
      lbl.textContent = detailLines[d].label;
      row.appendChild(lbl);
      var val = document.createElement('span');
      val.style.color = '#778899';
      val.textContent = detailLines[d].value;
      row.appendChild(val);
      card.appendChild(row);
    }

    // Notes
    if (ev.notes) {
      var notes = document.createElement('div');
      Object.assign(notes.style, {
        fontSize: '9px', color: '#5a6a7a', lineHeight: '1.5',
        marginTop: '8px', paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.03)',
      });
      notes.textContent = ev.notes;
      card.appendChild(notes);
    }

    wrap.appendChild(card);
  }

  return wrap;
}


function renderUpcoming() {
  var wrap = document.createElement('div');
  wrap.style.padding = '12px 16px';

  var header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '9px', fontWeight: '600', letterSpacing: '2px',
    textTransform: 'uppercase', color: '#5a7a8a',
    marginBottom: '10px', paddingBottom: '4px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  });
  header.textContent = 'Upcoming Tasks';
  wrap.appendChild(header);

  var todayStr = '2026-03-04';
  var upcoming = [];
  for (var i = 0; i < EVENTS.length; i++) {
    if (EVENTS[i].date >= todayStr && EVENTS[i].status === 'scheduled') {
      upcoming.push(EVENTS[i]);
    }
  }
  upcoming.sort(function(a, b) { return a.date.localeCompare(b.date); });

  if (upcoming.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, { fontSize: '10px', color: '#445566' });
    empty.textContent = 'No upcoming tasks.';
    wrap.appendChild(empty);
    return wrap;
  }

  for (var u = 0; u < Math.min(upcoming.length, 6); u++) {
    var ev = upcoming[u];
    var et = EVENT_TYPES[ev.type] || EVENT_TYPES.inspection;
    var equip = getEquipmentById(ev.equipment);
    var dateObj = parseDate(ev.date);

    var row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,0.02)',
      cursor: 'pointer', transition: 'background 0.1s',
    });
    row.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.02)'; });
    row.addEventListener('mouseleave', function() { this.style.background = 'none'; });

    (function(event) {
      row.addEventListener('click', function() {
        var d = parseDate(event.date);
        viewYear = d.getFullYear();
        viewMonth = d.getMonth();
        selectedDate = event.date;
        selectedEvent = event;
        renderMonthNav();
        renderCalendar();
        renderSidebarContent();
      });
    })(ev);

    // Date chip
    var dateChip = document.createElement('div');
    Object.assign(dateChip.style, {
      width: '36px', textAlign: 'center', flexShrink: '0',
    });
    var dateDay = document.createElement('div');
    Object.assign(dateDay.style, { fontSize: '13px', fontWeight: '600', color: '#778899', lineHeight: '1' });
    dateDay.textContent = dateObj.getDate();
    dateChip.appendChild(dateDay);
    var dateMon = document.createElement('div');
    Object.assign(dateMon.style, { fontSize: '7px', color: '#445566', textTransform: 'uppercase', letterSpacing: '1px' });
    dateMon.textContent = MONTH_NAMES[dateObj.getMonth()].substring(0, 3);
    dateChip.appendChild(dateMon);
    row.appendChild(dateChip);

    // Color dot
    var colorDot = document.createElement('div');
    Object.assign(colorDot.style, {
      width: '4px', height: '24px', borderRadius: '2px',
      background: et.color, flexShrink: '0', opacity: '0.6',
    });
    row.appendChild(colorDot);

    // Text
    var text = document.createElement('div');
    text.style.flex = '1';
    var eName = document.createElement('div');
    Object.assign(eName.style, { fontSize: '10px', color: '#8899aa' });
    eName.textContent = equip ? equip.name : ev.equipment;
    text.appendChild(eName);
    var eType = document.createElement('div');
    Object.assign(eType.style, { fontSize: '8px', color: '#556677' });
    eType.textContent = et.label + ' \u2022 ' + ev.duration + 'h \u2022 ' + ev.tech;
    text.appendChild(eType);
    row.appendChild(text);

    wrap.appendChild(row);
  }

  return wrap;
}


function renderEquipmentHealth() {
  var wrap = document.createElement('div');
  wrap.style.padding = '12px 16px 20px';

  var header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '9px', fontWeight: '600', letterSpacing: '2px',
    textTransform: 'uppercase', color: '#5a7a8a',
    marginBottom: '10px', paddingBottom: '4px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  });
  header.textContent = 'Equipment Health';
  wrap.appendChild(header);

  for (var i = 0; i < EQUIPMENT.length; i++) {
    var eq = EQUIPMENT[i];

    var row = document.createElement('div');
    Object.assign(row.style, {
      marginBottom: '8px',
    });

    // Name + percentage
    var top = document.createElement('div');
    Object.assign(top.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '3px',
    });
    var name = document.createElement('span');
    Object.assign(name.style, { fontSize: '9px', color: '#778899' });
    name.textContent = eq.name;
    top.appendChild(name);

    var pct = document.createElement('span');
    var hColor = eq.health >= 80 ? '#22c55e' : eq.health >= 60 ? '#e9c46a' : '#ef4444';
    Object.assign(pct.style, { fontSize: '9px', fontWeight: '600', color: hColor });
    pct.textContent = eq.health + '%';
    top.appendChild(pct);
    row.appendChild(top);

    // Bar
    var barOuter = document.createElement('div');
    Object.assign(barOuter.style, {
      width: '100%', height: '3px',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '2px', overflow: 'hidden',
    });
    var barInner = document.createElement('div');
    Object.assign(barInner.style, {
      width: eq.health + '%', height: '100%',
      background: hColor,
      borderRadius: '2px',
      transition: 'width 0.6s ease',
    });
    barOuter.appendChild(barInner);
    row.appendChild(barOuter);

    wrap.appendChild(row);
  }

  return wrap;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function parseDate(str) {
  var parts = str.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

function getEventsForDate(dateStr) {
  var result = [];
  for (var i = 0; i < EVENTS.length; i++) {
    if (EVENTS[i].date === dateStr) result.push(EVENTS[i]);
  }
  return result;
}

function getEquipmentById(id) {
  for (var i = 0; i < EQUIPMENT.length; i++) {
    if (EQUIPMENT[i].id === id) return EQUIPMENT[i];
  }
  return null;
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('maint-styles')) return;
  var style = document.createElement('style');
  style.id = 'maint-styles';
  style.textContent =
    '#forgeworks-maintenance ::-webkit-scrollbar { width: 6px; }' +
    '#forgeworks-maintenance ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }' +
    '#forgeworks-maintenance ::-webkit-scrollbar-thumb { background: ' + ACCENT_DIM + '0.2); border-radius: 3px; }' +
    '#forgeworks-maintenance ::-webkit-scrollbar-thumb:hover { background: ' + ACCENT_DIM + '0.4); }';
  document.head.appendChild(style);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function show() {
  buildOverlay();
  overlay.style.display = 'flex';
  visible = true;

  viewYear = 2026;
  viewMonth = 2;
  selectedDate = '2026-03-04';
  selectedEvent = null;

  renderMonthNav();
  renderCalendar();
  renderSidebarContent();
}

export function hide() {
  if (overlay) overlay.style.display = 'none';
  visible = false;
}

export function isVisible() {
  return visible;
}

export function onBack(callback) {
  backCallback = callback;
}
