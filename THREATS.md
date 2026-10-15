# THREATS.md — STRIDE Threat Model

**Project:** LiftBuilder v3.2.4  
**Architecture:** Single-file SPA (index.html), vanilla JS, localStorage persistence, optional Electron wrapper  
**Date:** 2026-05-13  
**Status:** Phase 1 — Initial model; cloud/backend threats marked "future"

---

## Architecture Summary

```
┌─────────────────────────────────────────────────┐
│  index.html (4673 lines, single origin)          │
│                                                   │
│  vendor/chart.umd.js  (Chart.js 4.4.1, local)   │
│  vendor/jspdf.umd.min.js  (jsPDF 2.5.1, local)  │
│                                                   │
│  State: localStorage['liftbuilder_v1']           │
│         JSON blob: teams / roster / meets /      │
│         programs / templates / exerciseLibrary   │
│                                                   │
│  Ingress: form fields, FileReader (CSV/JSON)     │
│  Egress:  jsPDF (PDF), Blob (CSV/JSON download)  │
└─────────────────────────────────────────────────┘
         │ optional Electron wrapper
         │ preload.js exposes window.liftbuilderApp
         │ (getVersion, checkForUpdates, openReleasesPage)
```

No backend. No network requests from app code. No auth layer (Phase 1).

---

## Risk Scoring Matrix

| Likelihood | Impact | Risk |
|-----------|--------|------|
| L | L | L |
| L | M | L |
| L | H | M |
| M | L | L |
| M | M | M |
| M | H | H |
| H | L | M |
| H | M | H |
| H | H | H |

---

## Threat Register

### T-001 — XSS via athlete name in roster table
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure / Elevation of Privilege |
| **Description** | Athlete names are rendered via template literals directly into `innerHTML` with no HTML escaping. An athlete name containing `<img src=x onerror="...">` is stored in `localStorage` and re-executed every time the roster tab renders. `buildRosterHTML()` at line 3350 produces `<td style="...">${a.name}</td>` with no sanitization. |
| **Affected component** | `buildRosterHTML()` (line 3350); `buildAttemptsHTML()` option element (line 2751); `buildCalculatorHTML()` option element (line 2670); `buildMeetDetailHTML()` line 2939 |
| **Likelihood** | M — payload enters via form or CSV import; no validation |
| **Impact** | H — athlete PII of minors in localStorage; script can exfiltrate all data on next page load |
| **Risk** | H |
| **Proposed mitigation** | Replace all `${a.name}` (and similar) with a `esc(v)` helper that runs `v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')`. Apply consistently to all user-controlled fields rendered into HTML. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3 (output encoding); OWASP XSS Prevention Cheat Sheet; NIST SP 800-53 SI-10 |
| **Phase** | Phase 2 |

---

### T-002 — XSS via exercise name / coaching note in program view
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure |
| **Description** | Exercise names and coaching notes are rendered unescaped in `buildProgramHTML()`. Lines 649–655 produce `<span class="ex-note">${ex.note}</span>` and `${ex.name}`. Both fields are free-text input accepted in add/edit exercise modals and via JSON import. Superset sub-exercise names at line 629 and complex movement names at line 633 have the same flaw. Payload persists in `localStorage` and fires on every program tab render. |
| **Affected component** | `buildProgramHTML()` exRow function (lines 629, 633, 649–655); `buildCalendarHTML()` (line 2555) |
| **Likelihood** | M — requires attacker to add an exercise (coach-only but supply chain or shared JSON import could inject) |
| **Impact** | H — same-origin localStorage access; could exfiltrate all athlete PII |
| **Risk** | H |
| **Proposed mitigation** | Apply `esc()` helper to `ex.name`, `ex.note`, `se.name`, `m.name` at all render sites. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3; OWASP XSS Prevention Cheat Sheet; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-003 — XSS via week note / day note / session focus
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure |
| **Description** | Week notes (`wd.note`, line 618), day notes (`dd.dayNote`, line 730), and session focus (`dd.focus`, line 722) are all rendered unescaped into `innerHTML`. These are free-text fields entered by coaches. If a malicious JSON import contains crafted values, they execute on program tab render. |
| **Affected component** | `buildProgramHTML()` (lines 618, 722, 730); `buildCalendarHTML()` calendar week note (line 2569) |
| **Likelihood** | M — enters via form or JSON import |
| **Impact** | H — persistent XSS in localStorage |
| **Risk** | H |
| **Proposed mitigation** | Apply `esc()` to all note/focus fields. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-004 — XSS via template name on import
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure |
| **Description** | Template names from imported JSON files are rendered unescaped at line 3954: `${t.name}`. The import function at line 4179 assigns `data.name` directly to `state.templates` with no sanitization. A crafted template JSON file triggers XSS on every visit to the Templates tab. |
| **Affected component** | `importTemplate()` (line 4176); `buildTemplatesHTML()` (line 3954) |
| **Likelihood** | M — coach must import a crafted file |
| **Impact** | H — persistent XSS |
| **Risk** | H |
| **Proposed mitigation** | Apply `esc()` in `buildTemplatesHTML()`. Validate `typeof data.name === 'string'` on import. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3, 5.1.1; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-005 — XSS via CSV-imported field values in preview
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure |
| **Description** | `renderCSVPreview()` (line 3597) renders raw CSV cell values into table cells via template literals: `` `<td style="...">${p}</td>` ``. A CSV file with a field value containing `<script>` or `<img onerror>` executes in the preview before the user even confirms the import. |
| **Affected component** | `renderCSVPreview()` (line 3597); `handleCSVFile()` (line 3550) |
| **Likelihood** | M — malicious CSV delivered to coach |
| **Impact** | H — executes immediately on file load, before confirmation |
| **Risk** | H |
| **Proposed mitigation** | Apply `esc()` to all `p` values in sample row rendering. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-006 — Prototype pollution via JSON import
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Elevation of Privilege |
| **Description** | `importDataJSON()` (line 4447) does `_stateCore.teams = data.teams` after `JSON.parse()` with no prototype pollution check. A crafted JSON with `"__proto__": {"isAdmin": true}` or `"constructor": {"prototype": {...}}` keys would mutate `Object.prototype` and affect all subsequent property lookups app-wide. Same risk exists in `importSharedProgram()` (line 4343) which assigns `state.programs[id] = p` directly, and `importTemplate()` (line 4179) which pushes raw parsed data into `state.templates`. |
| **Affected component** | `importDataJSON()` (line 4447); `_doImportPrograms()` (line 4393); `importTemplate()` (line 4179) |
| **Likelihood** | M — requires importing a crafted file |
| **Impact** | H — could corrupt app state, bypass future auth checks, cause unexpected behavior across all object property access |
| **Risk** | H |
| **Proposed mitigation** | Use `JSON.parse()` with a reviver that rejects `__proto__`, `constructor`, and `prototype` keys. Or use a proven prototype-pollution-safe parser. Alternatively sanitize by deep-copying through a schema validator. Phase 2. |
| **Control reference** | OWASP ASVS 5.1.1; OWASP Prototype Pollution Prevention Cheat Sheet; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-007 — CSV formula injection on export (Excel / Google Sheets)
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering |
| **Description** | `exportMeetRosterCSV()` (line 3131–3144) wraps cell values in double-quotes and escapes internal `"` but does NOT neutralize formula injection prefixes. Athlete names beginning with `=`, `+`, `-`, `@`, tab (`\t`), or carriage return (`\r`) are treated as formulas by Excel and Google Sheets when a coach opens the exported file. A crafted athlete name like `=HYPERLINK("http://evil.com","Click me")` would execute when opened. Since athlete names enter via form or CSV import with no prefix stripping, this is an end-to-end injection path. |
| **Affected component** | `exportMeetRosterCSV()` (line 3131); any exported CSV field derived from athlete names |
| **Likelihood** | M — any athlete (or CSV import) can set a name with a formula prefix |
| **Impact** | M — data exfiltration / phishing possible against coach opening the file in Excel |
| **Risk** | M |
| **Proposed mitigation** | Prefix-strip dangerous characters on CSV export: if cell value starts with `=`, `+`, `-`, `@`, `\t`, or `\r`, prepend a single quote `'` (Excel treats `'` as a text prefix and does not display it but suppresses formula execution). Phase 2. |
| **Control reference** | OWASP CSV Injection Cheat Sheet; NIST SI-15 |
| **Phase** | Phase 2 |

---

### T-008 — Denial of service via oversized CSV or JSON import
| Field | Value |
|-------|-------|
| **STRIDE** | Denial of Service |
| **Description** | No file size check precedes `FileReader.readAsText()` in any import path (`importDataJSON` line 4436, `importSharedProgram` line 4358, `importTemplate` line 4173, `handleCSVFile` line 3552). A crafted 50 MB JSON or CSV file causes `JSON.parse()` to run synchronously on the main thread, freezing the UI for seconds and potentially triggering OOM. A pathological CSV with millions of rows could also exhaust available localStorage quota on the subsequent `saveState()` call. |
| **Affected component** | `importDataJSON()` (line 4436); `importSharedProgram()` (line 4358); `importTemplate()` (line 4173); `handleCSVFile()` (line 3552) |
| **Likelihood** | L — requires local attacker or social engineering |
| **Impact** | M — temporary UI freeze; potential data loss if localStorage write fails mid-save |
| **Risk** | L |
| **Proposed mitigation** | Check `file.size` before `readAsText()`; reject files larger than 5 MB (JSON) or 2 MB (CSV) with a user-facing error. Phase 2. |
| **Control reference** | OWASP ASVS 12.1.1; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-009 — Information disclosure via PDF export including unintended data
| Field | Value |
|-------|-------|
| **STRIDE** | Information Disclosure |
| **Description** | The roster PDF (`exportRosterPDF()`, line 3896) includes all athlete PII: name, gender, weight class, grad year, team, all training maxes, and computed totals. The program PDF exports coaching notes and mobility notes. There is no option to redact fields before export, no watermark, no access control on the exported file, and no warning that the PDF is a FERPA-protected document. If a coach emails or cloud-syncs the PDF without encryption, FERPA obligations attach to that transmission. |
| **Affected component** | `exportRosterPDF()` (line 3896); `exportFullProgramPDF()` |
| **Likelihood** | H — coaches regularly export for distribution |
| **Impact** | M — uncontrolled PII disclosure; FERPA compliance risk |
| **Risk** | H |
| **Proposed mitigation** | (a) Add a FERPA advisory banner to roster PDFs. (b) Provide a "redact name" option before export. (c) Add a "CONFIDENTIAL — Do not distribute" watermark to roster PDFs. Phase 3. |
| **Control reference** | NIST SP 800-53 AC-3, AU-9; FERPA 34 CFR Part 99 |
| **Phase** | Phase 3 |

---

### T-010 — Information disclosure via JSON backup leaking full state
| Field | Value |
|-------|-------|
| **STRIDE** | Information Disclosure |
| **Description** | `exportDataJSON()` (line 4411) serializes the entire `_stateCore` including all teams, all athlete PII, all meets with results, all programs with coaching notes, and the exercise library. The filename is a predictable date-stamped pattern (`liftbuilder_YYYY-MM-DD.json`). The file is unencrypted. If the coach's filesystem, cloud backup, or email is accessed by an unauthorized party, the entire school's athletic roster is exposed. Per-program shares (`shareProgram()`, line 4314) also embed all exercise names and coaching notes verbatim. |
| **Affected component** | `exportDataJSON()` (line 4411); `shareProgram()` (line 4314) |
| **Likelihood** | M — backup files are routinely stored in shared locations (iCloud, Dropbox, email) |
| **Impact** | H — complete exposure of all Restricted-class PII |
| **Risk** | H |
| **Proposed mitigation** | (a) Display a FERPA advisory before each export. (b) Phase 4: offer optional passphrase-based encryption for backup files. (c) Document in SECURITY.md that backup files must be treated as confidential records. |
| **Control reference** | NIST SP 800-53 SC-28, AC-3; FERPA 34 CFR Part 99 |
| **Phase** | Phase 3 (advisory) / Phase 4 (encryption) |

---

### T-011 — Insecure localStorage access by same-origin scripts
| Field | Value |
|-------|-------|
| **STRIDE** | Information Disclosure / Tampering |
| **Description** | All app data is stored in `localStorage['liftbuilder_v1']` (line 4189) with no encryption. The two vendor scripts (`vendor/chart.umd.js`, `vendor/jspdf.umd.min.js`) are loaded as `<script>` tags and share the same browsing-context origin. If either vendor bundle is compromised (see T-014), it has full read/write access to all athlete PII via `localStorage.getItem('liftbuilder_v1')`. Additionally, any other page opened from the same origin (e.g., if the HTML is served by a local web server with other files) would inherit the same localStorage access. |
| **Affected component** | `saveState()` / `loadState()` (lines 4194–4311); `localStorage['liftbuilder_v1']` |
| **Likelihood** | L — currently, vendor bundles are local and not served over network; risk increases significantly when moved to a web server |
| **Impact** | H — complete PII exfiltration possible |
| **Risk** | M |
| **Proposed mitigation** | (a) Phase 2: Add a Content-Security-Policy when serving over HTTP to restrict which scripts can run. (b) Phase 4: Implement localStorage encryption using WebCrypto with a key derived from a user passphrase. (c) Long term: migrate sensitive data to an auth-gated backend rather than browser storage. |
| **Control reference** | NIST SP 800-53 SC-28, SC-8; OWASP HTML5 Security Cheat Sheet |
| **Phase** | Phase 2 (CSP) / Phase 4 (encryption) |

---

### T-012 — Supply chain attack via compromised vendor bundle
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure / Elevation of Privilege |
| **Description** | Chart.js 4.4.1 (`vendor/chart.umd.js`, 200 KB) and jsPDF 2.5.1 (`vendor/jspdf.umd.min.js`, 364 KB) are vendored local copies. They are currently safe from CDN hijacking. However: (a) the files have no integrity check (no SRI hash in version control); (b) any developer who updates one of these files without verifying the hash could introduce a tampered bundle; (c) if the build pipeline is later changed to load these from a CDN, CDN compromise would give the vendor script full DOM and localStorage access. The minified jsPDF bundle is 364 KB — difficult to manually audit for inserted backdoors. |
| **Affected component** | `vendor/chart.umd.js` (line 7); `vendor/jspdf.umd.min.js` (line 8) |
| **Likelihood** | L — currently local; rises to H if migrated to CDN without SRI |
| **Impact** | H — compromised vendor can read localStorage, keylog form inputs, exfiltrate all athlete PII |
| **Risk** | M |
| **Proposed mitigation** | (a) Pin exact versions in `package.json` with no `^` or `~`. (b) Add SHA-256 hashes of both vendor files to a `CHECKSUMS.sha256` file committed to the repo. (c) Add a CI step that verifies hashes before build. (d) If CDN is ever used, require SRI (`integrity=` attribute). Phase 2. |
| **Control reference** | NIST SP 800-53 SI-7; OWASP Third Party JavaScript Management Cheat Sheet |
| **Phase** | Phase 2 |

---

### T-013 — HTML attribute injection via unescaped values in modal forms
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure |
| **Description** | Several modal forms embed stored values directly into HTML `value=""` attributes without escaping. `openEditProgram()` (line 1635) produces `value="${p.name}"` and `value="${p.org||''}"`. `athleteFormHTML()` (line 3443) produces `value="${a.name||''}"`. A stored value containing a double-quote breaks out of the attribute context, e.g., a program name of `"><img src=x onerror=alert(1)>` would inject a new attribute and trigger XSS when the edit modal opens. |
| **Affected component** | `openEditProgram()` (line 1635); `athleteFormHTML()` (line 3443); `openEditMeet()` (line 3050); `openRenameTeam()` (line 1753) |
| **Likelihood** | M — any name field that accepts free text is a vector |
| **Impact** | H — modal opens in response to user interaction; same XSS impact as T-001 |
| **Risk** | H |
| **Proposed mitigation** | Apply `esc()` to all values embedded in HTML attribute contexts. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3; OWASP XSS Prevention Cheat Sheet |
| **Phase** | Phase 2 |

---

### T-014 — Unsafe data embedding in onclick attribute (_showProgramSelectModal)
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Elevation of Privilege |
| **Description** | `_showProgramSelectModal()` (line 4380) builds an onclick handler by JSON-stringifying the full `programs` array and embedding it in an HTML attribute: `onclick="_confirmImportSelected(${JSON.stringify(programs).replace(/"/g,'&quot;')})"`. Only double-quotes are escaped. A program name or note containing a single quote `'` terminates the attribute value (the outer delimiter is `"`…`"`; the `&quot;` replacement handles the inner `"` but a `'` in a value can break the attribute in certain parser paths). More critically, this pattern embeds attacker-controlled data directly inside executable JavaScript in an event handler attribute, bypassing intended escaping. |
| **Affected component** | `_showProgramSelectModal()` (line 4380) |
| **Likelihood** | M — triggered by multi-program JSON import with a crafted program name/note |
| **Impact** | H — attribute breakout leads to arbitrary JS execution |
| **Risk** | H |
| **Proposed mitigation** | Never embed JSON data inside onclick attributes. Instead, store the `programs` array in a module-scoped variable and reference it by index in the onclick handler: `onclick="_confirmImportSelected()"` where the function reads the pre-stored array. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3; OWASP DOM-based XSS Cheat Sheet |
| **Phase** | Phase 2 |

---

### T-015 — IDOR (Insecure Direct Object Reference) — future cloud version
| Field | Value |
|-------|-------|
| **STRIDE** | Information Disclosure / Elevation of Privilege |
| **Description** | The current ID scheme uses time-based IDs: `'prog_' + Date.now()`, `'team_' + Date.now()`, `'ath_' + Date.now() + '_' + Math.random()` (lines 418, 1736, 3622). When a backend API is added, these IDs will likely appear in API endpoints (e.g., `GET /api/programs/prog_1234567890`). Because they are predictable (millisecond timestamps in a narrow window), an authenticated user could enumerate other coaches' programs or athlete rosters by guessing IDs. |
| **Affected component** | `newProgId()` (line 418); `saveNewTeam()` (line 1736); `_ensureTeamInit()` (line 1694) — future API layer |
| **Likelihood** | H — sequential/timestamp IDs are trivially enumerable once a backend exists |
| **Impact** | H — full read access to other schools' athlete PII |
| **Risk** | H |
| **Proposed mitigation** | When the backend is built: (a) use cryptographically random UUIDs (v4) for all server-side IDs; (b) enforce object-level authorization on every API endpoint (return 403 if requesting user does not own the resource); (c) never use sequential integers or timestamps as public IDs. Phase 5 (backend). |
| **Control reference** | OWASP ASVS 4.2.1; OWASP IDOR Cheat Sheet; NIST AC-3 |
| **Phase** | Phase 5 |

---

### T-016 — CSRF — future cloud version
| Field | Value |
|-------|-------|
| **STRIDE** | Spoofing / Tampering |
| **Description** | When a backend with cookie-based or bearer-token auth is added, all state-mutating endpoints will be vulnerable to Cross-Site Request Forgery unless CSRF tokens are used. A malicious page could trigger `POST /api/programs` or `DELETE /api/athletes/{id}` in the coach's browser. |
| **Affected component** | Future API endpoints |
| **Likelihood** | H — standard web vulnerability without mitigations |
| **Impact** | H — attacker could delete athlete records or inject malicious programs |
| **Risk** | H |
| **Proposed mitigation** | Use the SameSite=Strict cookie attribute on session cookies; implement double-submit CSRF tokens or use a stateless JWT in Authorization header (not cookie). Phase 5. |
| **Control reference** | OWASP ASVS 4.2.3; OWASP CSRF Cheat Sheet; NIST SC-23 |
| **Phase** | Phase 5 |

---

### T-017 — Session hijacking — future cloud version
| Field | Value |
|-------|-------|
| **STRIDE** | Spoofing |
| **Description** | When session tokens are introduced, tokens stored in localStorage are accessible to any same-origin XSS payload (see T-001 through T-005). A persistent XSS already present in the current codebase could trivially steal a future session token. Tokens in cookies with `HttpOnly` flag are safer but still vulnerable to CSRF if not protected. |
| **Affected component** | Future session storage; all current XSS vectors |
| **Likelihood** | H — given unmitigated XSS vectors already in the codebase |
| **Impact** | H — full account takeover |
| **Risk** | H |
| **Proposed mitigation** | (a) Fix all XSS vectors (T-001 through T-005, T-013, T-014) before shipping any auth layer — otherwise session tokens are immediately stealable. (b) Use HttpOnly, Secure, SameSite=Strict cookies for session tokens. (c) Implement token rotation on every request. Phase 2 (XSS fixes prerequisite); Phase 5 (token design). |
| **Control reference** | OWASP ASVS 3.4.1–3.4.5; OWASP Session Management Cheat Sheet; NIST IA-2, IA-5, SC-23 |
| **Phase** | Phase 2 prerequisite; Phase 5 implementation |

---

### T-018 — Program name as XSS in program selector sidebar
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering |
| **Description** | `renderSidebar()` (line 495) renders program names and org names unescaped in the sidebar list: `<span class="pl-name">${p.name}</span>` and the org group label `${org || 'No School / Sport'}`. These render on every page load regardless of which tab is active. |
| **Affected component** | `renderSidebar()` (lines 495, 506, 519) |
| **Likelihood** | M — same as T-001 |
| **Impact** | H — fires on every render, not just the program tab |
| **Risk** | H |
| **Proposed mitigation** | Apply `esc()` to `p.name`, `org`, and `t.name` in `renderSidebar()`. Phase 2. |
| **Control reference** | OWASP ASVS 5.3.3; NIST SI-10 |
| **Phase** | Phase 2 |

---

### T-019 — Path traversal / arbitrary file read via the `lb-video://` protocol handler
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering / Information Disclosure |
| **Description** | The Film Room video player loads clips via a custom `lb-video://<id>/<name>` scheme handled in the main process (`protocol.handle('lb-video', ...)`, main.js). If `<id>` or `<name>` were used to build a filesystem path without validation, a crafted URL (e.g. `lb-video://../../../etc/passwd/source.txt`) could read arbitrary files outside `userData/videos/`. |
| **Affected component** | `protocol.handle('lb-video', ...)` (main.js); `_videoDir()` (main.js) |
| **Likelihood** | L — the renderer is fully sandboxed/context-isolated and never constructs these URLs from untrusted input; `v.id` always comes from `crypto.randomUUID()` set by the main process at import time |
| **Impact** | H — arbitrary local file read, if exploitable |
| **Risk** | L |
| **Mitigation (implemented)** | `_videoDir(id)` rejects any id that doesn't match the uuid regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` before joining it onto `VIDEOS_DIR` — `..`/path separators in `id` cannot pass this check. The served filename is also checked against `manifest.json`'s recorded extension (written by the main process at import time, never trusted from the URL or renderer) rather than accepted as-is. |
| **Control reference** | OWASP ASVS 12.3.1 (path traversal); CWE-22 |
| **Phase** | Implemented at introduction (Film Room Phase 1) |

---

### T-020 — Denial of service via unbounded video import size
| Field | Value |
|-------|-------|
| **STRIDE** | Denial of Service |
| **Description** | `import-video` (main.js) copies whatever file the coach selects via the native file-open dialog into `userData/videos/<id>/source.<ext>` with no size cap. A very large video (many GB) could fill available disk space; same category of risk as T-008 (oversized CSV/JSON import), but for binary video files instead of text. |
| **Affected component** | `ipcMain.handle('import-video', ...)` (main.js) |
| **Likelihood** | L — requires the coach (or someone with access to their machine) to deliberately select an oversized file; the renderer never supplies the source path itself |
| **Impact** | M — disk exhaustion; does not corrupt existing data |
| **Risk** | L |
| **Proposed mitigation** | Check the selected file's size (via `fs.statSync`) before copying and reject/warn above a configurable threshold (e.g. 2 GB). Not yet implemented — same accepted-risk category as T-008. |
| **Control reference** | NIST SI-10; OWASP ASVS 12.1.1 |
| **Phase** | Backlog (same priority as T-008) |

---

### T-021 — Exported clip filename reuses the shared sanitizer (no drift risk)
| Field | Value |
|-------|-------|
| **STRIDE** | Tampering |
| **Description** | `export-video-clip` (main.js) builds its default save filename from the clip's `filename` field, which ultimately originates from the OS file picker's `originalFilename` (coach-controlled, but local-only — never from a network source). An unsanitized filename could inject path separators or reserved characters into the save dialog's default path. |
| **Affected component** | `ipcMain.handle('export-video-clip', ...)` (main.js) |
| **Likelihood** | L — `dialog.showSaveDialog` is main-process-controlled and the coach confirms the final path interactively regardless |
| **Impact** | L |
| **Risk** | L |
| **Mitigation (implemented)** | Reuses the exact same `.replace(/[/\\:*?"<>|]+/g, '_')` sanitizer as `export-pdf`'s `safeName`, verified by test (`test/unit/export-clip.test.js`) to stay byte-identical between the two handlers so they can't silently drift apart. |
| **Control reference** | OWASP ASVS 12.3.1 |
| **Phase** | Implemented at introduction (Film Room Phase 4) |

---

## Residual High Risks Before Phase 2

The following threats will have residual risk after Phase 1 (planning) since no code changes occur in this phase. All should be resolved in Phase 2.

| Threat ID | Description | Compensating Control (until mitigated) |
|-----------|-------------|----------------------------------------|
| T-001 | XSS via athlete name | Coach instruction: do not enter HTML in name fields; do not import untrusted CSV/JSON files |
| T-002 | XSS via exercise name/note | Same as T-001 |
| T-003 | XSS via week/day notes | Same as T-001 |
| T-005 | XSS via CSV preview | Do not open CSV files from untrusted sources |
| T-006 | Prototype pollution | Do not import JSON from untrusted sources |
| T-013 | Attribute injection | Do not use `<`, `>`, `"` characters in name fields |
| T-014 | onclick attribute injection | Do not import multi-program JSON from untrusted sources |

**Note:** All High-risk threats in this register will be fully mitigated by Phase 2 (XSS) or Phase 5 (cloud threats). None require compensating controls beyond Phase 5.
