import { loadC } from './load.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const st = await import(R + '/js/shtypes.js'); const sk = await import(R + '/js/shknam.js');
const c = loadC(); let bad = 0;
const rep = (w, cv, jv) => { if (JSON.stringify(cv) !== JSON.stringify(jv)) { bad++; console.log('MISMATCH', w, '\n  C ', JSON.stringify(cv), '\n  JS', JSON.stringify(jv)); } };
console.log('shtypes C', c.shtypes.length, 'JS', st.shtypes.length);
c.shtypes.forEach((s, i) => { const j = st.shtypes[i];
  rep(`shop${i} name/annot/symb/prob`, [s.name, s.annot, s.symb, s.prob], [j.name, j.annotation ?? null, j.symb, j.prob]);
  rep(`shop${i} ${s.name} iprobs`, s.iprobs, j.iprobs.map(p => [p.iprob, p.itype]));
  rep(`shop${i} ${s.name} shknms`, s.shknms, sk.SHKNAME_POOL[j.shknms]);
  if (j.shdist !== undefined) rep(`shop${i} shdist`, s.shdist, j.shdist); else console.log(' shdist C', s.shdist, 'JS undefined for', s.name);
});
console.log('mismatches', bad);

console.log('RESULT shtypes mismatches=' + (bad)); process.exitCode = (bad) ? 1 : 0;
