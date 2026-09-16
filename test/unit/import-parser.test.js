import { describe, it, expect } from 'vitest';
import { loadApp } from '../helpers/app.js';

const BOYS  = ['119','129','139','154','169','183','199','219','238','HWT'];
const GIRLS = ['101','110','119','129','139','154','169','183','199','UNL'];

describe('HM._parseImportText', () => {
  const app = loadApp();
  // HM is a top-level const in host-meet.js, so it lives in the page's lexical scope rather than on window
  const parse = (text, wcs = BOYS) => app.run(`HM._parseImportText(${JSON.stringify(text)}, ${JSON.stringify(wcs)})`);

  it('parses simple comma rows: name, weight class, discipline', () => {
    expect(parse('John Smith, 154, Oly\nJane Doe, 139, Trad')).toEqual([
      { name: 'John Smith', wc: '154', disc: 'olympic' },
      { name: 'Jane Doe', wc: '139', disc: 'traditional' },
    ]);
  });

  it('handles tab-separated Google Forms exports with a header and timestamp column', () => {
    const text = 'Timestamp\tAthlete Name\tWeight Class\tEvent\n2026/09/01 10:00\tAlex Kim\t169 lbs\tBoth\n2026/09/01 10:05\tRiley Park\tHWT\tExhibition';
    expect(parse(text)).toEqual([
      { name: 'Alex Kim', wc: '169', disc: 'both' },
      { name: 'Riley Park', wc: 'HWT', disc: 'exhibition' },
    ]);
  });

  it('extracts the weight from the name when there is no separate column', () => {
    expect(parse('Chris Lee 183\nDana Fox 199lbs')).toEqual([
      { name: 'Chris Lee', wc: '183', disc: 'both' },
      { name: 'Dana Fox', wc: '199', disc: 'both' },
    ]);
  });

  it('maps unlimited / heavyweight aliases to the top class for the gender', () => {
    expect(parse('A, UNL', GIRLS)[0].wc).toBe('UNL');
    expect(parse('B, heavyweight', BOYS)[0].wc).toBe('HWT');
    expect(parse('C, HWT', GIRLS)[0].wc).toBe('UNL');
  });

  it('returns null wc for unknown classes and skips blank or timestamp-only lines', () => {
    const rows = parse('\n  \n2026-09-01\nPat Quinn, 500, O\n');
    expect(rows).toEqual([{ name: 'Pat Quinn', wc: null, disc: 'olympic' }]);
  });

  it('strips CSV quotes and stray dashes', () => {
    expect(parse('"Taylor Reed", "129", "T"')).toEqual([{ name: 'Taylor Reed', wc: '129', disc: 'traditional' }]);
    expect(parse('Morgan Blake 129 -')).toEqual([{ name: 'Morgan Blake', wc: '129', disc: 'both' }]);
  });
});
