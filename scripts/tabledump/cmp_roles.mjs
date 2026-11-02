import { loadC } from './load.mjs';
import { grab } from './grab.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const role = await import(R + '/js/role.js');
const c = loadC();
let bad = 0;
const rep = (what, cv, jv) => { if (JSON.stringify(cv) !== JSON.stringify(jv)) { bad++; console.log('MISMATCH', what, 'C', JSON.stringify(cv), 'JS', JSON.stringify(jv)); } };
const PM_ARCH = c.mons.findIndex(m => m.names[2] === 'archeologist');
console.log('PM_ARCHEOLOGIST', PM_ARCH, 'C roles', c.roles.length, 'JS roles', role.roles.length, 'C races', c.races.length, 'JS races', role.races.length);
// sources
const ROLE_ADVANCE = grab(R + '/js/exper.js', 'ROLE_ADVANCE');   // Map by role pm (0..12 = pm - PM_ARCHEOLOGIST)
const RACE_ADVANCE = grab(R + '/js/exper.js', 'RACE_ADVANCE');
const ROLE_RANKS = grab(R + '/js/exper.js', 'ROLE_RANKS');
const UI_ROLE_ADV = grab(R + '/js/u_init.js', 'ROLE_ADV'), UI_RACE_ADV = grab(R + '/js/u_init.js', 'RACE_ADV');
const ROLE_ATTRS = grab(R + '/js/u_init.js', 'ROLE_ATTRS');
const RACE_ATTRMIN = grab(R + '/js/u_init.js', 'RACE_ATTRMIN'), RACE_ATTRMAX = grab(R + '/js/u_init.js', 'RACE_ATTRMAX');
const ROLE_QUEST = grab(R + '/js/role.js', 'ROLE_QUEST'), RACE_PMNUM = grab(R + '/js/role.js', 'RACE_PMNUM');
const ROLE_PETNUM = grab(R + '/js/dog.js', 'ROLE_PETNUM');
const QUEST_ROLE_DATA = grab(R + '/js/questpgr.js', 'QUEST_ROLE_DATA');
const advArr = (a) => [a.infix, a.inrnd, a.lofix, a.lornd, a.hifix, a.hirnd];
const pmname = (n) => c.mons[n]?.names[2];
c.roles.forEach((cr, i) => {
  const jr = role.roles[i]; const nm = cr.name[0];
  rep(`role${i} name`, cr.name, [jr.name.m, jr.name.f]);
  rep(`${nm} rank`, cr.rank, jr.rank.map(r => [r.m, r.f]));
  rep(`${nm} gods`, cr.gods.every(g => g === null) ? null : cr.gods, jr.gods);
  rep(`${nm} filecode`, cr.filecode, jr.filecode);
  rep(`${nm} allow`, cr.allow, jr.allow);
  rep(`${nm} xlev`, cr.xlev, jr.xlev);
  rep(`${nm} initrecord`, cr.initrecord, jr.initrecord);
  rep(`${nm} spel`, cr.spel, [jr.spel.base, jr.spel.heal, jr.spel.shld, jr.spel.armr, jr.spel.stat, jr.spel.spec, jr.spel.sbon]);
  const pm = cr.nums[0] - PM_ARCH;
  rep(`${nm} mnum(role idx vs pm-offset)`, pm, jr.mnum);
  const ra = ROLE_ADVANCE.get(jr.mnum);
  rep(`${nm} exper hpadv`, cr.hpadv, ra && advArr(ra.hpadv)); rep(`${nm} exper enadv`, cr.enadv, ra && advArr(ra.enadv)); rep(`${nm} exper xlev`, cr.xlev, ra?.xlev);
  const rr = ROLE_RANKS.get(jr.mnum); rep(`${nm} exper ranks`, cr.rank, rr);
  const ua = UI_ROLE_ADV.get(jr.mnum); rep(`${nm} u_init hp/en infix,inrnd`, [cr.hpadv[0], cr.hpadv[1], cr.enadv[0], cr.enadv[1]], ua && [ua.hpadv.infix, ua.hpadv.inrnd, ua.enadv.infix, ua.enadv.inrnd]);
  const at = ROLE_ATTRS.get(jr.mnum); rep(`${nm} attrbase`, cr.attrbase, at?.attrbase); rep(`${nm} attrdist`, cr.attrdist, at?.attrdist);
  const q = ROLE_QUEST[i];
  rep(`${nm} ldr`, pmname(cr.nums[2]), q?.ldr); rep(`${nm} guard`, pmname(cr.nums[3]), q?.guard); rep(`${nm} nemesis`, pmname(cr.nums[4]), q?.nemesis);
  const qd = QUEST_ROLE_DATA[cr.filecode];
  rep(`${nm} homebase`, 'the ' === '' ? 0 : cr.homebase, qd?.homebase); rep(`${nm} intermed`, cr.intermed, qd?.intermed);
  rep(`${nm} petnum`, cr.nums[1] < 0 ? null : pmname(cr.nums[1]), ROLE_PETNUM[cr.name[0]] != null ? pmname(ROLE_PETNUM[cr.name[0]]) : null);
  console.log(nm, 'enemy1num', cr.nums[5], cr.nums[6], 'enemy syms', cr.nums[7], cr.nums[8], 'questarti', cr.nums[9]);
});
c.races.forEach((cr, i) => {
  const jr = role.races[i]; const nm = cr.strs[0];
  rep(`race${i} strs`, [cr.strs[0], cr.strs[1], cr.strs[3]], [jr.noun, jr.adj, jr.filecode]);
  rep(`${nm} allow`, cr.allow, jr.allow); rep(`${nm} selfmask`, cr.masks[0], jr.selfmask);
  rep(`${nm} basepm`, cr.nums[0], RACE_PMNUM[i]);
  const ra = RACE_ADVANCE.get(jr.mnum); rep(`${nm} hpadv`, cr.hpadv, ra && advArr(ra.hpadv)); rep(`${nm} enadv`, cr.enadv, ra && advArr(ra.enadv));
  const ua = UI_RACE_ADV.get(jr.mnum); rep(`${nm} u_init infix`, [cr.hpadv[0], cr.hpadv[1], cr.enadv[0], cr.enadv[1]], ua && [ua.hpadv.infix, ua.hpadv.inrnd, ua.enadv.infix, ua.enadv.inrnd]);
  rep(`${nm} attrmin`, cr.attrmin, RACE_ATTRMIN[jr.mnum]); rep(`${nm} attrmax`, cr.attrmax, RACE_ATTRMAX[jr.mnum]);
});
console.log('role/race mismatches', bad);
const QT = grab(R + '/js/makemon.js', 'QT_ENEMY');
let b2 = 0;
for (const cr of c.roles) { const q = QT[cr.filecode]; const nm = (n) => n < 0 ? null : c.mons[n].names[2];
  const cv = [nm(cr.nums[5]), cr.nums[7], nm(cr.nums[6]), cr.nums[8]], jv = [q.num1, q.sym1, q.num2, q.sym2];
  if (JSON.stringify(cv) !== JSON.stringify(jv)) { b2++; console.log('QT_ENEMY mismatch', cr.filecode, JSON.stringify(cv), JSON.stringify(jv)); } }
console.log('QT_ENEMY mismatches', b2);

console.log('RESULT roles/races/quest enemies mismatches=' + (bad + b2)); process.exitCode = (bad + b2) ? 1 : 0;
