import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, seedProgram } from '../helpers/app.js';

const single = () => ({ name:'Back Squat', category:'squat', setGroups:[{sets:3,reps:5,seconds:30,intensity:70,intensityHigh:75,rpe:8},{sets:2,reps:3,seconds:30,intensity:80,intensityHigh:0,rpe:8}], sets:5, reps:5, intensity:75, volume:21, scheme:'normal' });
const rpeEx  = () => ({ name:'RDL', category:'accessory', useRPE:true, setGroups:[{sets:3,reps:8,intensity:0,intensityHigh:0,rpe:8}], sets:3, reps:8, intensity:0, volume:24 });
const complex = () => ({ name:'Clean + FS', isComplex:true, category:'clean', movements:[{name:'Clean',reps:1,category:'clean'},{name:'Front Squat',reps:2,category:'squat'}], repsPerSet:3, complexGroups:[{sets:4,intensity:70,intensityHigh:75}], sets:4, reps:12, intensity:73, intensityHigh:75, volume:12 });
const superset = () => ({ name:'', isSuperset:true, category:'squat', sets:3, intensity:60, volume:45, supersetExercises:[
  { name:'Goblet Squat', category:'squat', reps:10, intensity:60, intensityHigh:65, useTime:false, useRPE:false, rpe:8 },
  { name:'Plank', category:'core', reps:0, seconds:30, intensity:0, intensityHigh:0, useTime:true, useRPE:false, rpe:8 },
  { name:'Row', category:'accessory', reps:5, intensity:0, intensityHigh:0, useTime:false, useRPE:true, rpe:7 },
]});

describe('applyWeekProgression', () => {
  let app;
  beforeEach(() => {
    app = loadApp(); seedProgram(app);
    app.run(`prog().weeks[1].days.Mon.exercises = [${JSON.stringify(single())}, ${JSON.stringify(rpeEx())}, ${JSON.stringify(complex())}, ${JSON.stringify(superset())}];`);
  });

  const progress = (intAdj, setsAdj) => app.run(`
    (function(){ const days = JSON.parse(JSON.stringify(prog().weeks[1].days)); applyWeekProgression(days, ${intAdj}, ${setsAdj}); return days.Mon.exercises; })()
  `);

  it('shifts single exercises (both ends of a range) and leaves RPE work alone', () => {
    const [s, r] = progress(2.5, 1);
    expect(s.setGroups[0]).toMatchObject({ sets: 4, intensity: 72.5, intensityHigh: 77.5 });
    expect(s.setGroups[1]).toMatchObject({ sets: 3, intensity: 82.5, intensityHigh: 0 });
    expect(s.sets).toBe(7);
    expect(s.volume).toBe(4 * 5 + 3 * 3);
    expect(r.setGroups[0]).toMatchObject({ sets: 3, intensity: 0 });
  });

  it('shifts complex groups and recomputes totals', () => {
    const [, , c] = progress(5, -1);
    expect(c.complexGroups[0]).toMatchObject({ sets: 3, intensity: 75, intensityHigh: 80 });
    expect(c.sets).toBe(3);
    expect(c.volume).toBe(9);      // 3 sets × 3 reps per set
    expect(c.reps).toBe(9);
    expect(c.intensity).toBe(78);  // round(77.5)
    expect(c.intensityHigh).toBe(80);
  });

  it('shifts superset sets and every %-based exercise, skipping RPE and bodyweight', () => {
    const [, , , ss] = progress(5, 1);
    expect(ss.sets).toBe(4);
    expect(ss.supersetExercises[0]).toMatchObject({ intensity: 65, intensityHigh: 70 });
    expect(ss.supersetExercises[1].intensity).toBe(0);   // bodyweight stays 0
    expect(ss.supersetExercises[2]).toMatchObject({ useRPE: true, intensity: 0 });
    expect(ss.volume).toBe(4 * 10);                        // timed + RPE exercises excluded
  });

  it('never drops below 1 set or above 115%', () => {
    const [s, , c] = progress(50, -10);
    expect(s.setGroups.every(g => g.sets === 1)).toBe(true);
    expect(s.setGroups[0].intensityHigh).toBe(115);
    expect(c.complexGroups[0].sets).toBe(1);
    expect(c.complexGroups[0].intensityHigh).toBe(115);
  });

  it('saveDuplicateWeek applies the rules through the modal', () => {
    app.run(`openDuplicateWeek();
      document.getElementById('dup-wk').value = '2';
      document.getElementById('dup-int-adj').value = '2.5';
      document.getElementById('dup-sets-adj').value = '0';
      saveDuplicateWeek();`);
    const wk2 = app.run(`prog().weeks[2].days.Mon.exercises`);
    expect(wk2[2].complexGroups[0]).toMatchObject({ intensity: 72.5, intensityHigh: 77.5 });
    expect(wk2[3].supersetExercises[0]).toMatchObject({ intensity: 62.5, intensityHigh: 67.5 });
    // source week untouched
    expect(app.run(`prog().weeks[1].days.Mon.exercises[2].complexGroups[0].intensity`)).toBe(70);
  });
});
