import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, seedProgram } from '../helpers/app.js';

describe('Complex exercises with percentage ranges', () => {
  let app;
  beforeEach(() => { app = loadApp(); seedProgram(app); });

  const saveComplex = (groups) => app.run(`
    openAddExercise('Mon'); switchExMode('complex');
    _movements = [{name:'Clean', reps:1, category:'clean'}, {name:'Front Squat', reps:2, category:'squat'}];
    _complexGroups = ${JSON.stringify(groups)};
    document.getElementById('m-name').value = '';
    saveExercise();
    prog().weeks[1].days.Mon.exercises[0];
  `);

  it('editor shows Low% and High% columns', () => {
    app.run(`openAddExercise('Mon'); switchExMode('complex');`);
    const t = app.text('complex-groups-container');
    expect(t).toMatch(/LOW%/i);
    expect(t).toMatch(/HIGH%/i);
  });

  it('saves the range and averages on the midpoint', () => {
    const ex = saveComplex([{ sets: 4, intensity: 70, intensityHigh: 75 }]);
    expect(ex.complexGroups[0].intensityHigh).toBe(75);
    expect(ex.intensity).toBe(73);      // round(72.5)
    expect(ex.intensityHigh).toBe(75);  // single group → exposed at exercise level
    expect(app.text('main-area')).toMatch(/70–75%/);
  });

  it('edit modal reloads the range and multi-group shows a breakdown', () => {
    saveComplex([{ sets: 4, intensity: 70, intensityHigh: 75 }]);
    app.run(`openEditExercise('Mon', 0);`);
    expect(app.run('_complexGroups[0].intensityHigh')).toBe(75);
    app.run(`addComplexGroup(); _complexGroups[1] = {sets:2, intensity:80, intensityHigh:0}; saveEditExercise('Mon', 0);`);
    const ex = app.run(`prog().weeks[1].days.Mon.exercises[0]`);
    const t = app.text('main-area');
    expect(t).toMatch(/mixed/);
    expect(t).toMatch(/4 sets @ 70–75%/);
    expect(t).toMatch(/2 sets @ 80%/);
    expect(ex.intensityHigh).toBe(0);
    expect(ex.intensity).toBe(75); // (72.5*4 + 80*2) / 6
  });

  it('PDF export lists per-group loads', () => {
    saveComplex([{ sets: 4, intensity: 70, intensityHigh: 75 }, { sets: 2, intensity: 80, intensityHigh: 0 }]);
    const pdf = app.run(`_buildProgramPDFHtml([1], false)`);
    expect(pdf).toMatch(/4×@70–75%, 2×@80%/);
  });

  it('legacy complexes without intensityHigh still render', () => {
    app.run(`prog().weeks[1].days.Mon.exercises.push({name:'Old', isComplex:true, movements:[{name:'Snatch',reps:2,category:'snatch'}], complexGroups:[{sets:3,intensity:65}], sets:3, reps:6, repsPerSet:2, intensity:65, volume:6, category:'snatch'}); render();`);
    expect(app.text('main-area')).toMatch(/65%/);
    expect(app.run(`_buildProgramPDFHtml([1], false)`)).toMatch(/3 sets @ 65%/);
    expect(app.errors).toEqual([]);
  });
});
