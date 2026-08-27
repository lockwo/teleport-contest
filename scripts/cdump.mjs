import { readFileSync } from 'node:fs';
const ROOT = process.env.REPO_ROOT || process.cwd();
const { normalizeSession } = await import(ROOT+'/frozen/session_loader.mjs');
const j = JSON.parse(readFileSync(ROOT+'/sessions/'+process.argv[2],'utf8'));
const segs = normalizeSession(j).segments;
const lo=+process.argv[3], hi=+process.argv[4];
let scr=-1;
for(const seg of segs){ for(const step of seg.steps||[]){ if(step.screen){ scr++; if(scr>=lo&&scr<=hi){ const txt=step.screen.replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'').split('\n')[0]; console.log('=== screen-step',scr,'top:',JSON.stringify(txt.slice(0,50))); const rng=(step.rng||[]).map(r=>typeof r==='string'?r.replace(/^\d+\s+/,''):JSON.stringify(r)); console.log('  rng count:',rng.length); for(const e of rng) console.log('   ',e); } } } }
