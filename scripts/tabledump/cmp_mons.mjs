import { loadC } from './load.mjs';
import { grab } from './grab.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const mm = await import(R + '/js/makemon.js');
const fl = await import(R + '/js/monflags_data.js');
const at = await import(R + '/js/monattk_data.js');
const mr = await import(R + '/js/monmr_data.js');
const MCONVEYS = grab(R + '/js/eat.js', 'MCONVEYS');
const c = loadC();
const N = process.env.N || 8;
const mism = {}; const note = (f, i, cv, jv) => { (mism[f] ||= []).push(`${i} ${c.mons[i].names[2]}: C=${JSON.stringify(cv)} JS=${JSON.stringify(jv)}`); };
for (const m of c.mons) {
  const i = m.i, j = mm.monster_by_pmidx(i);
  const cmp = (f, cv, jv) => { if (cv !== jv) note(f, i, cv, jv); };
  cmp('name', m.names[2], j.name);
  cmp('mcls', m.mlet, j.mcls);
  cmp('mlevel', m.mlevel, j.mlevel);
  cmp('align', m.align, j.maligntyp);
  cmp('geno', m.geno, j.geno);
  cmp('mresists', m.mresists, j.mresists);
  cmp('difficulty', m.difficulty, j.difficulty);
  cmp('mcolor', m.mcolor, j.mcolor);
  cmp('mflags3(makemon)', m.mflags3, j.mflags3);
  cmp('mflags3(flagsdata)', m.mflags3, fl.mflags3_of(j));
  cmp('mflags1', m.mflags1 >>> 0, fl.mflags1_of(j) >>> 0);
  cmp('mflags2', m.mflags2 >>> 0, fl.mflags2_of(j) >>> 0);
  cmp('msound', m.msound, fl.msound_of(j));
  cmp('ac', m.ac, j.ac);
  cmp('mmove', m.mmove, j.mmove);
  cmp('cwt', m.cwt, j.cwt);
  cmp('cnutrit', m.cnutrit, j.cnutrit);
  cmp('msize', m.msize, j.msize);
  cmp('mr', m.mr, mr.mon_mr(j));
  cmp('mconveys', m.mconveys, MCONVEYS[i]);
  const ja = (at.MATTK[i] || []).map(a => a.join(','));
  const ca = m.mattk.filter(a => a.some(x => x)).map(a => a.join(','));
  cmp('mattk', ca.join('|'), ja.join('|'));
  // verysmall/carnivore/herbivore/poisonous/acidic derived flags
  cmp('carnivore', !!(m.mflags1 & 0x20000000), j.carnivore);
  cmp('herbivore', !!(m.mflags1 & 0x40000000), j.herbivore);
  cmp('poisonous', !!(m.mflags1 & 0x10000000), j.poisonous);
  cmp('acidic', !!(m.mflags1 & 0x8000000), j.acidic);
}
console.log('monsters C', c.mons.length);
for (const [f, l] of Object.entries(mism)) { console.log(`== ${f}: ${l.length}`); for (const s of l.slice(0, +N)) console.log('  ' + s); }
console.log('fields with 0 mismatches OK');

console.log('RESULT mons[] mismatches=' + (Object.keys(mism).length)); process.exitCode = (Object.keys(mism).length) ? 1 : 0;
