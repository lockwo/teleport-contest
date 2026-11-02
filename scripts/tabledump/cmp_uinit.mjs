import { loadC } from './load.mjs';
import { grab } from './grab.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const c = loadC(); const U = c.u_init;
let bad = 0;
const rep = (what, cv, jv) => { if (JSON.stringify(cv) !== JSON.stringify(jv)) { bad++; console.log('MISMATCH', what, '\n   C ', JSON.stringify(cv), '\n   JS', JSON.stringify(jv)); } };
// inventory tables
for (const n of ['Archeologist','Barbarian_0','Barbarian_1','Cave_man','Healer','Knight','Monk','Priest','Ranger','Rogue','Samurai','Tourist','Valkyrie','Wizard','Healing_book','Protection_book','Confuse_monster_book','Tinopener','Magicmarker','Lamp','Blindfold','Xtra_food','Leash','Towel','Wishing','Money']) {
  let t; try { t = grab(R + '/js/u_init.js', n); } catch (e) { console.log('no JS table', n, e.message); bad++; continue; }
  const arr = t.filter(r => r.trotyp || r.trclass).map(r => [r.trotyp, r.trspe, r.trclass, r.trquan_min, r.trquan_max, r.trbless]);
  rep('trobj ' + n, U[n], arr);
}
// inv_subs
const IS = grab(R + '/js/u_init.js', 'INV_SUBS');
const pmn = (i) => c.mons[i]?.names[2];
rep('inv_subs', U.inv_subs.map(r => [pmn(r[0]), r[1], r[2]]), IS.map(r => [pmn(r[0] >= 0 && r[0] < 5 ? [260,264,44,165,72][r[0]] : r[0]), r[1], r[2]]));
// skills
const roleOrder = { Skill_A: 0, Skill_B: 1, Skill_C: 2, Skill_H: 3, Skill_K: 4, Skill_Mon: 5, Skill_P: 6, Skill_Ran: 7, Skill_R: 8, Skill_S: 9, Skill_T: 10, Skill_V: 11, Skill_W: 12 };
const jsSk = { Skill_A: 'SKILL_A', Skill_B: 'SKILL_B', Skill_C: 'SKILL_C', Skill_H: 'SKILL_H', Skill_K: 'SKILL_K', Skill_Mon: 'SKILL_MON', Skill_P: 'SKILL_P', Skill_R: 'SKILL_R', Skill_Ran: 'SKILL_RAN', Skill_S: 'SKILL_S', Skill_T: 'SKILL_T', Skill_V: 'SKILL_V', Skill_W: 'SKILL_W' };
for (const k in jsSk) {
  const env = {}; // enhance.js P_BASIC etc. constants live in the file
  const t = grab(R + '/js/enhance.js', jsSk[k]);
  rep('skills ' + k, U[k], t);
}
const SK_ARR = { 0: 'Skill_A', 1: 'Skill_B', 2: 'Skill_C', 3: 'Skill_H', 4: 'Skill_K', 5: 'Skill_Mon', 6: 'Skill_P', 7: 'Skill_Ran', 8: 'Skill_R', 9: 'Skill_S', 10: 'Skill_T', 11: 'Skill_V', 12: 'Skill_W' };
// spells
const SPELL_META = grab(R + '/js/u_init.js', 'SPELL_META'), SPELL_DELAY = grab(R + '/js/spell.js', 'SPELL_DELAY');
for (const o of c.objects) if (o.class === 10 && o.i >= 366 && o.i <= 406) {
  const m = SPELL_META.get(o.i);
  rep('spell ' + o.name + ' skill/level', [o.subtyp, o.oc2], m && [m.skill, m.level]);
  rep('spell ' + o.name + ' delay', o.delay, SPELL_DELAY.get(o.i));
}
// ROLE_SPELL_SKILLS
const RSS = grab(R + '/js/u_init.js', 'ROLE_SPELL_SKILLS');
for (const m in SK_ARR) { const cs = U[SK_ARR[m]].map(r => r[0]).filter(s => s >= 28 && s <= 34).sort(); rep('ROLE_SPELL_SKILLS ' + m, cs, [...RSS.get(+m)].sort()); }
console.log('u_init mismatches', bad);

console.log('RESULT u_init trobj/skills/spells mismatches=' + (bad)); process.exitCode = (bad) ? 1 : 0;
