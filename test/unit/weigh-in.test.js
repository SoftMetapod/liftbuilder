import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from '../helpers/app.js';

const entry = (id, name, wc, discipline = 'both') => ({
  id, athleteId: null, name, schoolId: 'sch1', wc, discipline, publicOptOut: false, flight: 'A', platform: null,
  weighIn: null, snatchOpen: 0, cjOpen: 0, benchOpen: 0,
  snatch: [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
  cj:     [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
  bench:  [{declared:0,result:null},{declared:0,result:null},{declared:0,result:null}],
});

function seedMeet(app, gender = 'Boys') {
  const meet = { id: 'hm_test', name: 'Test Meet', date: '', location: '', gender, status: 'weigh-in', useFlights: false, numPlatforms: 0, platformStates: {},
    schools: [{ id: 'sch1', name: 'Home', isHome: true, color: '#fff' }, { id: 'sch2', name: 'Away', color: '#aaa' }],
    entries: [entry('e1', 'Alex Kim', '154'), entry('e2', 'Riley Park', gender === 'Boys' ? 'HWT' : 'UNL'), entry('e3', 'Sam Lo', '238')] };
  app.window.localStorage.setItem('liftbuilder_hosted_meets', JSON.stringify([meet]));
  app.run(`switchTab('hostmeet'); HM.openMeet('hm_test');`);
}

const weigh = (app, id, lbs) => app.run(`document.getElementById('wi-${id}').value = '${lbs}'; HM.saveWeighIn('${id}');`);
const msg   = (app, id) => app.text(`hm-wi-over-${id}`);

describe('Weigh-in over-limit warning', () => {
  let app;
  beforeEach(() => { app = loadApp(); seedMeet(app); });

  it('shows nothing when the athlete makes weight', () => {
    weigh(app, 'e1', 153.8);
    expect(msg(app, 'e1')).toBe('');
    expect(app.text('hm-wi-check-e1')).toBe('✓');
    weigh(app, 'e1', 154);
    expect(msg(app, 'e1')).toBe('');
  });

  it('warns live with the overage and the next class up', () => {
    weigh(app, 'e1', 156.3);
    expect(msg(app, 'e1')).toBe('⚠ 2.3 lbs over the 154 limit — moves to 169 lbs');
    expect(app.text('hm-wi-check-e1')).toBe('⚠');
    expect(app.document.getElementById('wi-e1').style.borderColor).toBe('rgb(224, 112, 112)');
    weigh(app, 'e1', 150);
    expect(msg(app, 'e1')).toBe('');
    expect(app.text('hm-wi-check-e1')).toBe('✓');
  });

  it('names the unlimited class when the athlete moves out of the top numeric class', () => {
    weigh(app, 'e3', 240);
    expect(msg(app, 'e3')).toBe('⚠ 2 lbs over the 238 limit — moves to HWT');
  });

  it('never warns for the unlimited class', () => {
    weigh(app, 'e2', 312.5);
    expect(msg(app, 'e2')).toBe('');
    expect(app.text('hm-wi-check-e2')).toBe('✓');
  });

  it('persists and re-renders the warning from saved state', () => {
    weigh(app, 'e1', 156.3);
    app.run(`HM.backToList(); HM.openMeet('hm_test');`);
    expect(msg(app, 'e1')).toMatch(/2\.3 lbs over/);
  });

  it('asks for confirmation before starting a competition with an over-limit athlete', () => {
    weigh(app, 'e1', 156.3); weigh(app, 'e2', 300); weigh(app, 'e3', 230);
    const asked = [];
    app.window.confirm = m => { asked.push(m); return false; };
    app.run(`HM.proceedToCompetition()`);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/1 athlete weighed in over the class limit/);
    expect(asked[0]).toMatch(/Alex Kim — 156\.3 lbs in the 154 class/);
    expect(app.run(`JSON.parse(localStorage.getItem('liftbuilder_hosted_meets'))[0].status`)).toBe('weigh-in');

    app.window.confirm = () => true;
    app.run(`HM.proceedToCompetition()`);
    expect(app.run(`JSON.parse(localStorage.getItem('liftbuilder_hosted_meets'))[0].status`)).toBe('snatch');
  });
});
