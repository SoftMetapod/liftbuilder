'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  HOST MEET  —  Phase 1 + Phase 2: Setup, Weigh-In & Live Competition
// ═══════════════════════════════════════════════════════════════════════════

const HM = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────
  const GIRLS_WC = ['101','110','119','129','139','154','169','183','199','UNL'];
  const BOYS_WC  = ['119','129','139','154','169','183','199','219','238','HWT'];

  const STATUS_LABEL = {
    setup:      'Setup',
    'weigh-in': 'Weigh-In',
    snatch:     'Snatch',
    cj:         'Clean & Jerk',
    bench:      'Bench',
    complete:   'Complete',
  };

  // ── Module state ───────────────────────────────────────────────────────────
  let _meets              = [];
  let _activeMeetId       = null;
  let _view               = 'list';   // list | setup | weighin | competition | results | stats
  let _rosterCache        = [];
  let _scoreTab           = 'olympic'; // olympic | traditional | team
  let _activeFlight       = 'A';      // 'A' | 'B'
  let _barWeight          = null;     // current weight loaded on the bar
  let _checkedIn          = new Set(); // 'entryId:attemptIdx' — athletes checked in for current bar/round
  let _attemptRound       = 1;        // 1 | 2 | 3 — manually controlled by director
  let _timerEndMs         = null;
  let _timerPausedRem     = null;
  let _timerInterval      = null;

  // ── Persistence ────────────────────────────────────────────────────────────
  const STORE_KEY         = 'liftbuilder_hosted_meets';
  const DISPLAY_STATE_KEY = 'liftbuilder_display_state';

  function _save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(_meets)); } catch(e) {}
    _saveDisplayState();
  }
  function _saveDisplayState() {
    try {
      localStorage.setItem(DISPLAY_STATE_KEY, JSON.stringify({
        checkedIn:    [..._checkedIn],
        activeFlight: _activeFlight,
        barWeight:    _barWeight,
        attemptRound: _attemptRound,
      }));
    } catch(e) {}
  }
  function _load() { try { const r = localStorage.getItem(STORE_KEY); if (r) _meets = JSON.parse(r); } catch(e) { _meets = []; } }

  // ── Core helpers ───────────────────────────────────────────────────────────
  function _meet() { return _meets.find(m => m.id === _activeMeetId) || null; }
  function _uid(p) { return p + '_' + Date.now() + '_' + Math.floor(Math.random() * 9999); }
  function _wcs(gender) { return gender === 'Girls' ? GIRLS_WC : BOYS_WC; }

  function _blankEntry(name, schoolId, wc, discipline, athleteId, defaults) {
    return {
      id: _uid('ent'), athleteId: athleteId || null,
      name, schoolId, wc, discipline,
      flight: 'A',
      weighIn: null,
      snatchOpen: defaults?.snatch || 0,
      cjOpen:     defaults?.cj     || 0,
      benchOpen:  defaults?.bench  || 0,
      snatch: [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
      cj:     [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
      bench:  [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
    };
  }

  function _openAttempt(max) {
    if (!max) return 0;
    return Math.round(max * 0.9 / 5) * 5;
  }

  // ── Competition helpers ────────────────────────────────────────────────────
  function _eligibleForLift(e, lift) {
    if (lift === 'snatch') return e.discipline === 'both' || e.discipline === 'olympic' || e.discipline === 'exhibition';
    if (lift === 'cj')     return true;
    if (lift === 'bench')  return e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition';
    return false;
  }

  function _curIdx(e, lift) { return e[lift].findIndex(a => a.result === null); }

  function _flightOrder(m, lift) {
    return m.entries
      .filter(e => _eligibleForLift(e, lift) && _curIdx(e, lift) >= 0 && (!m.useFlights || (e.flight||'A') === _activeFlight))
      .sort((a, b) => {
        const ai = _curIdx(a, lift), bi = _curIdx(b, lift);
        const aw = a[lift][ai].declared || 9999, bw = b[lift][bi].declared || 9999;
        return aw !== bw ? aw - bw : ai !== bi ? ai - bi : (a.weighIn || 999) - (b.weighIn || 999);
      });
  }

  function _minDeclared(m, lift) {
    const vals = m.entries
      .filter(e => _eligibleForLift(e, lift))
      .map(e => { const idx = _curIdx(e, lift); return idx >= 0 ? e[lift][idx].declared : 0; })
      .filter(w => w > 0);
    return vals.length ? Math.min(...vals) : null;
  }

  function _phaseComplete(m, lift) {
    return m.entries.filter(e => _eligibleForLift(e, lift)).every(e => e[lift].every(a => a.result !== null));
  }

  function _bestMade(attempts) {
    const w = attempts.filter(a => a.result === 'good').map(a => a.declared);
    return w.length ? Math.max(...w) : 0;
  }

  function _teamPoints(numTeams) {
    if (numTeams >= 5) return [7, 5, 4, 3, 2, 1];
    if (numTeams === 4) return [6, 4, 3, 2, 1];
    if (numTeams === 3) return [5, 3, 2, 1];
    return [5, 3, 1]; // 2 or fewer teams
  }

  function _olympicTotal(e) {
    const s = _bestMade(e.snatch), c = _bestMade(e.cj);
    return (s > 0 && c > 0) ? s + c : 0;
  }

  function _traditionalTotal(e) {
    const c = _bestMade(e.cj), b = _bestMade(e.bench);
    return (c > 0 && b > 0) ? c + b : 0;
  }

  function _dots(attempts, curIdx) {
    return attempts.map((a, i) => {
      let col, sym;
      if      (a.result === 'good') { col = '#5EC08A'; sym = '✓'; }
      else if (a.result === 'miss') { col = '#E07070'; sym = '✗'; }
      else if (i === curIdx)        { col = 'var(--gold)'; sym = '●'; }
      else                          { col = '#444'; sym = '○'; }
      return `<span style="color:${col};font-size:13px;margin-right:1px;">${sym}</span>`;
    }).join('');
  }

  function _fmtTimer() {
    const rem = _timerEndMs ? (_timerPausedRem !== null ? _timerPausedRem : Math.max(0, _timerEndMs - Date.now()))
              : (_timerPausedRem !== null ? _timerPausedRem : null);
    if (rem === null) return '—';
    return Math.floor(rem / 60000) + ':' + String(Math.floor((rem % 60000) / 1000)).padStart(2, '0');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PUBLIC: buildHTML
  // ══════════════════════════════════════════════════════════════════════════
  function buildHTML() {
    _load();
    if (_view === 'setup')       return _buildSetupHTML();
    if (_view === 'weighin')     return _buildWeighInHTML();
    if (_view === 'competition') return _buildCompetitionHTML();
    if (_view === 'results')     return _buildResultsHTML();
    if (_view === 'stats')       return _buildStatsHTML();
    return _buildListHTML();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════
  function _buildListHTML() {
    const cards = _meets.length
      ? _meets.slice().reverse().map(m => {
          const sc = m.status === 'complete' ? '#5EC08A' : m.status === 'setup' ? '#888' : '#C9A84C';
          const weighed = m.entries.filter(e => e.weighIn !== null).length;
          return `
            <div class="chart-card" style="margin-bottom:1rem;cursor:pointer;transition:border-color .15s;"
              onmouseenter="this.style.borderColor='var(--gold-a40)'" onmouseleave="this.style.borderColor=''"
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
                  <span style="font-size:11px;padding:3px 10px;border-radius:3px;background:${sc}22;color:${sc};font-family:'Barlow Condensed',sans-serif;font-weight:600;letter-spacing:.5px;">${(STATUS_LABEL[m.status]||m.status).toUpperCase()}</span>
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
        <button onclick="HM.showStats()" class="btn btn-outline" style="font-size:13px;">📊 Stats</button>
        <button onclick="HM.newMeet()" class="btn btn-gold" style="font-size:13px;margin-left:8px;">+ New Meet</button>
      </div>
      <div style="max-width:800px;">${cards}</div>`;
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
      const ef = e.flight || 'A';
      return `<tr style="border-bottom:1px solid var(--dark3);">
        <td style="padding:8px 10px;font-weight:500;">${esc(e.name)}</td>
        <td style="padding:8px 10px;color:var(--muted);font-size:13px;">${esc(school?.name||'—')}</td>
        <td style="padding:8px 10px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:600;">${e.wc}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:var(--muted);">${{both:'Both',traditional:'Traditional',olympic:'Olympic',exhibition:'Exhibition'}[e.discipline]||e.discipline}</td>
        ${m.useFlights ? `
        <td style="padding:8px 10px;text-align:center;">
          <div style="display:inline-flex;border-radius:4px;overflow:hidden;border:1px solid var(--dark3);">
            <button onclick="HM.setEntryFlight('${e.id}','A')"
              style="padding:2px 9px;border:none;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;background:${ef==='A'?'var(--gold)':'var(--dark3)'};color:${ef==='A'?'#000':'var(--muted)'};">A</button>
            <button onclick="HM.setEntryFlight('${e.id}','B')"
              style="padding:2px 9px;border:none;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;background:${ef==='B'?'var(--gold)':'var(--dark3)'};color:${ef==='B'?'#000':'var(--muted)'};">B</button>
          </div>
        </td>` : ''}
        <td style="padding:8px 10px;text-align:right;">
          <button onclick="HM.removeEntry('${e.id}')"
            style="background:none;border:none;cursor:pointer;color:#555;font-size:12px;padding:2px 5px;"
            onmouseenter="this.style.color='#E07070'" onmouseleave="this.style.color='#555'">✕</button>
        </td>
      </tr>`;
    }).join('');

    const hasHome    = m.schools.some(s => s.isHome);
    const canProceed = m.name.trim() && m.schools.length >= 2 && m.entries.length > 0;

    return `
      <div class="week-bar">
        <button onclick="HM.backToList()"
          style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
          onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← Back</button>
        <div class="week-title" style="margin-left:12px;">Meet Setup</div>
        <div style="flex:1;"></div>
        <button onclick="HM.saveSetupAndProceed()" class="btn btn-gold" style="font-size:13px;"
          ${canProceed?'':'disabled'} title="${canProceed?'Proceed to weigh-in':'Requires: meet name, 2+ schools, 1+ athlete'}">
          Proceed to Weigh-In →
        </button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;max-width:1000px;">
        <div class="chart-card">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;">Meet Info</div>
          <div class="form-field">
            <label>Meet Name</label>
            <input type="text" id="hm-name" value="${esc(m.name)}" placeholder="e.g. District 4A Invitational" oninput="HM.autoSaveSetup()">
          </div>
          <div class="fg2">
            <div class="form-field"><label>Date</label><input type="date" id="hm-date" value="${m.date}" oninput="HM.autoSaveSetup()"></div>
            <div class="form-field"><label>Gender</label>
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

        <div class="chart-card">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;">Schools (${m.schools.length})</div>
          ${schoolRows || `<div style="font-size:13px;color:var(--muted);margin-bottom:.75rem;font-style:italic;">No schools added yet.</div>`}
          <div style="display:flex;gap:8px;margin-top:.75rem;flex-wrap:wrap;">
            <button onclick="HM.openAddSchoolModal(true)" class="btn btn-gold" style="font-size:12px;padding:5px 12px;" ${hasHome?'disabled':''}>+ Home School</button>
            <button onclick="HM.openAddSchoolModal(false)" class="btn btn-outline" style="font-size:12px;padding:5px 12px;">+ Visiting School</button>
          </div>
          ${m.schools.length < 2 ? `<div style="font-size:11px;color:#C9A84C;margin-top:8px;">⚠ At least 2 schools required.</div>` : ''}
        </div>
      </div>

      <div class="chart-card" style="max-width:1000px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);">Entries (${m.entries.length})</div>
            <button onclick="HM.toggleFlights()"
              style="font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:600;border:1px solid ${m.useFlights?'var(--gold)':'var(--dark3)'};background:${m.useFlights?'var(--gold-a15)':'var(--dark3)'};color:${m.useFlights?'var(--gold)':'var(--muted)'};">
              ${m.useFlights ? '✓ Two Flights (A/B)' : 'Two Flights (A/B)'}
            </button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${hasHome ? `<button onclick="HM.openImportRosterModal()" class="btn btn-outline" style="font-size:12px;padding:5px 12px;">⬆ Import from Roster</button>` : ''}
            <button onclick="HM.openAddEntryModal()" class="btn btn-gold" style="font-size:12px;padding:5px 12px;" ${m.schools.length?'':'disabled'}>+ Add Athlete</button>
          </div>
        </div>
        ${m.entries.length ? `
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid var(--dark3);">
              <th style="text-align:left;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Athlete</th>
              <th style="text-align:left;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">School</th>
              <th style="text-align:center;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Wt Class</th>
              <th style="text-align:center;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Discipline</th>
              ${m.useFlights ? `<th style="text-align:center;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Flight</th>` : ''}
              <th></th>
            </tr></thead>
            <tbody>${entryRows}</tbody>
          </table>` : `
          <div class="empty-msg" style="padding:2rem;">
            No athletes entered yet. ${m.schools.length ? 'Use "Import from Roster" or "+ Add Athlete".' : 'Add schools above first.'}
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

    const byWC = {};
    wcs.forEach(wc => { if (m.entries.some(e => e.wc === wc)) byWC[wc] = []; });
    m.entries.forEach(e => { if (!byWC[e.wc]) byWC[e.wc] = []; byWC[e.wc].push(e); });

    const wcSections = Object.entries(byWC).map(([wc, entries]) => {
      const allWeighed = entries.every(e => e.weighIn !== null);
      const rows = entries.map(e => {
        const school     = m.schools.find(s => s.id === e.schoolId);
        const weighed    = e.weighIn !== null;
        const needSnatch = e.discipline === 'both' || e.discipline === 'olympic' || e.discipline === 'exhibition';
        const needBench  = e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition';
        return `<tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:9px 12px;">
            <div style="font-weight:500;font-size:14px;">${esc(e.name)}${m.useFlights?` <span style="font-size:10px;padding:1px 5px;border-radius:3px;background:var(--gold-a15);color:var(--gold);font-family:'Barlow Condensed',sans-serif;font-weight:700;">FLT ${e.flight||'A'}</span>`:''}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(school?.name||'')} · ${{both:'Both',traditional:'Traditional',olympic:'Olympic',exhibition:'Exhibition'}[e.discipline]||e.discipline}</div>
          </td>
          <td style="padding:9px 12px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="number" id="wi-${e.id}" value="${e.weighIn !== null ? e.weighIn : ''}"
                min="50" max="500" step="0.1" placeholder="—"
                style="width:75px;background:var(--dark);color:var(--white);border:1px solid ${weighed?'var(--gold-a50)':'var(--dark3)'};border-radius:4px;padding:5px 7px;font-size:14px;font-family:'Barlow Condensed',sans-serif;"
                oninput="HM.saveWeighIn('${e.id}')">
              <span style="font-size:11px;color:var(--muted);">lbs</span>
              <span id="hm-wi-check-${e.id}" style="color:${weighed?'#5EC08A':'#555'};font-size:${weighed?'15':'12'}px;">${weighed?'✓':'—'}</span>
            </div>
          </td>
          <td style="padding:9px 12px;">
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${needSnatch ? `
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
              ${needBench ? `
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
              background:${allWeighed?'#5EC08A22':'rgba(200,168,76,0.15)'};color:${allWeighed?'#5EC08A':'#C9A84C'};">
              ${allWeighed ? 'ALL WEIGHED IN' : `${entries.filter(e=>e.weighIn!==null).length}/${entries.length} WEIGHED IN`}
            </span>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid var(--dark3);">
              <th style="text-align:left;padding:5px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Athlete</th>
              <th style="text-align:left;padding:5px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Weigh-In</th>
              <th style="text-align:left;padding:5px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Opening Attempts</th>
            </tr></thead>
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
        <span id="hm-wi-counter" style="font-size:13px;color:var(--muted);margin-right:14px;">${totalWeighed} / ${m.entries.length} weighed in</span>
        <button id="hm-wi-proceed-btn" onclick="HM.proceedToCompetition()" class="btn btn-gold" style="font-size:13px;"
          ${allDone?'':'disabled'} title="${allDone?'Start the competition':'All athletes must be weighed in first'}">
          Begin Competition →
        </button>
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:1.25rem;padding:10px 14px;background:var(--dark2);border:1px solid var(--dark3);border-left:3px solid var(--gold);border-radius:4px;max-width:900px;">
        Record each athlete's actual weigh-in weight and opening attempts. C&J is required for all athletes regardless of discipline.
      </div>
      ${wcSections || '<div class="empty-msg">No entries found.</div>'}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COMPETITION VIEW
  // ══════════════════════════════════════════════════════════════════════════
  function _buildCompetitionHTML() {
    const m = _meet();
    if (!m) { _view = 'list'; return _buildListHTML(); }
    const lift      = m.status;
    const liftLabel = STATUS_LABEL[lift] || lift;
    const flight    = _flightOrder(m, lift);

    // Split into checked-in (active queue) and waiting (must check in first)
    const checkedIn = flight.filter(e => _checkedIn.has(e.id + ':' + _curIdx(e, lift)));
    const waiting   = flight.filter(e => !_checkedIn.has(e.id + ':' + _curIdx(e, lift)));
    const current   = checkedIn[0] || null;
    const onDeck    = checkedIn.slice(1);

    // Next bar weight suggestion — always +5 lbs
    const nextBarWeight = _barWeight ? _barWeight + 5 : null;

    const roundOrd    = ['1st','2nd','3rd'];
    const nextRoundOrd = roundOrd[_attemptRound]; // e.g. '2nd' when currently on 1st

    // Bar control
    const barControlHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--dark2);border-radius:6px;margin-bottom:.75rem;border:1px solid var(--dark3);flex-wrap:wrap;">
        <span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;color:var(--gold);">BAR WEIGHT</span>
        <input type="number" id="hm-bar-input" value="${_barWeight||''}" min="45" step="5" placeholder="—"
          style="width:80px;background:var(--dark);color:var(--white);border:1px solid var(--gold-a50);border-radius:4px;padding:5px 8px;font-size:18px;font-family:'Barlow Condensed',sans-serif;font-weight:700;text-align:right;"
          onkeydown="if(event.key==='Enter') HM.setBarWeight(this.value)">
        <span style="font-size:13px;color:var(--muted);">lbs</span>
        <button onclick="HM.setBarWeight(document.getElementById('hm-bar-input').value)" class="btn btn-gold" style="font-size:12px;padding:4px 14px;">Load</button>
        <div style="width:1px;background:var(--dark3);height:20px;margin:0 4px;"></div>
        <span style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:var(--white);padding:3px 12px;background:var(--dark3);border-radius:4px;">
          ${roundOrd[_attemptRound-1]} Attempt
        </span>
        ${_attemptRound < 3 ? `
        <button onclick="HM.advanceAttemptRound()" class="btn btn-outline" style="font-size:12px;padding:4px 14px;">
          → ${nextRoundOrd} Attempt
        </button>` : ''}
        ${checkedIn.length === 0 && nextBarWeight ? `
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:var(--muted);">Next weight:</span>
          <button onclick="HM.setBarWeight(${nextBarWeight})" class="btn btn-outline" style="font-size:13px;padding:5px 16px;font-family:'Barlow Condensed',sans-serif;font-weight:700;">
            Load ${nextBarWeight} lbs →
          </button>
        </div>` : ''}
      </div>`;

    // NOW LIFTING card
    let nowHTML = '';
    if (current) {
      const idx     = _curIdx(current, lift);
      const att     = current[lift][idx];
      const school  = m.schools.find(s => s.id === current.schoolId);
      const ordinal = ['1st','2nd','3rd'][idx] || (idx+1)+'th';
      nowHTML = `
        <div style="background:var(--dark2);border:2px solid var(--gold);border-radius:8px;padding:1.25rem 1.5rem;margin-bottom:1rem;">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;color:var(--gold);margin-bottom:.5rem;">NOW LIFTING</div>
          <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-size:22px;font-weight:700;font-family:'Barlow Condensed',sans-serif;">${esc(current.name)}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px;">${esc(school?.name||'?')} &nbsp;·&nbsp; ${current.wc} lbs &nbsp;·&nbsp; ${ordinal} attempt</div>
              <div style="font-size:30px;font-weight:700;font-family:'Barlow Condensed',sans-serif;margin-top:.4rem;color:var(--gold);">${att.declared} <span style="font-size:16px;color:var(--muted);">lbs</span></div>
            </div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <button onclick="HM.recordResult('${current.id}','${lift}',${idx},'good')"
                style="background:#1e3d2a;border:2px solid #5EC08A;color:#5EC08A;border-radius:6px;padding:14px 26px;font-size:16px;font-weight:700;font-family:'Barlow Condensed',sans-serif;cursor:pointer;"
                onmouseenter="this.style.background='#2a5a3a'" onmouseleave="this.style.background='#1e3d2a'">
                ✓ GOOD LIFT
              </button>
              <button onclick="HM.recordResult('${current.id}','${lift}',${idx},'miss')"
                style="background:#3d1e1e;border:2px solid #E07070;color:#E07070;border-radius:6px;padding:14px 26px;font-size:16px;font-weight:700;font-family:'Barlow Condensed',sans-serif;cursor:pointer;"
                onmouseenter="this.style.background='#5a2a2a'" onmouseleave="this.style.background='#3d1e1e'">
                ✗ NO LIFT
              </button>
            </div>
          </div>
        </div>`;
    } else if (_phaseComplete(m, lift)) {
      nowHTML = `
        <div style="background:var(--dark2);border:2px solid var(--gold-a30);border-radius:8px;padding:1.5rem;margin-bottom:1rem;text-align:center;">
          <div style="font-size:15px;color:var(--muted);margin-bottom:.75rem;">${liftLabel} phase complete — all athletes have finished.</div>
          <button onclick="HM.advancePhase()" class="btn btn-gold" style="font-size:14px;">
            ${lift === 'bench' ? 'Complete Meet ✓' : 'Advance to Next Phase →'}
          </button>
        </div>`;
    } else {
      nowHTML = `
        <div style="background:var(--dark2);border:1px solid var(--dark3);border-radius:8px;padding:1rem 1.5rem;margin-bottom:1rem;text-align:center;color:var(--muted);font-size:14px;">
          ${_barWeight ? `No athletes checked in at <strong style="color:var(--white);">${_barWeight} lbs</strong>.` : 'Set bar weight above to begin.'}
          ${nextBarWeight && checkedIn.length === 0 ? ` Next weight: <strong style="color:var(--white);">${nextBarWeight} lbs</strong>` : ''}
        </div>`;
    }

    // ON DECK table (athletes at bar weight, waiting their turn)
    let queueHTML = '';
    if (onDeck.length) {
      const qRows = onDeck.map((e, qi) => {
        const idx  = _curIdx(e, lift);
        const att  = e[lift][idx];
        const school = m.schools.find(s => s.id === e.schoolId);
        const ord  = ['1st','2nd','3rd'][idx] || (idx+1)+'th';
        return `<tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:8px 10px;font-size:12px;color:var(--muted);text-align:center;">${qi+2}</td>
          <td style="padding:8px 10px;">
            <div style="font-weight:600;font-size:14px;">${esc(e.name)}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(school?.name||'')} · ${e.wc} · ${ord}</div>
          </td>
          <td style="padding:8px 10px;">${_dots(e[lift], idx)}</td>
          <td style="padding:8px 10px;text-align:right;white-space:nowrap;">
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;">${att.declared || '—'}</span>
            <span style="font-size:11px;color:var(--muted);">lbs</span>
          </td>
          <td style="padding:8px 6px;text-align:center;white-space:nowrap;">
            <button onclick="HM.passAttempt('${e.id}','${lift}')"
              style="background:none;border:1px solid #C9A84C;border-radius:3px;cursor:pointer;color:#C9A84C;font-size:10px;padding:2px 7px;font-family:'Barlow Condensed',sans-serif;font-weight:600;margin-right:4px;"
              onmouseenter="this.style.background='rgba(201,168,76,0.15)'" onmouseleave="this.style.background='none'">PASS</button>
            <button onclick="HM.scratchEntry('${e.id}','${lift}')"
              style="background:none;border:none;cursor:pointer;color:#555;font-size:10px;padding:2px 4px;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
              onmouseenter="this.style.color='#E07070'" onmouseleave="this.style.color='#555'">SCRATCH</button>
          </td>
        </tr>`;
      }).join('');
      queueHTML = `
        <div class="chart-card" style="padding:0;overflow:hidden;margin-bottom:.75rem;">
          <div style="padding:8px 12px;border-bottom:1px solid var(--dark3);font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:600;letter-spacing:1px;color:var(--muted);">ON DECK</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:1px solid var(--dark3);">
              <th style="padding:4px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">#</th>
              <th style="text-align:left;padding:4px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">Athlete</th>
              <th style="text-align:left;padding:4px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">Atts</th>
              <th style="text-align:right;padding:4px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">Declared</th>
              <th></th>
            </tr></thead>
            <tbody>${qRows}</tbody>
          </table>
        </div>`;
    }

    // WAITING section (athletes at higher declared weights)
    let waitingHTML = '';
    if (waiting.length) {
      const wRows = waiting.map(e => {
        const idx  = _curIdx(e, lift);
        const att  = e[lift][idx];
        const school = m.schools.find(s => s.id === e.schoolId);
        const ord  = ['1st','2nd','3rd'][idx] || (idx+1)+'th';
        return `<tr style="border-bottom:1px solid var(--dark3);opacity:0.55;">
          <td style="padding:7px 10px;font-size:13px;font-weight:500;">${esc(e.name)}</td>
          <td style="padding:7px 10px;font-size:11px;color:var(--muted);">${esc(school?.name||'')} · ${e.wc} · ${ord}</td>
          <td style="padding:7px 10px;">${_dots(e[lift], idx)}</td>
          <td style="padding:7px 10px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;">
            ${att.declared || '—'} <span style="font-size:11px;color:var(--muted);font-weight:400;">lbs</span>
          </td>
          <td style="padding:7px 6px;text-align:center;white-space:nowrap;">${(() => {
            const blocked    = _barWeight ? _checkInBlocked(e, lift) : null;
            const rightRound = _barWeight && idx === _attemptRound - 1;
            if (blocked) {
              const done = e[lift].filter(a => a.result !== null);
              const highest = done.length ? Math.max(...done.map(a => a.declared)) : 0;
              const label = _barWeight < highest ? `LIFTED ${highest}` : 'MADE THIS WT';
              return `<span style="font-size:10px;color:var(--muted);font-family:'Barlow Condensed',sans-serif;margin-right:4px;">${label}</span>`;
            }
            if (rightRound)  return `<button onclick="HM.checkIn('${e.id}','${lift}')"
              style="background:none;border:1px solid #5EC08A;border-radius:3px;cursor:pointer;color:#5EC08A;font-size:10px;padding:2px 7px;font-family:'Barlow Condensed',sans-serif;font-weight:600;margin-right:4px;"
              onmouseenter="this.style.background='rgba(94,192,138,0.15)'" onmouseleave="this.style.background='none'">CHECK IN</button>`;
            if (_barWeight)  return `<button onclick="HM.overrideCheckIn('${e.id}','${lift}')"
              style="background:none;border:1px solid #888;border-radius:3px;cursor:pointer;color:#888;font-size:10px;padding:2px 7px;font-family:'Barlow Condensed',sans-serif;font-weight:600;margin-right:4px;"
              onmouseenter="this.style.borderColor='#C9A84C';this.style.color='#C9A84C'" onmouseleave="this.style.borderColor='#888';this.style.color='#888'">OVERRIDE</button>`;
            return '';
          })()}
            <button onclick="HM.scratchEntry('${e.id}','${lift}')"
              style="background:none;border:none;cursor:pointer;color:#555;font-size:10px;padding:2px 4px;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
              onmouseenter="this.style.color='#E07070'" onmouseleave="this.style.color='#555'">SCRATCH</button>
          </td>
        </tr>`;
      }).join('');
      waitingHTML = `
        <div class="chart-card" style="padding:0;overflow:hidden;margin-bottom:.75rem;">
          <div style="padding:8px 12px;border-bottom:1px solid var(--dark3);font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:600;letter-spacing:1px;color:var(--muted);">WAITING</div>
          <table style="width:100%;border-collapse:collapse;"><tbody>${wRows}</tbody></table>
        </div>`;
    }

    // COMPLETED section
    const done = m.entries.filter(e => _eligibleForLift(e, lift) && _curIdx(e, lift) < 0);
    let doneHTML = '';
    if (done.length) {
      const dRows = done.map(e => {
        const best   = _bestMade(e[lift]);
        const school = m.schools.find(s => s.id === e.schoolId);
        return `<tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:7px 10px;font-size:14px;font-weight:500;">${esc(e.name)}</td>
          <td style="padding:7px 10px;font-size:12px;color:var(--muted);">${esc(school?.name||'')} · ${e.wc}</td>
          <td style="padding:7px 10px;">${_dots(e[lift], -1)}</td>
          <td style="padding:7px 10px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:${best?'var(--gold)':'#E07070'};">${best ? best+' lbs' : 'Bomb'}</td>
        </tr>`;
      }).join('');
      doneHTML = `
        <div class="chart-card" style="padding:0;overflow:hidden;">
          <div style="padding:8px 12px;border-bottom:1px solid var(--dark3);font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:600;letter-spacing:1px;color:var(--muted);">COMPLETED — ${liftLabel.toUpperCase()}</div>
          <table style="width:100%;border-collapse:collapse;"><tbody>${dRows}</tbody></table>
        </div>`;
    }

    // Timer
    const timerRunning = _timerEndMs !== null && _timerPausedRem === null;
    const hasTimer     = _timerEndMs !== null || _timerPausedRem !== null;
    const timerColor   = !hasTimer ? 'var(--muted)' : 'var(--white)';
    const timerHTML = `
      <div style="display:flex;align-items:center;gap:7px;">
        <span id="hm-timer-display" style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;min-width:48px;color:${timerColor};">${_fmtTimer()}</span>
        <button onclick="HM.startTimer(60)"  class="btn btn-outline" style="font-size:11px;padding:3px 8px;">1 min</button>
        <button onclick="HM.startTimer(120)" class="btn btn-outline" style="font-size:11px;padding:3px 8px;">2 min</button>
        ${hasTimer ? `
          <button onclick="HM.pauseResumeTimer()" class="btn btn-outline" style="font-size:11px;padding:3px 8px;">${timerRunning?'Pause':'Resume'}</button>
          <button onclick="HM.resetTimer()" class="btn btn-outline" style="font-size:11px;padding:3px 8px;color:#E07070;border-color:#E07070;">✕</button>` : ''}
      </div>`;

    const phaseComplete = _phaseComplete(m, lift);

    return `
      <div class="week-bar">
        <button onclick="HM.backToWeighIn()"
          style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
          onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← Weigh-In</button>
        <div class="week-title" style="margin-left:12px;font-size:16px;">${esc(m.name)}</div>
        <span style="margin-left:8px;font-family:'Barlow Condensed',sans-serif;font-size:12px;padding:3px 10px;border-radius:4px;background:var(--gold-a15);color:var(--gold);font-weight:600;">${liftLabel.toUpperCase()}</span>
        <div style="flex:1;"></div>
        ${timerHTML}
        <div style="width:1px;background:var(--dark3);height:24px;margin:0 10px;"></div>
        <button onclick="HM.openDisplayWindow()" class="btn btn-outline" style="font-size:12px;padding:5px 10px;" title="Open live display window">📺 Display</button>
        <button onclick="HM.advancePhase()" class="btn btn-gold" style="font-size:13px;margin-left:6px;" ${phaseComplete?'':'disabled'}
          title="${phaseComplete?'Move to next phase':'All athletes must finish this lift first'}">
          ${lift === 'bench' ? 'Complete Meet ✓' : 'Next Phase →'}
        </button>
      </div>
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="display:none" onload="HM._onCompMounted()">
      ${m.useFlights ? `
      <div style="display:flex;gap:0;margin-bottom:1rem;border-radius:6px;overflow:hidden;border:1px solid var(--dark3);width:fit-content;">
        ${['A','B'].map(f => `
          <button onclick="HM._setFlight('${f}')"
            style="padding:8px 28px;border:none;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;letter-spacing:.5px;
              background:${_activeFlight===f?'var(--gold)':'var(--dark3)'};color:${_activeFlight===f?'#000':'var(--muted)'};transition:all .15s;">
            Flight ${f} ${_activeFlight===f?'●':''}
          </button>`).join('')}
      </div>` : ''}
      <div style="display:grid;grid-template-columns:3fr 2fr;gap:1.25rem;align-items:start;">
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;">${liftLabel} — Bar Control</div>
          ${barControlHTML}
          ${nowHTML}
          ${queueHTML}
          ${waitingHTML}
          ${doneHTML}
        </div>
        <div style="position:sticky;top:80px;">${_buildScoreboard(m)}</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SCOREBOARD
  // ══════════════════════════════════════════════════════════════════════════
  function _buildScoreboard(m) {
    const wcs  = _wcs(m.gender);
    const N    = m.schools.length;
    const pts  = _teamPoints(N);

    const thS  = 'padding:3px 7px;font-family:\'Barlow Condensed\',sans-serif;font-size:9px;color:var(--muted);';
    const thSR = thS + 'text-align:right;';

    const tabBtn = (key, label) =>
      `<button onclick="HM._setScoreTab('${key}')"
        style="flex:1;padding:6px 4px;border:none;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:.5px;
        background:${_scoreTab===key?'var(--gold-a15)':'var(--dark3)'};
        color:${_scoreTab===key?'var(--gold)':'var(--muted)'};
        border-bottom:2px solid ${_scoreTab===key?'var(--gold)':'transparent'};">${label}</button>`;

    // ── helpers shared by both individual tabs ────────────────────────────────
    function wcSection(wc, headerRow, bodyRows) {
      return `
        <div style="margin-bottom:.75rem;">
          <div style="padding:4px 7px;background:var(--dark3);font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;">${wc} LBS</div>
          <table style="width:100%;border-collapse:collapse;"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>
        </div>`;
    }

    function teamTable(title, rows) {
      return `
        <div style="margin-bottom:1.25rem;">
          <div style="padding:5px 7px;background:rgba(201,168,76,.12);border-bottom:1px solid var(--gold-a15);font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--gold);">${title}</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th style="${thS}">#</th>
              <th style="${thS}text-align:left;">School</th>
              <th style="${thSR}">PTS</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    let content = '';

    // ── Olympic individual tab ────────────────────────────────────────────────
    if (_scoreTab === 'olympic') {
      const elig = m.entries.filter(e => e.discipline === 'both' || e.discipline === 'olympic');
      content = !elig.length
        ? `<div class="empty-msg" style="padding:1.5rem;font-size:13px;">No Olympic-division athletes.</div>`
        : wcs.filter(wc => elig.some(e => e.wc === wc)).map(wc => {
            const group = elig.filter(e => e.wc === wc)
              .map(e => ({ e, sn: _bestMade(e.snatch), cj: _bestMade(e.cj), tot: _olympicTotal(e) }))
              .sort((a,b) => b.tot - a.tot || b.sn - a.sn);
            let pIdx = -1;
            const rows = group.map(r => {
              if (r.tot > 0) pIdx++;
              const placeNum  = r.tot > 0 ? pIdx + 1 : null;
              const earnedPts = placeNum && pIdx < pts.length ? pts[pIdx] : null;
              const isFirst   = placeNum === 1;
              const sch = m.schools.find(s => s.id === r.e.schoolId);
              return `<tr style="border-bottom:1px solid var(--dark3);">
                <td style="padding:5px 7px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${isFirst?'var(--gold)':'var(--muted)'};">${placeNum||'—'}</td>
                <td style="padding:5px 7px;font-size:13px;">${esc(r.e.name)}</td>
                <td style="padding:5px 7px;font-size:11px;color:var(--muted);">${esc(sch?.name||'')}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:12px;">${r.sn||'—'}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:12px;">${r.cj||'—'}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${r.tot?'var(--gold)':'#E07070'};">${r.tot||'0'}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:11px;color:${earnedPts?'#5EC08A':'var(--muted)'};">${earnedPts!=null?'+'+earnedPts:'—'}</td>
              </tr>`;
            }).join('');
            const hdr = `<tr><th style="${thS}">#</th><th style="${thS}text-align:left;">Athlete</th><th style="${thS}text-align:left;">School</th><th style="${thSR}">SN</th><th style="${thSR}">CJ</th><th style="${thSR}">TOT</th><th style="${thSR}">PTS</th></tr>`;
            return wcSection(wc, hdr, rows);
          }).join('');

    // ── Traditional individual tab ────────────────────────────────────────────
    } else if (_scoreTab === 'traditional') {
      const elig = m.entries.filter(e => e.discipline === 'both' || e.discipline === 'traditional');
      content = !elig.length
        ? `<div class="empty-msg" style="padding:1.5rem;font-size:13px;">No Traditional-division athletes.</div>`
        : wcs.filter(wc => elig.some(e => e.wc === wc)).map(wc => {
            const group = elig.filter(e => e.wc === wc)
              .map(e => ({ e, cj: _bestMade(e.cj), bn: _bestMade(e.bench), tot: _traditionalTotal(e) }))
              .sort((a,b) => b.tot - a.tot || b.cj - a.cj);
            let pIdx = -1;
            const rows = group.map(r => {
              if (r.tot > 0) pIdx++;
              const placeNum  = r.tot > 0 ? pIdx + 1 : null;
              const earnedPts = placeNum && pIdx < pts.length ? pts[pIdx] : null;
              const isFirst   = placeNum === 1;
              const sch = m.schools.find(s => s.id === r.e.schoolId);
              return `<tr style="border-bottom:1px solid var(--dark3);">
                <td style="padding:5px 7px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${isFirst?'var(--gold)':'var(--muted)'};">${placeNum||'—'}</td>
                <td style="padding:5px 7px;font-size:13px;">${esc(r.e.name)}</td>
                <td style="padding:5px 7px;font-size:11px;color:var(--muted);">${esc(sch?.name||'')}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:12px;">${r.cj||'—'}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:12px;">${r.bn||'—'}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${r.tot?'var(--gold)':'#E07070'};">${r.tot||'0'}</td>
                <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:11px;color:${earnedPts?'#5EC08A':'var(--muted)'};">${earnedPts!=null?'+'+earnedPts:'—'}</td>
              </tr>`;
            }).join('');
            const hdr = `<tr><th style="${thS}">#</th><th style="${thS}text-align:left;">Athlete</th><th style="${thS}text-align:left;">School</th><th style="${thSR}">C&amp;J</th><th style="${thSR}">Bench</th><th style="${thSR}">TOT</th><th style="${thSR}">PTS</th></tr>`;
            return wcSection(wc, hdr, rows);
          }).join('');

    // ── Team tab ──────────────────────────────────────────────────────────────
    } else {
      const scores = {};
      m.schools.forEach(s => { scores[s.id] = { id: s.id, name: s.name, olympic: 0, traditional: 0 }; });

      const oElig = m.entries.filter(e => e.discipline === 'both' || e.discipline === 'olympic');
      wcs.filter(wc => oElig.some(e => e.wc === wc)).forEach(wc => {
        const grp = oElig.filter(e => e.wc === wc)
          .map(e => ({ e, tot: _olympicTotal(e) }))
          .sort((a,b) => b.tot - a.tot || _bestMade(b.e.snatch) - _bestMade(a.e.snatch));
        let p = 0;
        grp.forEach(r => {
          if (r.tot > 0 && scores[r.e.schoolId] && p < pts.length) {
            scores[r.e.schoolId].olympic += pts[p++];
          }
        });
      });

      const tElig = m.entries.filter(e => e.discipline === 'both' || e.discipline === 'traditional');
      wcs.filter(wc => tElig.some(e => e.wc === wc)).forEach(wc => {
        const grp = tElig.filter(e => e.wc === wc)
          .map(e => ({ e, tot: _traditionalTotal(e) }))
          .sort((a,b) => b.tot - a.tot || _bestMade(b.e.cj) - _bestMade(a.e.cj));
        let p = 0;
        grp.forEach(r => {
          if (r.tot > 0 && scores[r.e.schoolId] && p < pts.length) {
            scores[r.e.schoolId].traditional += pts[p++];
          }
        });
      });

      const allSchools = Object.values(scores);

      const oSorted = [...allSchools].sort((a,b) => b.olympic - a.olympic);
      const oRows = oSorted.map((s, i) => `
        <tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:6px 8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${i===0&&s.olympic>0?'var(--gold)':'var(--muted)'};">${i+1}</td>
          <td style="padding:6px 8px;font-size:13px;font-weight:600;">${esc(s.name)}</td>
          <td style="padding:6px 8px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:${s.olympic>0?(i===0?'var(--gold)':'var(--white)'):'var(--muted)'};">${s.olympic}</td>
        </tr>`).join('');

      const tSorted = [...allSchools].sort((a,b) => b.traditional - a.traditional);
      const tRows = tSorted.map((s, i) => `
        <tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:6px 8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${i===0&&s.traditional>0?'var(--gold)':'var(--muted)'};">${i+1}</td>
          <td style="padding:6px 8px;font-size:13px;font-weight:600;">${esc(s.name)}</td>
          <td style="padding:6px 8px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:${s.traditional>0?(i===0?'var(--gold)':'var(--white)'):'var(--muted)'};">${s.traditional}</td>
        </tr>`).join('');

      const combined = allSchools.map(s => ({ ...s, total: s.olympic + s.traditional })).sort((a,b) => b.total - a.total);
      const cRows = combined.map((s, i) => `
        <tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:6px 8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${i===0&&s.total>0?'var(--gold)':'var(--muted)'};">${i+1}</td>
          <td style="padding:6px 8px;font-size:13px;font-weight:600;">${esc(s.name)}</td>
          <td style="padding:6px 8px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:12px;color:var(--muted);">${s.olympic} + ${s.traditional}</td>
          <td style="padding:6px 8px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;color:${s.total>0?(i===0?'var(--gold)':'var(--white)'):'var(--muted)'};">${s.total}</td>
        </tr>`).join('');
      const combinedTable = `
        <div style="margin-bottom:1.25rem;">
          <div style="padding:5px 7px;background:rgba(201,168,76,.12);border-bottom:1px solid var(--gold-a15);font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--gold);">COMBINED TOTAL</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th style="${thS}">#</th>
              <th style="${thS}text-align:left;">School</th>
              <th style="${thSR}">OLY + TRAD</th>
              <th style="${thSR}">TOTAL</th>
            </tr></thead>
            <tbody>${cRows}</tbody>
          </table>
        </div>`;

      content = teamTable('OLYMPIC TEAM SCORES', oRows) + teamTable('TRADITIONAL TEAM SCORES', tRows) + combinedTable;
    }

    return `
      <div class="chart-card" style="padding:0;overflow:hidden;">
        <div style="padding:8px 12px;border-bottom:1px solid var(--dark3);font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:600;letter-spacing:1px;color:var(--muted);">LIVE SCOREBOARD</div>
        <div style="display:flex;border-bottom:1px solid var(--dark3);">
          ${tabBtn('olympic','Olympic')}${tabBtn('traditional','Traditional')}${tabBtn('team','Team')}
        </div>
        <div style="padding:.75rem;max-height:60vh;overflow-y:auto;">${content}</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RESULTS VIEW
  // ══════════════════════════════════════════════════════════════════════════
  function _buildResultsHTML() {
    const m = _meet();
    if (!m) { _view = 'list'; return _buildListHTML(); }
    const wcs = _wcs(m.gender);
    const discMap = { both:'Both', traditional:'Traditional', olympic:'Olympic', exhibition:'Exhibition' };

    const wcSections = wcs.filter(wc => m.entries.some(e => e.wc === wc)).map(wc => {
      const entries = m.entries.filter(e => e.wc === wc);
      const rows = entries.map(e => {
        const school   = m.schools.find(s => s.id === e.schoolId);
        const hasSnatch = e.discipline === 'both' || e.discipline === 'olympic' || e.discipline === 'exhibition';
        const hasBench  = e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition';
        const oTot = hasSnatch ? _olympicTotal(e) : null;
        const tTot = hasBench  ? _traditionalTotal(e) : null;
        return `<tr style="border-bottom:1px solid var(--dark3);">
          <td style="padding:8px 10px;font-weight:500;">${esc(e.name)}</td>
          <td style="padding:8px 10px;font-size:12px;color:var(--muted);">${esc(school?.name||'')}</td>
          <td style="padding:8px 10px;font-size:11px;text-align:center;color:var(--muted);">${discMap[e.discipline]||e.discipline}</td>
          ${hasSnatch
            ? `<td style="padding:8px 6px;text-align:center;">${_dots(e.snatch,-1)}</td>
               <td style="padding:8px 6px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:13px;">${_bestMade(e.snatch)||'—'}</td>`
            : `<td colspan="2" style="padding:8px 6px;"></td>`}
          <td style="padding:8px 6px;text-align:center;">${_dots(e.cj,-1)}</td>
          <td style="padding:8px 6px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:13px;">${_bestMade(e.cj)||'—'}</td>
          ${hasBench
            ? `<td style="padding:8px 6px;text-align:center;">${_dots(e.bench,-1)}</td>
               <td style="padding:8px 6px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:13px;">${_bestMade(e.bench)||'—'}</td>`
            : `<td colspan="2" style="padding:8px 6px;"></td>`}
          <td style="padding:8px 10px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;white-space:nowrap;">
            ${oTot !== null ? `<div style="color:${oTot?'var(--gold)':'#E07070'};">O: ${oTot||'0'}</div>` : ''}
            ${tTot !== null ? `<div style="color:${tTot?'var(--gold)':'#E07070'};">T: ${tTot||'0'}</div>` : ''}
          </td>
        </tr>`;
      }).join('');
      return `
        <div class="chart-card" style="margin-bottom:1rem;padding:0;overflow:hidden;">
          <div style="padding:8px 12px;background:var(--dark3);font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;">${wc} LBS</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:1px solid var(--dark3);">
              <th style="text-align:left;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">Athlete</th>
              <th style="text-align:left;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">School</th>
              <th style="text-align:center;padding:6px 6px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">Disc</th>
              <th style="text-align:center;padding:6px 6px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);" colspan="2">Snatch</th>
              <th style="text-align:center;padding:6px 6px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);" colspan="2">C&amp;J</th>
              <th style="text-align:center;padding:6px 6px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);" colspan="2">Bench</th>
              <th style="text-align:right;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);">Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');

    return `
      <div class="week-bar">
        <button onclick="HM.backToList()"
          style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
          onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← All Meets</button>
        <div class="week-title" style="margin-left:12px;">${esc(m.name)} — Results</div>
        <div style="flex:1;"></div>
        <button onclick="HM.printScoreboard()" class="btn btn-outline" style="font-size:12px;padding:5px 12px;">🖨 Print</button>
        <button onclick="HM.openDisplayWindow()" class="btn btn-outline" style="font-size:12px;padding:5px 12px;margin-left:6px;">📺 Display</button>
        <button onclick="HM.syncPRsToRoster()" class="btn btn-outline" style="font-size:12px;padding:5px 12px;margin-left:6px;">↑ Sync PRs</button>
        <button onclick="HM.exportResultsCSV()" class="btn btn-outline" style="font-size:12px;padding:5px 12px;margin-left:6px;">⬇ CSV</button>
      </div>
      <div style="display:grid;grid-template-columns:3fr 2fr;gap:1.25rem;align-items:start;">
        <div>${wcSections}</div>
        <div style="position:sticky;top:80px;">${_buildScoreboard(m)}</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SETUP ACTIONS
  // ══════════════════════════════════════════════════════════════════════════
  function newMeet() {
    const id = _uid('hm');
    _meets.push({ id, name:'', date:'', location:'', gender:'Boys', status:'setup', useFlights:false, schools:[], entries:[] });
    _activeMeetId = id;
    _save();
    _view = 'setup';
    renderMain();
  }

  function autoSaveSetup() {
    const m = _meet(); if (!m) return;
    const n = document.getElementById('hm-name');
    const d = document.getElementById('hm-date');
    const l = document.getElementById('hm-location');
    const g = document.getElementById('hm-gender');
    if (n) m.name     = n.value.trim();
    if (d) m.date     = d.value;
    if (l) m.location = l.value.trim();
    if (g) m.gender   = g.value;
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

  function openAddSchoolModal(isHome) {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    if (isHome && m.schools.some(s => s.isHome)) { alert('A home school is already added.'); return; }
    const defaultName = isHome && typeof team === 'function' ? (team()?.name || '') : '';
    document.getElementById('modal-body').innerHTML = `
      <h3>${isHome ? 'Add Home School' : 'Add Visiting School'}</h3>
      <div class="form-field">
        <label>School Name</label>
        <input type="text" id="hm-school-name" value="${esc(defaultName)}" placeholder="School name" style="font-size:15px;">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-gold" onclick="HM.saveSchool(${isHome})">Add School</button>
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
    const s = m.schools.find(x => x.id === schoolId);
    if (!confirm(`Remove "${s?.name}"? All athletes from this school will also be removed.`)) return;
    m.schools = m.schools.filter(x => x.id !== schoolId);
    m.entries = m.entries.filter(e => e.schoolId !== schoolId);
    _save(); renderMain();
  }

  function openAddEntryModal() {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    const wcs      = _wcs(m.gender);
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
          <select id="hm-ent-wc">${wcs.map(w => `<option value="${w}">${w} lbs</option>`).join('')}</select>
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
    const existing = m.entries.filter(e => e.schoolId === schoolId && e.wc === wc && e.discipline !== 'exhibition');
    if (discipline !== 'exhibition' && existing.length >= 2) {
      const sn = m.schools.find(s => s.id === schoolId)?.name || 'this school';
      alert(`Max 2 competitive lifters per weight class per school. ${sn} already has 2 entries in the ${wc} lb class.`); return;
    }
    m.entries.push(_blankEntry(name, schoolId, wc, discipline, null, null));
    _save(); closeModal(); renderMain();
  }

  function removeEntry(entryId) {
    const m = _meet(); if (!m) return;
    m.entries = m.entries.filter(e => e.id !== entryId);
    _save(); renderMain();
  }

  function openImportRosterModal() {
    const m = _meet(); if (!m) return;
    autoSaveSetup();
    const homeSchool = m.schools.find(s => s.isHome);
    if (!homeSchool) { alert('No home school set.'); return; }
    const all = (typeof state !== 'undefined' ? (state.roster?.athletes || []) : []);
    _rosterCache = all.filter(a => !m.gender || a.gender === m.gender);
    if (!_rosterCache.length) { alert(`No ${m.gender} athletes in your roster.`); return; }
    const wcs  = _wcs(m.gender);
    const rows = _rosterCache.map((a, idx) => {
      const already  = m.entries.some(e => e.athleteId === a.id);
      const athleteWc = String(a.wc || '').trim();
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:5px;background:var(--dark2);margin-bottom:5px;border:1px solid var(--dark3);opacity:${already?'0.4':'1'};">
          <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:${already?'default':'pointer'};">
            <input type="checkbox" value="${idx}" ${already?'disabled checked':''} style="accent-color:var(--gold);width:14px;height:14px;flex-shrink:0;">
            <span style="font-weight:600;color:var(--white);font-size:14px;">${esc(a.name)}</span>
            ${a.wc ? `<span style="color:var(--muted);font-size:12px;">${esc(a.wc)} lbs</span>` : ''}
          </label>
          <select id="hm-import-wc-${idx}" ${already?'disabled':''}
            style="background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 7px;font-size:12px;">
            ${wcs.map(w => `<option value="${w}" ${athleteWc === w ? 'selected' : ''}>${w}</option>`).join('')}
          </select>
          <select id="hm-import-disc-${idx}" ${already?'disabled':''}
            style="background:var(--dark);color:var(--white);border:1px solid var(--dark3);border-radius:3px;padding:3px 7px;font-size:12px;">
            <option value="both">Both</option>
            <option value="traditional">Traditional</option>
            <option value="olympic">Olympic</option>
            <option value="exhibition">Exhibition</option>
          </select>
        </div>`;
    }).join('');
    document.getElementById('modal-body').innerHTML = `
      <h3>Import from Roster</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:1rem;">
        Select athletes to enter. Opening attempts will be pre-filled at 90% of roster maxes.
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
      if (disc !== 'exhibition' && m.entries.filter(e => e.schoolId === homeSchool.id && e.wc === wc && e.discipline !== 'exhibition').length >= 2) { skipped++; return; }
      m.entries.push(_blankEntry(a.name, homeSchool.id, wc, disc, a.id, {
        snatch: _openAttempt(a.snatch), cj: _openAttempt(a.cj), bench: _openAttempt(a.bench),
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
    const input = document.getElementById('wi-' + entryId);
    if (input) input.style.borderColor = e.weighIn !== null ? 'var(--gold-a50)' : 'var(--dark3)';
    const check = document.getElementById('hm-wi-check-' + entryId);
    if (check) {
      check.textContent = e.weighIn !== null ? '✓' : '—';
      check.style.color    = e.weighIn !== null ? '#5EC08A' : '#555';
      check.style.fontSize = e.weighIn !== null ? '15px'   : '12px';
    }
    _save();
    const weighed = m.entries.filter(x => x.weighIn !== null).length;
    const allDone = weighed === m.entries.length && m.entries.length > 0;
    const counter = document.getElementById('hm-wi-counter');
    if (counter) counter.textContent = weighed + ' / ' + m.entries.length + ' weighed in';
    const btn = document.getElementById('hm-wi-proceed-btn');
    if (btn) { btn.disabled = !allDone; btn.title = allDone ? 'Start the competition' : 'All athletes must be weighed in first'; }
  }

  function saveOpen(entryId, lift) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const key = lift === 'snatch' ? 'snopen-' : lift === 'cj' ? 'cjopen-' : 'benchopen-';
    const val = parseInt(document.getElementById(key + entryId)?.value) || 0;
    if (lift === 'snatch') e.snatchOpen = val;
    else if (lift === 'cj') e.cjOpen    = val;
    else                    e.benchOpen  = val;
    _save();
  }

  function proceedToCompetition() {
    const m = _meet(); if (!m) return;
    if (m.entries.some(e => e.weighIn === null)) {
      alert('All athletes must be weighed in before starting competition.'); return;
    }
    if (m.status === 'weigh-in') {
      m.entries.forEach(e => {
        const snEl = document.getElementById('snopen-' + e.id);
        const cjEl = document.getElementById('cjopen-' + e.id);
        const bnEl = document.getElementById('benchopen-' + e.id);
        if (snEl && snEl.value) e.snatchOpen = parseInt(snEl.value) || e.snatchOpen || 0;
        if (cjEl && cjEl.value) e.cjOpen     = parseInt(cjEl.value) || e.cjOpen     || 0;
        if (bnEl && bnEl.value) e.benchOpen  = parseInt(bnEl.value) || e.benchOpen  || 0;
      });
      m.entries.forEach(e => {
        if (e.snatchOpen > 0) e.snatch[0].declared = e.snatchOpen;
        if (e.cjOpen     > 0) e.cj[0].declared     = e.cjOpen;
        if (e.benchOpen  > 0) e.bench[0].declared   = e.benchOpen;
      });
      m.status = 'snatch';
      _save();
      _barWeight = _minDeclared(m, 'snatch');
      _checkedIn.clear();
      _attemptRound = 1;
    } else if (_barWeight === null) {
      _barWeight = _minDeclared(m, m.status);
    }
    _view = 'competition';
    renderMain();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COMPETITION ACTIONS
  // ══════════════════════════════════════════════════════════════════════════
  function recordResult(entryId, lift, attemptIdx, result) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const att = e[lift][attemptIdx]; if (!att) return;
    att.result = result;
    _save();
    const nextIdx = attemptIdx + 1;
    if (nextIdx < 3) {
      const minW = result === 'good' ? att.declared + 5 : att.declared;
      const suggested = result === 'good' ? att.declared + 5 : att.declared;
      e[lift][nextIdx].declared = suggested;
      _save();
      openDeclareModal(entryId, lift, nextIdx, minW, suggested);
    } else {
      renderMain();
    }
  }

  function openDeclareModal(entryId, lift, nextIdx, minW, suggested) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const school  = m.schools.find(s => s.id === e.schoolId);
    const ordinal = ['', '2nd', '3rd'][nextIdx] || (nextIdx+1)+'th';
    document.getElementById('modal-body').innerHTML = `
      <h3>Declare ${ordinal} Attempt — ${STATUS_LABEL[lift]||lift}</h3>
      <div style="font-size:13px;color:var(--muted);margin-bottom:1rem;">${esc(e.name)} · ${esc(school?.name||'')} · ${e.wc} lbs</div>
      <div class="form-field">
        <label>Weight (lbs) — minimum ${minW} lbs</label>
        <input type="number" id="hm-declare-wt" value="${suggested||minW}" min="${minW}" step="5"
          style="font-size:22px;font-family:'Barlow Condensed',sans-serif;font-weight:700;">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="HM.scratchEntry('${entryId}','${lift}');closeModal()">Scratch</button>
        <button class="btn btn-gold" onclick="HM.confirmDeclare('${entryId}','${lift}',${nextIdx},${minW})">Confirm →</button>
      </div>`;
    document.getElementById('overlay').style.display = 'flex';
    setTimeout(() => { const el = document.getElementById('hm-declare-wt'); if(el){el.focus();el.select();} }, 50);
  }

  function confirmDeclare(entryId, lift, nextIdx, minW) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const val = parseInt(document.getElementById('hm-declare-wt')?.value) || 0;
    if (val < minW) { alert(`Weight must be at least ${minW} lbs (5 lb minimum progression).`); return; }
    e[lift][nextIdx].declared = val;
    _save();
    closeModal();
    renderMain();
  }

  function _checkInBlocked(e, lift) {
    const done = e[lift].filter(a => a.result !== null);
    const highest = done.length ? Math.max(...done.map(a => a.declared)) : 0;
    if (_barWeight < highest)
      return `${e.name} has already attempted ${highest} lbs and cannot go back to a lower weight.`;
    if (e[lift].some(a => a.declared === _barWeight && a.result === 'good'))
      return `${e.name} already made a good lift at ${_barWeight} lbs and must declare a higher weight.`;
    return null;
  }

  function checkIn(entryId, lift) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const idx = _curIdx(e, lift); if (idx < 0 || !_barWeight) return;
    const blocked = _checkInBlocked(e, lift);
    if (blocked) { alert(blocked); return; }
    e[lift][idx].declared = _barWeight;
    _checkedIn.add(e.id + ':' + idx);
    _save();
    renderMain();
  }

  function overrideCheckIn(entryId, lift) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const idx = _curIdx(e, lift); if (idx < 0 || !_barWeight) return;
    const blocked = _checkInBlocked(e, lift);
    if (blocked) { alert(blocked); return; }
    const ordinal = ['1st','2nd','3rd'][idx] || (idx+1)+'th';
    const ok = confirm(`OVERRIDE — Missed Attempt Call\n\n${e.name} missed their attempt call.\nAllow their ${ordinal} attempt at ${_barWeight} lbs anyway?`);
    if (!ok) return;
    e[lift][idx].declared = _barWeight;
    _checkedIn.add(e.id + ':' + idx);
    _save();
    renderMain();
  }

  function advanceAttemptRound() {
    if (_attemptRound < 3) {
      _attemptRound++;
      _checkedIn.clear();
      _saveDisplayState();
    }
    renderMain();
  }

  function setBarWeight(w) {
    const val = parseInt(w) || 0;
    if (val > 0) {
      _barWeight = val;
      _checkedIn.clear();
      _attemptRound = 1;
      _saveDisplayState();
    }
    renderMain();
  }

  function passAttempt(entryId, lift) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const idx = _curIdx(e, lift); if (idx < 0) return;
    const minW    = (_barWeight || e[lift][idx].declared) + 5;
    const ordinal = ['1st','2nd','3rd'][idx] || (idx+1)+'th';
    const school  = m.schools.find(s => s.id === e.schoolId);
    document.getElementById('modal-body').innerHTML = `
      <h3>Pass — ${STATUS_LABEL[lift]||lift}</h3>
      <div style="font-size:13px;color:var(--muted);margin-bottom:1rem;">${esc(e.name)} · ${esc(school?.name||'')} · ${e.wc} lbs · ${ordinal} attempt</div>
      <div class="form-field">
        <label>New declared weight (minimum ${minW} lbs)</label>
        <input type="number" id="hm-pass-wt" value="${minW}" min="${minW}" step="5"
          style="font-size:22px;font-family:'Barlow Condensed',sans-serif;font-weight:700;">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-gold" onclick="HM.confirmPass('${entryId}','${lift}',${idx},${minW})">Confirm Pass →</button>
      </div>`;
    document.getElementById('overlay').style.display = 'flex';
    setTimeout(() => { const el = document.getElementById('hm-pass-wt'); if(el){el.focus();el.select();} }, 50);
  }

  function confirmPass(entryId, lift, idx, minW) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const val = parseInt(document.getElementById('hm-pass-wt')?.value) || 0;
    if (val < minW) { alert(`Weight must be at least ${minW} lbs.`); return; }
    e[lift][idx].declared = val;
    _checkedIn.delete(e.id + ':' + idx);
    _save();
    closeModal();
    renderMain();
  }

  function scratchEntry(entryId, lift) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    e[lift].forEach(a => { if (a.result === null) a.result = 'miss'; });
    _save();
    renderMain();
  }

  function updateDeclared(entryId, lift, attemptIdx, rawValue) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    const val  = parseInt(rawValue) || 0;
    const minW = attemptIdx > 0 ? (e[lift][attemptIdx-1].declared || 0) + 5 : 1;
    if (val < minW) return;
    e[lift][attemptIdx].declared = val;
    _save();
  }

  function advancePhase() {
    const m = _meet(); if (!m) return;
    const lift = m.status;
    if (!_phaseComplete(m, lift)) { alert('All athletes must complete their attempts first.'); return; }

    let next;
    if (lift === 'snatch') { next = 'cj'; }
    else if (lift === 'cj') {
      const hasBench = m.entries.some(e => e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition');
      next = hasBench ? 'bench' : 'complete';
    } else { next = 'complete'; }

    const label = next === 'complete' ? 'complete this meet' : `advance to ${STATUS_LABEL[next]}`;
    if (!confirm(`Ready to ${label}? You cannot go back.`)) return;

    m.status = next;
    _save();
    _checkedIn.clear();
    _attemptRound = 1;
    if (next === 'complete') {
      _barWeight = null;
      _view = 'results';
    } else {
      _barWeight = _minDeclared(m, next);
    }
    renderMain();
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
  function startTimer(secs) {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _timerEndMs     = Date.now() + secs * 1000;
    _timerPausedRem = null;
    _timerInterval  = setInterval(_tickTimer, 250);
    _tickTimer();
  }

  function pauseResumeTimer() {
    if (_timerEndMs && _timerPausedRem === null) {
      _timerPausedRem = Math.max(0, _timerEndMs - Date.now());
      _timerEndMs     = null;
      if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    } else if (_timerPausedRem !== null) {
      _timerEndMs     = Date.now() + _timerPausedRem;
      _timerPausedRem = null;
      _timerInterval  = setInterval(_tickTimer, 250);
    }
    _tickTimer();
    const btn = document.querySelector('[onclick="HM.pauseResumeTimer()"]');
    if (btn) btn.textContent = (_timerEndMs !== null) ? 'Pause' : 'Resume';
  }

  function resetTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _timerEndMs     = null;
    _timerPausedRem = null;
    renderMain();
  }

  function _onCompMounted() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    if (_timerEndMs) _timerInterval = setInterval(_tickTimer, 250);
  }

  function _tickTimer() {
    const el = document.getElementById('hm-timer-display');
    if (!el) { if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; } return; }
    if (!_timerEndMs) return;
    const rem  = Math.max(0, _timerEndMs - Date.now());
    const mins = Math.floor(rem / 60000);
    const secs = Math.floor((rem % 60000) / 1000);
    el.textContent = mins + ':' + String(secs).padStart(2, '0');
    el.style.color = rem < 10000 ? '#E07070' : rem < 30000 ? '#C9A84C' : 'var(--white)';
    if (rem === 0) { clearInterval(_timerInterval); _timerInterval = null; _timerEndMs = null; }
  }

  function _setScoreTab(tab) { _scoreTab = tab; renderMain(); }

  // ── Sync PRs to roster ─────────────────────────────────────────────────────
  function syncPRsToRoster() {
    const m = _meet(); if (!m) return;
    if (typeof state === 'undefined') { alert('Cannot access roster.'); return; }
    let updated = 0;
    m.entries.forEach(e => {
      if (!e.athleteId) return;
      const a = (state.roster?.athletes || []).find(x => x.id === e.athleteId);
      if (!a) return;
      const sn = _bestMade(e.snatch), cj = _bestMade(e.cj), bn = _bestMade(e.bench);
      if (sn && sn > (a.snatch || 0)) { a.snatch = sn; updated++; }
      if (cj && cj > (a.cj    || 0)) { a.cj     = cj; updated++; }
      if (bn && bn > (a.bench  || 0)) { a.bench  = bn; updated++; }
    });
    if (typeof saveState === 'function') saveState();
    showToast(updated ? `${updated} PR${updated!==1?'s':''} synced to roster.` : 'No new PRs to sync.');
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────
  function exportResultsCSV() {
    const m = _meet(); if (!m) return;
    const wcs = _wcs(m.gender);
    const rows = [
      ['Meet', m.name], ['Date', m.date], ['Location', m.location], ['Gender', m.gender], [],
      ['Athlete','School','Weight Class','Discipline',
       'Snatch 1','Snatch 2','Snatch 3','Best Snatch',
       'C&J 1','C&J 2','C&J 3','Best C&J',
       'Bench 1','Bench 2','Bench 3','Best Bench',
       'Olympic Total','Traditional Total'],
    ];
    const ordered = [];
    wcs.forEach(wc => m.entries.filter(e => e.wc === wc).forEach(e => ordered.push(e)));
    ordered.forEach(e => {
      const school = m.schools.find(s => s.id === e.schoolId);
      const att = lift => e[lift].map(a => a.result === 'good' ? '+'+a.declared : a.result === 'miss' ? '-'+a.declared : '');
      rows.push([
        e.name, school?.name||'', e.wc, e.discipline,
        ...att('snatch'), _bestMade(e.snatch)||'',
        ...att('cj'),     _bestMade(e.cj)||'',
        ...att('bench'),  _bestMade(e.bench)||'',
        _olympicTotal(e)||'', _traditionalTotal(e)||'',
      ]);
    });
    const csv  = rows.map(r => r.map(c => { const s = String(c??''); return /[,"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = (m.name||'meet').replace(/[^a-z0-9]/gi,'_')+'_results.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PHASE 3: FLIGHTS, STATS, PRINT, DISPLAY
  // ══════════════════════════════════════════════════════════════════════════

  function toggleFlights() {
    const m = _meet(); if (!m) return;
    m.useFlights = !m.useFlights;
    _save(); renderMain();
  }

  function setEntryFlight(entryId, flight) {
    const m = _meet(); if (!m) return;
    const e = m.entries.find(x => x.id === entryId); if (!e) return;
    e.flight = flight;
    _save(); renderMain();
  }

  function _setFlight(f) {
    _activeFlight = f;
    _saveDisplayState();
    renderMain();
  }

  // ── Stats view ─────────────────────────────────────────────────────────────
  function showStats() { _view = 'stats'; renderMain(); }

  function _buildStatsHTML() {
    const completed = _meets.filter(m => m.status === 'complete');

    const map = {}; // key -> { name, entries: [{meet, e}] }
    completed.forEach(m => {
      m.entries.forEach(e => {
        const key = e.athleteId || ('name:' + e.name);
        if (!map[key]) map[key] = { name: e.name, rows: [] };
        map[key].rows.push({ meetName: m.name, date: m.date, gender: m.gender, wc: e.wc, disc: e.discipline,
          sn: _bestMade(e.snatch), cj: _bestMade(e.cj), bn: _bestMade(e.bench),
          oTot: _olympicTotal(e), tTot: _traditionalTotal(e) });
      });
    });

    const athletes = Object.values(map).map(a => {
      const pr = { sn:0, cj:0, bn:0, oTot:0, tTot:0 };
      a.rows.forEach(r => {
        if (r.sn   > pr.sn)   pr.sn   = r.sn;
        if (r.cj   > pr.cj)   pr.cj   = r.cj;
        if (r.bn   > pr.bn)   pr.bn   = r.bn;
        if (r.oTot > pr.oTot) pr.oTot = r.oTot;
        if (r.tTot > pr.tTot) pr.tTot = r.tTot;
      });
      return { name: a.name, meets: a.rows.length, pr, history: a.rows.sort((x,y) => (y.date||'').localeCompare(x.date||'')) };
    }).sort((a, b) => a.name.localeCompare(b.name));

    if (!athletes.length) {
      return `
        <div class="week-bar">
          <button onclick="HM.backToList()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
            onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← Back</button>
          <div class="week-title" style="margin-left:12px;">Athlete Stats</div>
        </div>
        <div class="empty-msg" style="padding:4rem;">No completed meets yet. Stats will appear after you complete a meet.</div>`;
    }

    const rows = athletes.map(a => `
      <tr style="border-bottom:1px solid var(--dark3);">
        <td style="padding:9px 12px;font-weight:600;font-size:14px;">${esc(a.name)}</td>
        <td style="padding:9px 12px;text-align:center;color:var(--muted);font-size:13px;">${a.meets}</td>
        <td style="padding:9px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:14px;">${a.pr.sn||'—'}</td>
        <td style="padding:9px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:14px;">${a.pr.cj||'—'}</td>
        <td style="padding:9px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:14px;">${a.pr.bn||'—'}</td>
        <td style="padding:9px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:${a.pr.oTot?'var(--gold)':'var(--muted)'};">${a.pr.oTot||'—'}</td>
        <td style="padding:9px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:${a.pr.tTot?'var(--gold)':'var(--muted)'};">${a.pr.tTot||'—'}</td>
      </tr>
      <tr style="border-bottom:2px solid var(--dark3);">
        <td colspan="7" style="padding:0 12px 8px 28px;">
          <div style="font-size:11px;color:var(--muted);">
            ${a.history.map(r => `${r.date||'?'} &nbsp;·&nbsp; ${esc(r.meetName)} &nbsp;·&nbsp; ${r.wc} lbs &nbsp;·&nbsp;
              ${r.disc==='both'||r.disc==='olympic' ? `O: ${r.oTot||'bomb'}` : ''}
              ${r.disc==='both' ? ' &nbsp;' : ''}
              ${r.disc==='both'||r.disc==='traditional' ? `T: ${r.tTot||'bomb'}` : ''}`).join('<br>')}
          </div>
        </td>
      </tr>`).join('');

    return `
      <div class="week-bar">
        <button onclick="HM.backToList()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
          onmouseenter="this.style.color='var(--white)'" onmouseleave="this.style.color='var(--muted)'">← Back</button>
        <div class="week-title" style="margin-left:12px;">Athlete Stats</div>
        <div style="flex:1;"></div>
        <span style="font-size:12px;color:var(--muted);">${athletes.length} athlete${athletes.length!==1?'s':''} across ${completed.length} completed meet${completed.length!==1?'s':''}</span>
      </div>
      <div class="chart-card" style="max-width:1000px;padding:0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid var(--dark3);">
            <th style="text-align:left;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Athlete</th>
            <th style="text-align:center;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Meets</th>
            <th style="text-align:center;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Snatch PR</th>
            <th style="text-align:center;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">C&amp;J PR</th>
            <th style="text-align:center;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Bench PR</th>
            <th style="text-align:center;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Olympic PR</th>
            <th style="text-align:center;padding:8px 12px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);">Traditional PR</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Print scoreboard ────────────────────────────────────────────────────────
  function printScoreboard() {
    const m = _meet(); if (!m) return;
    const wcs = _wcs(m.gender);
    const discMap = { both:'Both', traditional:'Traditional', olympic:'Olympic', exhibition:'Exhibition' };

    const numTeams = m.schools.length;
    const scores = {};
    m.schools.forEach(s => { scores[s.id] = { name: s.name, olympic: 0, traditional: 0 }; });

    const pPts = _teamPoints(numTeams);
    const oElig = m.entries.filter(e => e.discipline === 'both' || e.discipline === 'olympic');
    wcs.filter(wc => oElig.some(e => e.wc === wc)).forEach(wc => {
      const grp = oElig.filter(e => e.wc === wc).map(e => ({ e, tot: _olympicTotal(e) })).sort((a,b) => b.tot - a.tot);
      let p = 0; grp.forEach(r => { if (r.tot > 0 && scores[r.e.schoolId] && p < pPts.length) { scores[r.e.schoolId].olympic += pPts[p++]; } });
    });
    const tElig = m.entries.filter(e => e.discipline === 'both' || e.discipline === 'traditional');
    wcs.filter(wc => tElig.some(e => e.wc === wc)).forEach(wc => {
      const grp = tElig.filter(e => e.wc === wc).map(e => ({ e, tot: _traditionalTotal(e) })).sort((a,b) => b.tot - a.tot);
      let p = 0; grp.forEach(r => { if (r.tot > 0 && scores[r.e.schoolId] && p < pPts.length) { scores[r.e.schoolId].traditional += pPts[p++]; } });
    });
    const teamRows = Object.values(scores).map(s => ({ ...s, total: s.olympic + s.traditional })).sort((a,b) => b.total - a.total)
      .map((s, i) => `<tr><td>${i+1}</td><td>${s.name}</td><td>${s.olympic}</td><td>${s.traditional}</td><td><strong>${s.total}</strong></td></tr>`).join('');

    const wcSections = wcs.filter(wc => m.entries.some(e => e.wc === wc)).map(wc => {
      const entries = m.entries.filter(e => e.wc === wc);
      const eRows = entries.map(e => {
        const school = m.schools.find(s => s.id === e.schoolId);
        const att = lift => e[lift].map(a => a.result === 'good' ? `<span style="color:green">+${a.declared}</span>` : a.result === 'miss' ? `<span style="color:red">-${a.declared}</span>` : '—').join(' / ');
        return `<tr>
          <td>${e.name}</td><td>${school?.name||''}</td><td>${discMap[e.discipline]||e.discipline}</td>
          ${e.discipline==='both'||e.discipline==='olympic' ? `<td>${att('snatch')}</td><td>${_bestMade(e.snatch)||'—'}</td>` : '<td colspan="2"></td>'}
          <td>${att('cj')}</td><td>${_bestMade(e.cj)||'—'}</td>
          ${e.discipline==='both'||e.discipline==='traditional' ? `<td>${att('bench')}</td><td>${_bestMade(e.bench)||'—'}</td>` : '<td colspan="2"></td>'}
          <td>${_olympicTotal(e)||''}</td><td>${_traditionalTotal(e)||''}</td>
        </tr>`;
      }).join('');
      return `<h3>${wc} lbs</h3><table><thead><tr><th>Athlete</th><th>School</th><th>Disc</th><th colspan="2">Snatch</th><th colspan="2">C&J</th><th colspan="2">Bench</th><th>O-Tot</th><th>T-Tot</th></tr></thead><tbody>${eRows}</tbody></table>`;
    }).join('');

    const css = `body{font-family:Arial,sans-serif;font-size:11pt;color:#000}h1,h2,h3{margin:.5rem 0}table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}th,td{border:1px solid #ccc;padding:3px 7px;text-align:left}th{background:#f0f0f0;font-size:10pt}@media print{button{display:none}}`;
    const win = window.open('', 'LiftBuilderPrint', 'width=1000,height=750');
    if (!win) { showToast('Allow pop-ups to print.'); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>${m.name} — Results</title><style>${css}</style></head><body>
      <h1>${m.name}</h1>
      <p>${m.gender} &nbsp;|&nbsp; ${m.date||'—'} &nbsp;|&nbsp; ${m.location||''}</p>
      <button onclick="window.print()" style="margin-bottom:1rem;padding:6px 16px;font-size:12pt;cursor:pointer;">🖨 Print</button>
      <h2>Team Scores</h2>
      <table><thead><tr><th>#</th><th>School</th><th>Olympic</th><th>Traditional</th><th>Total</th></tr></thead><tbody>${teamRows}</tbody></table>
      <h2>Individual Results</h2>${wcSections}
    </body></html>`);
    win.document.close();
    win.focus();
  }

  // ── Display window ──────────────────────────────────────────────────────────
  function openDisplayWindow() {
    const m = _meet(); if (!m) return;
    try { localStorage.setItem('liftbuilder_display_meet_id', m.id); } catch(e) {}
    if (window.liftbuilderApp?.openDisplayWindow) {
      window.liftbuilderApp.openDisplayWindow();
    } else {
      showToast('Display window requires the desktop app.');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════
  function openMeet(id) {
    _activeMeetId = id;
    _barWeight    = null;
    _checkedIn.clear();
    _attemptRound = 1;
    const m = _meet(); if (!m) return;
    if      (m.status === 'setup')     _view = 'setup';
    else if (m.status === 'weigh-in')  _view = 'weighin';
    else if (m.status === 'complete')  _view = 'results';
    else                               _view = 'competition';
    renderMain();
  }

  function backToList()    { autoSaveSetup(); _view = 'list';    renderMain(); }
  function backToSetup()   { _view = 'setup';   renderMain(); }
  function backToWeighIn() { _view = 'weighin'; renderMain(); }

  function deleteMeet(id) {
    if (!confirm('Delete this meet and all its data? This cannot be undone.')) return;
    _meets = _meets.filter(m => m.id !== id);
    if (_activeMeetId === id) { _activeMeetId = null; _view = 'list'; }
    _save(); renderMain();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════
  return {
    buildHTML,
    // List
    newMeet, openMeet, deleteMeet,
    // Setup
    autoSaveSetup, saveSetupAndProceed,
    openAddSchoolModal, saveSchool, removeSchool,
    openAddEntryModal, saveEntry, removeEntry,
    openImportRosterModal, confirmImportRoster,
    backToList, backToSetup, backToWeighIn,
    // Weigh-in
    saveWeighIn, saveOpen, proceedToCompetition,
    // Competition
    recordResult, openDeclareModal, confirmDeclare,
    checkIn, overrideCheckIn, advanceAttemptRound, setBarWeight, passAttempt, confirmPass,
    scratchEntry, advancePhase,
    // Timer
    startTimer, pauseResumeTimer, resetTimer, _onCompMounted, _tickTimer,
    // Scoreboard
    _setScoreTab,
    // Results
    syncPRsToRoster, exportResultsCSV,
    // Phase 3
    toggleFlights, setEntryFlight, _setFlight,
    showStats,
    printScoreboard, openDisplayWindow,
  };
})();
