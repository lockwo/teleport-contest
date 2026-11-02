import { readFileSync } from 'fs';
import { grab } from './grab.mjs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const s = readFileSync(REC + '/src/attrib.c', 'utf8');
const C = {};
for (const m of s.matchAll(/\b([a-z]{3}_abil)\[\] = \{([\s\S]*?)\{ 0, 0, 0, 0 \} \}/g)) {
  C[m[1]] = [...m[2].matchAll(/\{\s*(\d+),\s*&\(?(H\w+)\)?,\s*"([^"]*)",\s*"([^"]*)"\s*\}/g)].map(x => [+x[1], x[3], x[4], x[2]]);
}
const roleMap = { arc_abil: 0, bar_abil: 1, cav_abil: 2, hea_abil: 3, kni_abil: 4, mon_abil: 5, pri_abil: 6, ran_abil: 7, rog_abil: 8, sam_abil: 9, tou_abil: 10, val_abil: 11, wiz_abil: 12 };
const RA = grab(R + '/js/exper.js', 'ROLE_ABIL'), RC0 = grab(R + '/js/exper.js', 'RACE_ABIL'); const RC = new Map([...RC0, [2, [[1, '', '', 'HInfravision']]], [3, [[1, '', '', 'HInfravision']]]]);
let bad = 0;
const rep = (w, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log('MISMATCH', w, JSON.stringify(a), JSON.stringify(b)); } };
for (const [k, m] of Object.entries(roleMap)) rep(k, C[k], RA.get(m));
const raceMap = { hum_abil: 0, elf_abil: 1, dwa_abil: 2, gno_abil: 3, orc_abil: 4 };
for (const [k, m] of Object.entries(raceMap)) rep(k, C[k], RC.get(m) ?? []);
console.log('abil tables', Object.keys(C).length, 'mismatches', bad);

console.log('RESULT abil tables mismatches=' + (bad)); process.exitCode = (bad) ? 1 : 0;
