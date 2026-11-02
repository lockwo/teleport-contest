import { loadC } from './load.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const mk = await import(R + '/js/mkobj.js');
const { DESCR_BY_OTYP } = await import(R + '/js/o_descr_data.js');
const { OBJ_A_AC, OBJ_ARMCAT } = await import(R + '/js/objarmor_data.js');
const { WEP_SDAM, WEP_LDAM } = await import(R + '/js/weapondmg_data.js');
const oi = await import(R + '/js/o_init.js'); const { initRng } = await import(R + '/js/rng.js');
initRng(1); oi.init_objects();
const inv = await import(R + '/js/invent.js'); const eat = await import(R + '/js/eat.js');
const c = loadC();
const J = mk.objects;
const mism = {}; const note = (f, i, cv, jv) => { (mism[f] ||= []).push(`${i} ${c.objects[i].name}: C=${JSON.stringify(cv)} JS=${JSON.stringify(jv)}`); };
console.log('count C', c.objects.length, 'JS', J.length);
for (let i = 0; i < c.objects.length; i++) {
  const o = c.objects[i], j = J[i];
  const cmp = (f, cv, jv) => { if (cv !== jv) note(f, i, cv, jv); };
  if (i >= 18) cmp('name', o.name, j.name === '' ? null : j.name);
  if (i >= 18) cmp('descr', o.descr, DESCR_BY_OTYP[i] ?? null);
  cmp('class', o.class, j.oclass);
  cmp('prob', o.prob, j.oc_prob);
  
  
  
  cmp('magic', o.magic, j.oc_magic);
  if (i !== 0 && i !== 265) cmp('weight', o.weight, mk.base_oc_weight({ otyp: i, oclass: j.oclass })); // 0/corpse: weight() is dynamic
  cmp('cost', o.cost, mk.base_oc_cost(i));
  cmp('charged', o.charged, (j.flags & 1) ? 1 : 0);
  cmp('merge', o.merge, (j.flags & 32) ? 1 : 0);
  cmp('unique', o.unique, (j.flags & 64) ? 1 : 0);
  cmp('oprop', o.oprop, j.oc_oprop || 0);
  if (o.class === 3) { cmp('a_ac', o.oc1, OBJ_A_AC[i]); cmp('armcat', o.subtyp, OBJ_ARMCAT[i]); cmp('a_can', o.oc2, j.oc_can); }
  else if (o.class !== 10) { cmp('skill', o.subtyp, j.oc_skill); } // spellbook oc_skill: u_init.js SPELL_META (cmp_uinit)
  // oc_dir: wands/spellbooks only.  Weapon/weptool strike masks (PIERCE/SLASH/WHACK overload oc_dir) live in
  // monmove.js WEAPON_ODIR (checked by cmp_obj2); WAN_NOTHING's oc_dir is rolled by init_objects.
  if (i >= 18 && o.class !== 2 && ![259, 260, 261, 477, 478, 416].includes(i)) cmp('dir', o.dir, j.dir ?? 0);
  if (o.class === 3) cmp('delay', o.delay, inv.oc_delay(i)); if (o.class === 7 && i >= 264) cmp('nutrition', o.nutrition, eat.food_nutrit(i));
  cmp('wsdam', o.wsdam, WEP_SDAM[i] ?? 0);
  cmp('wldam', o.wldam, WEP_LDAM[i] ?? 0);
}
for (const [f, l] of Object.entries(mism)) { console.log(`== ${f}: ${l.length}`); for (const s of l.slice(0, +process.env.N || 8)) console.log('  ' + s); }

console.log('RESULT objects[] fields' + ' mismatches=' + Object.keys(mism).length); process.exitCode = Object.keys(mism).length ? 1 : 0;
