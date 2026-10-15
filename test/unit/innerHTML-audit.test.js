import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');

describe('innerHTML audit — known user-controlled fields are escaped', () => {
  // These are the T-001 through T-018 threat vectors from THREATS.md

  describe('Athlete PII (FERPA Restricted — T-001)', () => {
    it('a.firstName and a.lastName are escaped in all visible cell innerHTML contexts', () => {
      // The roster table shows First Name / Last Name as separate TDs, each using esc()
      expect(html).toContain('<td style="padding:7px 10px;font-weight:500;">${esc(a.firstName)');
      expect(html).toContain('<td style="padding:7px 10px;font-weight:500;">${esc(a.lastName)');
      // No raw a.firstName/a.lastName in a <td> cell
      expect(html).not.toContain('<td style="padding:7px 10px;font-weight:500;">${a.firstName}</td>');
      expect(html).not.toContain('<td style="padding:7px 10px;font-weight:500;">${a.lastName}</td>');
    });

    it('a.firstName and a.lastName are escaped in the Add/Edit Athlete form value= attributes', () => {
      expect(html).toContain('value="${esc(a.firstName||\'\')}"');
      expect(html).toContain('value="${esc(a.lastName||\'\')}"');
    });

    it('a.gender is escaped in innerHTML', () => {
      expect(html).toContain('${esc(a.gender)');
    });

    it('a.wc is escaped in innerHTML', () => {
      expect(html).toContain('${esc(a.wc)');
    });

    it('a.gradYear is escaped in innerHTML', () => {
      expect(html).toContain('${esc(a.gradYear)');
    });

    it('a.team is escaped in innerHTML', () => {
      expect(html).toContain('${esc(a.team)');
    });
  });

  describe('Exercise data (T-002)', () => {
    it('ex.name is never used raw in template literals for innerHTML', () => {
      const rawCount = (html.match(/\$\{ex\.name\}/g) || []).length;
      expect(rawCount).toBe(0);
    });

    it('ex.note is escaped', () => {
      expect(html).toContain('${esc(ex.note)}');
      const rawNoteCount = (html.match(/\$\{ex\.note\}/g) || []).length;
      expect(rawNoteCount).toBe(0);
    });
  });

  describe('Week and day notes (T-003)', () => {
    it('wd.note is escaped', () => {
      expect(html).toContain('${esc(wd.note)}');
    });

    it('dayNote is escaped', () => {
      expect(html).toContain('${esc(dayNote)}');
    });

    it('dd.focus is escaped', () => {
      expect(html).toContain('esc(dd.focus)');
    });
  });

  describe('Program metadata (T-018 — sidebar)', () => {
    it('p.name in sidebar is escaped', () => {
      expect(html).toContain('${esc(p.name)}');
    });

    it('org group label is escaped', () => {
      expect(html).toContain('esc(org)');
    });
  });

  describe('CSV preview (T-005)', () => {
    it('CSV preview cells escape all values', () => {
      expect(html).toContain('${esc(p)}</td>');
    });

    it('CSV column headers are escaped', () => {
      expect(html).toContain('${esc(h)}</th>');
    });
  });

  describe('Attribute injection (T-013)', () => {
    it('p.name in value= attribute is escaped', () => {
      expect(html).toContain('value="${esc(p.name)}"');
    });

    it('p.org in value= attribute is escaped', () => {
      expect(html).toContain('value="${esc(p.org');
    });

    it('se.name in value= attribute is escaped', () => {
      expect(html).toContain('value="${esc(se.name');
    });

    it('m.name in value= attribute is escaped', () => {
      expect(html).toContain('value="${esc(m.name)}"');
    });
  });

  describe('Film Room video metadata', () => {
    it('v.filename is escaped in gallery card and player header innerHTML', () => {
      expect(html).toContain('${esc(v.filename)}</div>');
      expect(html).toContain('">${esc(v.filename)}</h2>');
    });

    it('v.notes is escaped in the player notes panel', () => {
      expect(html).toContain('${esc(v.notes)}</div>');
    });

    it('v.filename and v.notes are escaped in the edit-tag form value/textarea', () => {
      expect(html).toContain('value="${esc(v.filename)}"');
      expect(html).toContain('>${esc(opts.notes)}</textarea>');
    });
  });

  describe('Security helpers present', () => {
    it('esc() helper is defined', () => {
      expect(html).toMatch(/function esc\(v\)/);
    });

    it('sanitizeHTML() helper is defined', () => {
      expect(html).toMatch(/function sanitizeHTML\(v\)/);
    });

    it('DOMPurify vendor script is included', () => {
      expect(html).toContain('vendor/purify.min.js');
    });

    it('validateNoProtoPollution() helper is defined', () => {
      expect(html).toMatch(/function validateNoProtoPollution\(obj\)/);
    });

    it('csvCell() helper is defined', () => {
      expect(html).toMatch(/function csvCell\(v\)/);
    });
  });
});
