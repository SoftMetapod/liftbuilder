'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  HOST MEET  —  Phase 1: Setup & Weigh-In
//  All competition-hosting logic lives here, separate from the main app.
//  Communicates with the main app only through globals: esc(), state,
//  closeModal(), renderMain(), showToast().
// ═══════════════════════════════════════════════════════════════════════════

const HM = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────
  const GIRLS_WC = ['101','110','119','129','139','154','169','183','199','UNL'];
  const BOYS_WC  = ['119','129','139','154','169','183','199','219','238','HWT'];

  const DISC_LABEL = {
    both:       'Both (Olympic + Traditional)',
    traditional:'Traditional (C&J + Bench)',
    olympic:    'Olympic (Snatch + C&J)',
    exhibition: 'Exhibition',
  };

  const STATUS_LABEL = {
    setup:     'Setup',
    'weigh-in':'Weigh-In',
    snatch:    'Snatch',
    cj:        'Clean & Jerk',
    bench:     'Bench',
    complete:  'Complete',
  };

  // ── Module state ───────────────────────────────────────────────────────────
  let _meets        = [];
  let _activeMeetId = null;
  let _view         = 'list';   // 'list' | 'setup' | 'weighin'
  let _rosterCache  = [];       // holds roster athletes during import modal

  // ── Persistence ────────────────────────────────────────────────────────────
  const STORE_KEY = 'liftbuilder_hosted_meets';

  function _save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(_meets)); } catch(e) {}
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) _meets = JSON.parse(raw);
    } catch(e) { _meets = []; }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _meet() { return _meets.find(m => m.id === _activeMeetId) || null; }

  function _uid(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
  }

  function _wcs(gender) { return gender === 'Girls' ? GIRLS_WC : BOYS_WC; }

  function _blankEntry(name, schoolId, wc, discipline, athleteId, defaults) {
    return {
      id:         _uid('ent'),
      athleteId:  athleteId || null,
      name,
      schoolId,
      wc,
      discipline,
      weighIn:    null,
      snatchOpen: defaults?.snatch || 0,
      cjOpen:     defaults?.cj     || 0,
      benchOpen:  defaults?.bench  || 0,
      snatch: [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
      cj:     [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
      bench:  [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
    };
  }

  // Open a percentage default (90%) rounded to nearest 5
  function _openAttempt(max) {
    if (!max) return 0;
    return Math.round(max * 0.9 / 5) * 5;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PUBLIC: buildHTML — called by renderMain() in main app
  // ══════════════════════════════════════════════════════════════════════════
  function buildHTML() {
    _load();
    if (_view === 'setup')   return _buildSetupHTML();
    if (_view === 'weighin') return _buildWeighInHTML();
    return _buildListHTML();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════
  function _buildListHTML() {
    const cards = _meets.length
      ? _meets.slice().reverse().map(m => {
          const statusLabel = STATUS_LABEL[m.status] || m.status;
          const statusColor = m.status === 'complete' ? '#5EC08A'
                            : m.status === 'setup'    ? '#888'
                            : '#C9A84C';
          const weighed = m.entries.filter(e => e.weighIn !== null).length;
          return `
            <div class="chart-card" style="margin-bottom:1rem;cursor:pointer;transition:border-color .15s;"
              onmouseenter="this.style.borderColor='var(--gold-a40)'"
              onmouseleave="this.style.borderColor=''"
              onclick="HM.openMeet('${m.id}')">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-family:'Barlow Condensed',sans-serif;font-size:21px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.name)}</div>
                  <div style="font-size:12px;color:var(--muted);margin-top:3px;">
                    ${m.gender} &nbsp;·&nbsp; ${m.date||'No date'} ${m.location ? '&nbsp;·&nbsp; '+esc(m.location) : ''}
                  </div>
                  <div style="font-size:12px;color:var(--muted);margin-top:4px;">
                    ${m.schools.length} school${m.schools.length!==1?'s':''} &nbsp;·&nbsp; ${m.entries.length} athlete${m.entries.length!==1?'s':''}
                    ${m.status==='weigh-in'?` &nbsp;·&nbsp; ${weighed}/${m.entries.length} weighed in`:''}
                  </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                  <span style="font-size:11px;padding:3px 10px;border-radius:3px;background:${statusColor}22;color:${statusColor};font-family:'Barlow Condensed',sans-serif;font-weight:600;letter-spacing:.5px;">${statusLabel.toUpperCase()}</span>
                  <button onclick="event.stopPropagation();HM.deleteMeet('${m.id}')"
                    style="background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.35);border-radius:4px;cursor:pointer;color:#E07070;font-size:12px;padding:4px 9px;font-family:'Barlow Condensed',sans-serif;font-weight:600;">🗑</button>
                </div>
              </div>
            </div>`;
        }).join('')
      : `<div class="empty-msg" style="padding:4rem;">No hosted meets yet.<br>Create one to get started.</div>`;

    return `
      <div class="week-bar">
        <div class="week-title">Host a Meet</div>
        <div style="flex:1;"></div>
        <button onclick="HM.newMeet()" class="btn btn-gold" style="font-size:13px;">+ New Meet</button>
      </div>
      <div style="max-width:800px;">
        ${cards}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SETUP VIEW
  // ══════════════════════════════════════════════════════════════════════════
  function _buildSetupHTML() {
    const m = _meet();
    if (!m) { _view = 'list'; return _buildListHTML(); }

    const schoolRows = m.schools.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--dark2);border-radius:5px;margin-bottom:6px;border:1px solid var(--dark3);">
        <span style="flex:1;font-size:14px;font-weight:500;">${esc(s.name)}</span>
        ${s.isHome ? `<span style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--gold-a15);color:var(--gold);font-family:'Barlow Condensed',sans-serif;font-weight:600;letter-spacing:.5px;">HOME</span>` : ''}
        <button onclick="HM.removeSchool('${s.id}')"
          style="background:none;border:none;cursor:pointer;color:#555;font-size:14px;padding:2px 5px;"
          onmouseenter="this.style.color='#E07070'" onmouseleave="this.style.color='#555'">✕</button>
      </div>`).join('');

    const entryRows = m.entries.map(e => {
      const school = m.schools.find(s => s.id === e.schoolId);
      return `<tr style="border-bottom:1px solid var(--dark3);">
        <td style="padding:8px 10px;font-weight:500;">${esc(e.name)}</td>
        <td style="padding:8px 10px;color:var(--muted);font-size:13px;">${esc(school?.name||'—')}</td>
        <td style="padding:8px 10px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:600;">${e.wc}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:var(--muted);">${{both:'Both',traditional:'Traditional',olympic:'Olympic',exhibition:'Exhibition'}[e.discipline]||e.discipline}</td>
        <td style="padding:8px 10px;text-align:right;">
          <button onclick="HM.removeEntry('${e.id}')"
            style="background:none;border:none;cursor:pointer;color:#555;font-size:12px;padding:2px 5px;"
            onmouseenter="this.style.color='#E07070'" onmouseleave="this.style.color='#555'">✕</button>
        </td>
      </tr>`;
    }).join('');

    const hasHomeSchool = m.schools.some(s => s.isHome);
    const canProceed    = m.name.trim() && m.schools.length >= 2 && m.entries.length > 0;

    // Count entries per school per wc to show warning if any slot is full
    const wcCounts = {};
    m.entries.forEach(e => {
      const key = e.schoolId + '_' + e.wc;
      wcCounts[key] = (wcCounts[key] || 0) + 1;
    });

    return `
      <div class="week-bar">
        <button onclick="HM.backToList()"
          style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
          onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← Back</button>
        <div class="week-title" style="margin-left:12px;">Meet Setup</div>
        <div style="flex:1;"></div>
        <button onclick="HM.saveSetupAndProceed()" class="btn btn-gold" style="font-size:13px;"
          ${canProceed?'':'disabled'}
          title="${canProceed?'Proceed to weigh-in':'Requires: meet name, 2+ schools, 1+ athlete'}">
          Proceed to Weigh-In →
        </button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;max-width:1000px;">
        <!-- Meet Info -->
        <div class="chart-card">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;">Meet Info</div>
          <div class="form-field">
            <label>Meet Name</label>
            <input type="text" id="hm-name" value="${esc(m.name)}" placeholder="e.g. District 4A Invitational" oninput="HM.autoSaveSetup()">
          </div>
          <div class="fg2">
            <div class="form-field">
              <label>Date</label>
              <input type="date" id="hm-date" value="${m.date}" oninput="HM.autoSaveSetup()">
            </div>
            <div class="form-field">
              <label>Gender</label>
              <select id="hm-gender" onchange="HM.autoSaveSetup();renderMain()">
                <option value="Boys"  ${m.gender==='Boys' ?'selected':''}>Boys</option>
                <option value="Girls" ${m.gender==='Girls'?'selected':''}>Girls</option>
              </select>
            </div>
          </div>
          <div class="form-field">
            <label>Location / Venue</label>
            <input type="text" id="hm-location" value="${esc(m.location)}" placeholder="e.g. Seminole H.S. Weight Room" oninput="HM.autoSaveSetup()">
          </div>
        </div>

        <!-- Schools -->
        <div class="chart-card">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;">Schools (${m.schools.length})</div>
          ${schoolRows || `<div style="font-size:13px;color:var(--muted);margin-bottom:.75rem;font-style:italic;">No schools added yet. Add your home school first.</div>`}
          <div style="display:flex;gap:8px;margin-top:.75rem;flex-wrap:wrap;">
            <button onclick="HM.openAddSchoolModal(true)" class="btn btn-gold" style="font-size:12px;padding:5px 12px;"
              ${hasHomeSchool?'disabled':''} title="${hasHomeSchool?'Home school already added':'Add your school as the host'}">
              + Home School
            </button>
            <button onclick="HM.openAddSchoolModal(false)" class="btn btn-outline" style="font-size:12px;padding:5px 12px;">
              + Visiting School
            </button>
          </div>
          ${m.schools.length < 2 ? `<div style="font-size:11px;color:#C9A84C;margin-top:8px;">⚠ At least 2 schools required to proceed.</div>` : ''}
        </div>
      </div>

      <!-- Entries -->
      <div class="chart-card" style="max-width:1000px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:8px;">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);">
            Entries (${m.entries.length})
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${hasHomeSchool ? `<button onclick="HM.openImportRosterModal()" class="btn btn-outline" style="font-size:12px;padding:5px 12px;">⬆ Import from Roster</button>` : ''}
            <button onclick="HM.openAddEntryModal()" class="btn btn-gold" style="font-size:12px;padding:5px 12px;"
              ${m.schools.length?'':'disabled'} title="${m.schools.length?'Add an athlete manually':'Add schools first'}">
              + Add Athlete
            </button>
          </div>
        </div>
        ${m.entries.length ? `
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:2px solid var(--dark3);">
                <th style="text-align:left;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Athlete</th>
                <th style="text-align:left;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">School</th>
                <th style="text-align:center;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Wt Class</th>
                <th style="text-align:center;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Discipline</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${entryRows}</tbody>
          </table>` : `
          <div class="empty-msg" style="padding:2rem;">
            No athletes entered yet.
            ${m.schools.length ? 'Use "Import from Roster" to add your team, or "+ Add Athlete" for manual entry.' : 'Add schools above first.'}
          </div>`}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WEIGH-IN VIEW
  // ══════════════════════════════════════════════════════════════════════════
  function _buildWeighInHTML() {
    const m = _meet();
    if (!m) { _view = 'list'; return _buildListHTML(); }
    const wcs = _wcs(m.gender);

    // Group by weight class in FHSAA order
    const byWC = {};
    wcs.forEach(wc => { if (m.entries.some(e => e.wc === wc)) byWC[wc] = []; });
    m.entries.forEach(e => {
      if (!byWC[e.wc]) byWC[e.wc] = [];
      byWC[e.wc].push(e);
    });

    const wcSections = Object.entries(byWC).map(([wc, entries]) => {
      const allWeighed = entries.every(e => e.weighIn !== null);

      const rows = entries.map(e => {
        const school      = m.schools.find(s => s.id === e.schoolId);
        const weighed     = e.weighIn !== null;
        const needsSnatch = e.discipline === 'both' || e.discipline === 'olympic';
        const needsBench  = e.discipline === 'both' || e.discipline === 'traditional';

        return `<tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:9px 12px;">
            <div style="font-weight:500;font-size:14px;">${esc(e.name)}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(school?.name||'')} · ${{both:'Both',traditional:'Traditional',olympic:'Olympic',exhibition:'Exhibition'}[e.discipline]||e.discipline}</div>
          </td>
          <td style="padding:9px 12px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="number" id="wi-${e.id}"
                value="${e.weighIn !== null ? e.weighIn : ''}"
                min="50" max="500" step="0.1" placeholder="—"
                style="width:75px;background:var(--dark);color:var(--white);border:1px solid ${weighed?'var(--gold-a50)':'var(--dark3)'};border-radius:4px;padding:5px 7px;font-size:14px;font-family:'Barlow Condensed',sans-serif;"
                oninput="HM.saveWeighIn('${e.id}')">
              <span style="font-size:11px;color:var(--muted);">lbs</span>
              ${weighed ? `<span style="color:#5EC08A;font-size:15px;">✓</span>` : `<span style="color:#555;font-size:12px;">—</span>`}
            </div>
          </td>
          <td style="padding:9px 12px;">
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${needsSnatch ? `
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:11px;color:var(--muted);width:44px;">Snatch</span>
                  <input type="number" id="snopen-${e.id}" value="${e.snatchOpen||''}" min="0" step="5" placeholder="0"
                    style="width:64px;background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 6px;font-size:13px;"
                    oninput="HM.saveOpen('${e.id}','snatch')">
                  <span style="font-size:11px;color:var(--muted);">lbs</span>
                </div>` : ''}
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:11px;color:var(--muted);width:44px;">C&amp;J</span>
                <input type="number" id="cjopen-${e.id}" value="${e.cjOpen||''}" min="0" step="5" placeholder="0"
                  style="width:64px;background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 6px;font-size:13px;"
                  oninput="HM.saveOpen('${e.id}','cj')">
                <span style="font-size:11px;color:var(--muted);">lbs</span>
              </div>
              ${needsBench ? `
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:11px;color:var(--muted);width:44px;">Bench</span>
                  <input type="number" id="benchopen-${e.id}" value="${e.benchOpen||''}" min="0" step="5" placeholder="0"
                    style="width:64px;background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 6px;font-size:13px;"
                    oninput="HM.saveOpen('${e.id}','bench')">
                  <span style="font-size:11px;color:var(--muted);">lbs</span>
                </div>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');

      return `
        <div class="chart-card" style="margin-bottom:1rem;max-width:900px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:.75rem;">
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;">${wc} lbs</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:3px;font-family:'Barlow Condensed',sans-serif;font-weight:600;
              background:${allWeighed?'#5EC08A22':'rgba(200,168,76,0.15)'};
              color:${allWeighed?'#5EC08A':'#C9A84C'};">
              ${allWeighed ? 'ALL WEIGHED IN' : `${entries.filter(e=>e.weighIn!==null).length}/${entries.length} WEIGHED IN`}
            </span>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:2px solid var(--dark3);">
                <th style="text-align:left;padding:5px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Athlete</th>
                <th style="text-align:left;padding:5px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Weigh-In Weight</th>
                <th style="text-align:left;padding:5px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Opening Attempts</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');

    const totalWeighed = m.entries.filter(e => e.weighIn !== null).length;
    const allDone      = totalWeighed === m.entries.length && m.entries.length > 0;

    return `
      <div class="week-bar">
        <button onclick="HM.backToSetup()"
          style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
          onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← Back to Setup</button>
        <div class="week-title" style="margin-left:12px;">Weigh-In — ${esc(m.name)}</div>
        <div style="flex:1;"></div>
        <span style="font-size:13px;color:var(--muted);margin-right:14px;">${totalWeighed} / ${m.entries.length} weighed in</span>
        <button onclick="HM.proceedToCompetition()" class="btn btn-gold" style="font-size:13px;"
          ${allDone?'':'disabled'}
          title="${allDone?'Start the competition':'All athletes must be weighed in first'}">
          Begin Competition →
        </button>
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:1.25rem;padding:10px 14px;background:var(--dark2);border:1px solid var(--dark3);border-left:3px solid var(--gold);border-radius:4px;max-width:900px;">
        Record each athlete's actual weigh-in weight and opening attempts. C&J is required for all athletes regardless of discipline.
        Opening attempts are declared at weigh-in and can be updated here before competition starts.
      </div>
      ${wcSections || '<div class="empty-msg">No entries found.</div>'}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SETUP ACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  function newMeet() {
    const id = _uid('hm');
    _meets.push({
      id,
      name:     '',
      date:     '',
      location: '',
      gender:   'Boys',
      status:   'setup',
      schools:  [],
      entries:  [],
    });
    _activeMeetId = id;
    _save();
    _view = 'setup';
    renderMain();
  }

  function autoSaveSetup() {
    const m = _meet(); if (!m) return;
    const nameEl     = document.getElementById('hm-name');
    const dateEl     = document.getElementById('hm-date');
    const locEl      = document.getElementById('hm-location');
    const genderEl   = document.getElementById('hm-gender');
    if (nameEl)   m.name     = nameEl.value.trim();
    if (dateEl)   m.date     = dateEl.value;
    if (locEl)    m.location = locEl.value.trim();
    if (genderEl) m.gender   = genderEl.value;
    _save();
  }

  function saveSetupAndProceed() {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    if (!m.name.trim())       { alert('Enter a meet name.');              return; }
    if (m.schools.length < 2) { alert('Add at least 2 schools.');         return; }
    if (!m.entries.length)    { alert('Add at least one athlete entry.'); return; }
    m.status = 'weigh-in';
    _save();
    _view = 'weighin';
    renderMain();
  }

  // ── Schools ────────────────────────────────────────────────────────────────
  function openAddSchoolModal(isHome) {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    if (isHome && m.schools.some(s => s.isHome)) {
      alert('A home school is already added. Remove it first to change.'); return;
    }
    const defaultName = isHome && typeof team === 'function' ? (team()?.name || '') : '';
    document.getElementById('modal-body').innerHTML = `
      <h3>${isHome ? 'Add Home School' : 'Add Visiting School'}</h3>
      <div class="form-field">
        <label>School Name</label>
        <input type="text" id="hm-school-name" value="${esc(defaultName)}" placeholder="School name" style="font-size:15px;">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-gold" onclick="HM.saveSchool(${isHome?'true':'false'})">Add School</button>
      </div>`;
    document.getElementById('overlay').style.display = 'flex';
    setTimeout(() => { const el = document.getElementById('hm-school-name'); if(el){el.focus();el.select();} }, 50);
  }

  function saveSchool(isHome) {
    const name = document.getElementById('hm-school-name')?.value.trim();
    if (!name) { alert('Enter a school name.'); return; }
    const m = _meet(); if (!m) return;
    m.schools.push({ id: _uid('sch'), name, isHome: !!isHome });
    _save(); closeModal(); renderMain();
  }

  function removeSchool(schoolId) {
    const m = _meet(); if (!m) return;
    const school = m.schools.find(s => s.id === schoolId);
    if (!confirm(`Remove "${school?.name}"? All athletes from this school will also be removed.`)) return;
    m.schools = m.schools.filter(s => s.id !== schoolId);
    m.entries = m.entries.filter(e => e.schoolId !== schoolId);
    _save(); renderMain();
  }

  // ── Manual entry ───────────────────────────────────────────────────────────
  function openAddEntryModal() {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    const wcs        = _wcs(m.gender);
    const schoolOpts = m.schools.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

    document.getElementById('modal-body').innerHTML = `
      <h3>Add Athlete Entry</h3>
      <div class="fg2">
        <div class="form-field"><label>Athlete Name</label><input type="text" id="hm-ent-name" placeholder="Full name"></div>
        <div class="form-field"><label>School</label><select id="hm-ent-school">${schoolOpts}</select></div>
      </div>
      <div class="fg2">
        <div class="form-field">
          <label>Weight Class</label>
          <select id="hm-ent-wc">
            ${wcs.map(w => `<option value="${w}">${w} lbs</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Discipline</label>
          <select id="hm-ent-disc">
            <option value="both">Both (Olympic + Traditional)</option>
            <option value="traditional">Traditional only (C&amp;J + Bench)</option>
            <option value="olympic">Olympic only (Snatch + C&amp;J)</option>
            <option value="exhibition">Exhibition</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-gold" onclick="HM.saveEntry()">Add Athlete</button>
      </div>`;
    document.getElementById('overlay').style.display = 'flex';
    setTimeout(() => document.getElementById('hm-ent-name')?.focus(), 50);
  }

  function saveEntry() {
    const m = _meet(); if (!m) return;
    const name       = document.getElementById('hm-ent-name')?.value.trim();
    const schoolId   = document.getElementById('hm-ent-school')?.value;
    const wc         = document.getElementById('hm-ent-wc')?.value;
    const discipline = document.getElementById('hm-ent-disc')?.value || 'both';
    if (!name)     { alert('Enter athlete name.'); return; }
    if (!schoolId) { alert('Select a school.');    return; }

    const schoolEntries = m.entries.filter(e => e.schoolId === schoolId && e.wc === wc);
    if (schoolEntries.length >= 2) {
      const sn = m.schools.find(s => s.id === schoolId)?.name || 'this school';
      alert(`Max 2 lifters per weight class per school. ${sn} already has 2 entries in the ${wc} lb class.`);
      return;
    }

    m.entries.push(_blankEntry(name, schoolId, wc, discipline, null, null));
    _save(); closeModal(); renderMain();
  }

  function removeEntry(entryId) {
    const m = _meet(); if (!m) return;
    m.entries = m.entries.filter(e => e.id !== entryId);
    _save(); renderMain();
  }

  // ── Roster import ──────────────────────────────────────────────────────────
  function openImportRosterModal() {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    const homeSchool = m.schools.find(s => s.isHome);
    if (!homeSchool) { alert('No home school set.'); return; }

    // Pull athletes from main app state, filtered by meet gender
    const all = (typeof state !== 'undefined' ? (state.roster?.athletes || []) : []);
    _rosterCache = all.filter(a => !m.gender || a.gender === m.gender);

    if (!_rosterCache.length) {
      alert(`No ${m.gender} athletes in your roster. Add athletes to the Roster first.`); return;
    }

    const wcs  = _wcs(m.gender);
    const rows = _rosterCache.map((a, idx) => {
      const already = m.entries.some(e => e.athleteId === a.id);
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:5px;cursor:pointer;background:var(--dark2);margin-bottom:5px;border:1px solid var(--dark3);opacity:${already?'0.4':'1'};">
          <input type="checkbox" value="${idx}" ${already?'disabled checked':''} style="accent-color:var(--gold);width:14px;height:14px;flex-shrink:0;">
          <span style="flex:1;">
            <span style="font-weight:600;color:var(--white);font-size:14px;">${esc(a.name)}</span>
            <span style="color:var(--muted);font-size:12px;margin-left:8px;">${a.wc||'?'} lbs · ${a.team||''}</span>
          </span>
          <select id="hm-import-wc-${idx}" ${already?'disabled':''}
            style="background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 7px;font-size:12px;">
            ${wcs.map(w => `<option value="${w}" ${a.wc===w?'selected':''}>${w}</option>`).join('')}
          </select>
          <select id="hm-import-disc-${idx}" ${already?'disabled':''}
            style="background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 7px;font-size:12px;">
            <option value="both">Both</option>
            <option value="traditional">Traditional</option>
            <option value="olympic">Olympic</option>
            <option value="exhibition">Exhibition</option>
          </select>
        </label>`;
    }).join('');

    document.getElementById('modal-body').innerHTML = `
      <h3>Import from Roster</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:1rem;">
        Select athletes to enter. Adjust weight class and discipline for each.
        Opening attempts will be pre-filled at 90% of roster maxes.
      </p>
      <div id="hm-roster-list" style="max-height:380px;overflow-y:auto;">${rows}</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-gold" onclick="HM.confirmImportRoster()">Import Selected</button>
      </div>`;
    document.getElementById('overlay').style.display = 'flex';
  }

  function confirmImportRoster() {
    const m = _meet(); if (!m) return;
    const homeSchool = m.schools.find(s => s.isHome); if (!homeSchool) return;

    const checked = [...document.querySelectorAll('#hm-roster-list input[type=checkbox]:checked:not(:disabled)')];
    if (!checked.length) { alert('Select at least one athlete.'); return; }

    let added = 0, skipped = 0;
    checked.forEach(cb => {
      const idx  = parseInt(cb.value);
      const a    = _rosterCache[idx]; if (!a) return;
      const wc   = document.getElementById(`hm-import-wc-${idx}`)?.value   || a.wc   || BOYS_WC[0];
      const disc = document.getElementById(`hm-import-disc-${idx}`)?.value || 'both';

      const schoolEntries = m.entries.filter(e => e.schoolId === homeSchool.id && e.wc === wc);
      if (schoolEntries.length >= 2) { skipped++; return; }

      m.entries.push(_blankEntry(a.name, homeSchool.id, wc, disc, a.id, {
        snatch: _openAttempt(a.snatch),
        cj:     _openAttempt(a.cj),
        bench:  _openAttempt(a.bench),
      }));
      added++;
    });

    _save(); closeModal(); renderMain();
    if (skipped > 0) showToast(`${added} imported, ${skipped} skipped (weight class full)`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WEIGH-IN ACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  function saveWeighIn(entryId) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const val = parseFloat(document.getElementById('wi-' + entryId)?.value);
    e.weighIn = isNaN(val) || val <= 0 ? null : val;

    // Visual feedback — border turns gold when filled
    const input = document.getElementById('wi-' + entryId);
    if (input) input.style.borderColor = e.weighIn !== null ? 'var(--gold-a50)' : 'var(--dark3)';
    _save();
  }

  function saveOpen(entryId, lift) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const inputId = lift === 'snatch' ? 'snopen-' : lift === 'cj' ? 'cjopen-' : 'benchopen-';
    const val     = parseInt(document.getElementById(inputId + entryId)?.value) || 0;
    if (lift === 'snatch')    e.snatchOpen = val;
    else if (lift === 'cj')   e.cjOpen     = val;
    else                      e.benchOpen  = val;
    _save();
  }

  function proceedToCompetition() {
    const m = _meet(); if (!m) return;
    if (m.entries.some(e => e.weighIn === null)) {
      alert('All athletes must be weighed in before starting competition.'); return;
    }
    // Copy opening attempts into attempt slots
    m.entries.forEach(e => {
      if (e.snatchOpen > 0) e.snatch[0].declared = e.snatchOpen;
      if (e.cjOpen     > 0) e.cj[0].declared     = e.cjOpen;
      if (e.benchOpen  > 0) e.bench[0].declared   = e.benchOpen;
    });
    m.status = 'snatch';
    _save();
    showToast('Competition started — live runner coming in Phase 2!');
    renderMain();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════

  function openMeet(id) {
    _activeMeetId = id;
    const m = _meet(); if (!m) return;
    _view = (m.status === 'setup') ? 'setup' : 'weighin';
    renderMain();
  }

  function backToList() {
    autoSaveSetup();
    _view = 'list';
    renderMain();
  }

  function backToSetup() {
    _view = 'setup';
    renderMain();
  }

  function deleteMeet(id) {
    if (!confirm('Delete this meet and all its data? This cannot be undone.')) return;
    _meets = _meets.filter(m => m.id !== id);
    if (_activeMeetId === id) { _activeMeetId = null; _view = 'list'; }
    _save();
    renderMain();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════
  return {
    buildHTML,
    // List
    newMeet,
    openMeet,
    deleteMeet,
    // Setup
    autoSaveSetup,
    saveSetupAndProceed,
    openAddSchoolModal,
    saveSchool,
    removeSchool,
    openAddEntryModal,
    saveEntry,
    removeEntry,
    openImportRosterModal,
    confirmImportRoster,
    backToList,
    backToSetup,
    // Weigh-in
    saveWeighIn,
    saveOpen,
    proceedToCompetition,
  };
})();
