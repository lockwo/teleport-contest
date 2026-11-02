import { loadC } from './load.mjs';
const f2=(k)=>['name_idx','descr_idx','color','tough','material','dir','name_known','prob'][k];
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const mk = await import(R + '/js/mkobj.js');
const oi = await import(R + '/js/o_init.js');
const { initRng } = await import(R + '/js/rng.js');
const c = loadC();
const cnt = {}; let ex = {};
for (const [seed, sh] of Object.entries(c.shuffles)) {
  initRng(+seed); oi.init_objects();
  sh.o.forEach((cv, i) => {
    const j = mk.objects[i];
    const jv = [j.oc_name_idx, j.oc_descr_idx, j.oc_color, j.oc_tough, j.material, j.dir ?? 0, j.oc_name_known ? 1 : 0, j.oc_prob];
    ['name_idx', 'descr_idx', 'color', 'tough', 'material', 'dir', 'name_known', 'prob'].forEach((f, k) => {
      if (i >= 18 && !(f2(k)==='prob' && i>=439 && i<=460) && !(k===5 && (mk.objects[i].oclass===2 || [259,260,261,477,478].includes(i))) && cv[k] !== jv[k]) { cnt[f] = (cnt[f] || 0) + 1; (ex[f] ||= []).length < 6 && ex[f].push(`seed ${seed} otyp ${i} (${mk.objects[i].name}): C=${cv[k]} JS=${jv[k]}`); }
    });
  });
}
console.log('seeds', Object.keys(c.shuffles).length, 'mismatch counts', cnt);
for (const f in ex) { console.log('--', f); ex[f].forEach(s => console.log('  ' + s)); }

console.log('RESULT init_objects shuffles mismatches=' + Object.keys(cnt).length); process.exitCode = Object.keys(cnt).length ? 1 : 0;
