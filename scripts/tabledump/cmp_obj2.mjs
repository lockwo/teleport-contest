import { loadC } from './load.mjs';
import { grab } from './grab.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const c = loadC(); let bad = 0;
const rep = (w, cv, jv) => { if (JSON.stringify(cv) !== JSON.stringify(jv)) { bad++; console.log('MISMATCH', w, 'C', JSON.stringify(cv), 'JS', JSON.stringify(jv)); } };
const byCls = {}; for (const o of c.objects) if (o.delay) (byCls[o.class] ||= []).push(o.i);
console.log('classes with nonzero oc_delay:', Object.keys(byCls).map(k => k + ':' + byCls[k].length).join(' '));
const FP = grab(R + '/js/eat.js', 'FOOD_PROPS'), FD = grab(R + '/js/dogmove.js', 'FOOD_OC_DELAY');
for (const o of c.objects) if (o.class === 7 && o.i >= 264) {
  const f = FP[o.i]; rep('FOOD_PROPS ' + o.i + ' ' + o.name, [o.delay, o.nutrition], f);
  rep('FOOD_OC_DELAY ' + o.i + ' ' + o.name, o.delay, FD[o.i] ?? 1);
}
const AAD = grab(R + '/js/mon.js', 'ARMOR_AC_DELAY');
for (const o of c.objects) if (o.class === 3) { const e = AAD.get(o.i); if (e) rep('mon ARMOR_AC_DELAY ' + o.i + ' ' + o.name, [o.oc1, o.delay], [e[1], e[2]]); else if (o.i >= 89 && o.i <= 172) console.log('  (no mon.js ARMOR_AC_DELAY entry for', o.i, o.name, 'a_ac', o.oc1, 'delay', o.delay, ')'); }
// non-food/armor delays
for (const k of Object.keys(byCls)) if (k !== '7' && k !== '3' && k !== '10') console.log('class', k, 'delay objs', byCls[k].map(i => i + ':' + c.objects[i].name + '=' + c.objects[i].delay).join(' '));
// weights
const BW = grab(R + '/js/mkobj.js', 'BASE_OC_WEIGHT'), OW = grab(R + '/js/mkobj.js', 'OC_WEIGHT'), CW = grab(R + '/js/mkobj.js', 'CLASS_OC_WEIGHT');
console.log('C weight classes uniform? ring', new Set(c.objects.filter(o => o.class === 4).map(o => o.weight)), 'amulet', new Set(c.objects.filter(o => o.class === 5).map(o => o.weight)), 'potion', new Set(c.objects.filter(o => o.class === 8 && o.i>=297).map(o => o.weight)), 'scroll', new Set(c.objects.filter(o => o.class === 9 && o.i>=323).map(o => o.weight)), 'book', new Set(c.objects.filter(o => o.class === 10 && o.i>=366).map(o => o.weight)), 'wand', new Set(c.objects.filter(o => o.class === 11).map(o => o.weight)));
console.log('CLASS_OC_WEIGHT', CW);
// OC_WEIGHT / BASE_OC_WEIGHT / cost per-table checks
let w1 = 0; for (const [k, v] of Object.entries(OW)) if (c.objects[+k].weight !== v) { w1++; console.log('OC_WEIGHT mismatch', k, c.objects[+k].name, 'C', c.objects[+k].weight, 'JS', v); }
let w2 = 0; for (const [k, v] of Object.entries(BW)) if (c.objects[+k].weight !== v) { w2++; console.log('BASE_OC_WEIGHT mismatch', k, c.objects[+k].name, 'C', c.objects[+k].weight, 'JS', v); }
let w3 = 0;
console.log('weight table mism', w1, w2, 'cost table mism', w3, 'total', bad);

console.log('RESULT food/armor delay tables + weights mismatches=' + (bad + w2 + w3)); process.exitCode = (bad + w2 + w3) ? 1 : 0;
