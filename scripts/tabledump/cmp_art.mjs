import { loadC } from './load.mjs';
const R = process.env.REPO_ROOT || process.cwd();
await import(R + '/js/jsmain.js');
const ar = await import(R + '/js/artifact.js');
const c = loadC().artilist;
console.log('C rows', c.length, 'JS rows', ar.artilist.length);
let bad = 0;
const J = ar.artilist;
for (let i = 0; i < Math.max(c.length - 1, J.length); i++) {
  const a = c[i], b = J[i];
  if (!a || !b) { console.log('row', i, 'missing', !!a, !!b); bad++; continue; }
  const cj = { otyp: a.otyp, name: a.name, spfx: a.spfx, cspfx: a.cspfx, mtype: a.mtype,
    attk: a.attk.slice(1), defn: a.defn.slice(1), cary: a.cary.slice(1), aat: [a.attk[0], a.defn[0], a.cary[0]],
    inv_prop: a.inv_prop, alignment: a.alignment, role: a.role, race: a.race, gen_spe: a.gen_spe, gift_value: a.gift_value, cost: a.cost, acolor: a.acolor };
  const ab = (x) => [x.adtyp, x.damn, x.damd];
  const jj = { otyp: b.otyp, name: b.name, spfx: b.spfx, cspfx: b.cspfx, mtype: b.mtype,
    attk: ab(b.attk), defn: ab(b.defn), cary: ab(b.cary), aat: [0, 0, 0],
    inv_prop: b.inv_prop, alignment: b.alignment, role: b.role, race: b.race, gen_spe: b.gen_spe, gift_value: b.gift_value, cost: b.cost, acolor: b.acolor };
  for (const k in cj) if (JSON.stringify(cj[k]) !== JSON.stringify(jj[k])) { bad++; console.log(i, a.name, k, 'C', JSON.stringify(cj[k]), 'JS', JSON.stringify(jj[k])); }
}
console.log('artilist mismatches', bad);

console.log('RESULT artilist mismatches=' + (bad)); process.exitCode = (bad) ? 1 : 0;
