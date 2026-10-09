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

  it('PDF export gives each set group its own row with the load in the Load column', () => {
    saveComplex([{ sets: 4, intensity: 70, intensityHigh: 75 }, { sets: 2, intensity: 80, intensityHigh: 0 }]);
    const pdf = app.run(`_buildProgramPDFHtml([1], false)`);
    // repsPerSet = 1 (Clean) + 2 (Front Squat) = 3 per round, ×1 round
    expect(pdf).toContain('4&times;3');
    expect(pdf).toContain('2&times;3');
    expect(pdf).toMatch(/font-weight:600;">70–75%<\/td>/);
    expect(pdf).toMatch(/font-weight:600;">80%<\/td>/);
    // the exercise name + movement list appear once, on the first group's row only
    expect((pdf.match(/1× Clean \+ 2× Front Squat/g) || []).length).toBe(1);
  });

  it('legacy complexes without intensityHigh still render, with the load in its own column', () => {
    app.run(`prog().weeks[1].days.Mon.exercises.push({name:'Old', isComplex:true, movements:[{name:'Snatch',reps:2,category:'snatch'}], complexGroups:[{sets:3,intensity:65}], sets:3, reps:6, repsPerSet:2, intensity:65, volume:6, category:'snatch'}); render();`);
    expect(app.text('main-area')).toMatch(/65%/);
    const pdf = app.run(`_buildProgramPDFHtml([1], false)`);
    expect(pdf).toContain('3&times;2');
    expect(pdf).toMatch(/font-weight:600;">65%<\/td>/);
    expect(app.errors).toEqual([]);
  });
});

describe('Complex exercises repeated as multiple rounds per set', () => {
  let app;
  beforeEach(() => { app = loadApp(); seedProgram(app); });

  const saveComplexRounds = (rounds, groups = [{ sets: 3, intensity: 70, intensityHigh: 0 }]) => app.run(`
    openAddExercise('Mon'); switchExMode('complex');
    _movements = [{name:'Clean', reps:1, category:'clean'}, {name:'Front Squat', reps:2, category:'squat'}];
    _complexGroups = ${JSON.stringify(groups)};
    _complexReps = ${rounds};
    document.getElementById('m-name').value = '';
    saveExercise();
    prog().weeks[1].days.Mon.exercises[0];
  `);

  it('defaults to 1 round and shows the input in the editor', () => {
    app.run(`openAddExercise('Mon'); switchExMode('complex');`);
    expect(app.document.getElementById('complex-reps').value).toBe('1');
  });

  it('multiplies reps-per-set and total volume by the round count', () => {
    const ex = saveComplexRounds(3);
    // 1 Clean + 2 Front Squat = 3 reps/round; ×3 rounds = 9 reps/set; ×3 sets = 27
    expect(ex.complexReps).toBe(3);
    expect(ex.repsPerSet).toBe(9);
    expect(ex.volume).toBe(27);
    expect(ex.reps).toBe(27);
  });

  it('auto-names as "(sequence) ×N" when the name field is left blank', () => {
    const ex = saveComplexRounds(3);
    expect(ex.name).toBe('(1× Clean + 2× Front Squat) ×3');
  });

  it('a single round keeps the plain auto-name (no "×1" suffix)', () => {
    const ex = saveComplexRounds(1);
    expect(ex.name).toBe('1× Clean + 2× Front Squat');
  });

  it('a typed name is never overwritten by the auto-name', () => {
    const ex = app.run(`
      openAddExercise('Mon'); switchExMode('complex');
      _movements = [{name:'Clean', reps:1, category:'clean'}, {name:'Front Squat', reps:2, category:'squat'}];
      _complexReps = 3;
      document.getElementById('m-name').value = 'Morning Complex';
      saveExercise();
      prog().weeks[1].days.Mon.exercises[0];
    `);
    expect(ex.name).toBe('Morning Complex');
  });

  it('editing reloads the saved round count into the input', () => {
    saveComplexRounds(4);
    app.run(`openEditExercise('Mon', 0);`);
    expect(app.document.getElementById('complex-reps').value).toBe('4');
    expect(app.run('_complexReps')).toBe(4);
  });

  it('changing rounds on an edit and re-saving updates volume', () => {
    saveComplexRounds(2);
    app.run(`openEditExercise('Mon', 0); _complexReps = 5; saveEditExercise('Mon', 0);`);
    const ex = app.run(`prog().weeks[1].days.Mon.exercises[0]`);
    expect(ex.complexReps).toBe(5);
    expect(ex.repsPerSet).toBe(15); // 3 reps/round × 5
    expect(ex.volume).toBe(45);     // × 3 sets
  });

  it('program table shows a rounds note; single-round complexes show none', () => {
    saveComplexRounds(3);
    expect(app.text('main-area')).toMatch(/× 3 rounds\/set/);

    app.run(`prog().weeks[1].days.Mon.exercises = []; render();`);
    saveComplexRounds(1);
    expect(app.text('main-area')).not.toMatch(/rounds\/set/);
  });

  it('PDF export lists the rounds note only when rounds > 1', () => {
    saveComplexRounds(3);
    expect(app.run(`_buildProgramPDFHtml([1], false)`)).toMatch(/&times; 3 rounds\/set/);

    app.run(`prog().weeks[1].days.Mon.exercises = []; render();`);
    saveComplexRounds(1);
    expect(app.run(`_buildProgramPDFHtml([1], false)`)).not.toMatch(/rounds\/set/);
  });

  it('Duplicate Week progression preserves the round count and recomputes volume', () => {
    saveComplexRounds(3, [{ sets: 2, intensity: 70, intensityHigh: 0 }]);
    app.run(`
      openDuplicateWeek();
      document.getElementById('dup-wk').value = '2';
      document.getElementById('dup-sets-adj').value = '1';
      saveDuplicateWeek();
    `);
    const ex = app.run(`prog().weeks[2].days.Mon.exercises[0]`);
    expect(ex.complexReps).toBe(3);
    expect(ex.sets).toBe(3);        // 2 + 1
    expect(ex.repsPerSet).toBe(9);  // unchanged: 3 reps/round × 3 rounds
    expect(ex.volume).toBe(27);     // 3 sets × 9
  });

  it('legacy complexes without complexReps behave exactly as before', () => {
    app.run(`prog().weeks[1].days.Mon.exercises.push({name:'Old', isComplex:true, movements:[{name:'Snatch',reps:2,category:'snatch'}], complexGroups:[{sets:3,intensity:65}], sets:3, reps:6, repsPerSet:2, intensity:65, volume:6, category:'snatch'}); render();`);
    expect(app.text('main-area')).not.toMatch(/rounds\/set/);
    expect(app.errors).toEqual([]);
  });
});
