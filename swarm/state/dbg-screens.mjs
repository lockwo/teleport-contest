// Debug: dump JS vs recorded screens for first N steps of a session.
// Usage: node swarm/state/dbg-screens.mjs <session.json> [maxSteps]
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { decodeScreen, diffCell, ROWS_24, COLS_80 } from '../../frozen/screen-decode.mjs';
import { normalizeSession } from '../../frozen/session_loader.mjs';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const sessionPath = process.argv[2];
const maxSteps = Number(process.argv[3] || 3);

const STARTUP = [/Version\s+\d+\.\d+\.\d+[^\n]*/];
function preDecode(s){let c=String(s);for(const re of STARTUP)c=c.replace(re,'<<VB>>');c=c.replace(/^\d{2}:\d{2}:\d{2}\.$/gm,'<t>.');return c;}
function gridToText(g){
  return g.map(row=>row.map(cell=>{
    const ch = cell && cell.ch!=null ? cell.ch : ' ';
    return ch===''||ch==null?' ':ch;
  }).join('')).join('\n');
}
function firstDiff(ga,gb){
  for(let r=0;r<ROWS_24;r++)for(let c=0;c<COLS_80;c++){
    if(diffCell(ga[r][c],gb[r][c])) return {r,c,a:ga[r][c],b:gb[r][c]};
  }
  return null;
}

const sessionData = JSON.parse(readFileSync(sessionPath,'utf8'));
const { runSegment } = await import(join(PROJECT_ROOT,'js/jsmain.js'));
const segments = normalizeSession(sessionData).segments;

const cScreens=[], cCursors=[];
for(const seg of segments) for(const step of seg.steps||[]){ if(step.screen){cScreens.push(step.screen);cCursors.push(step.cursor||null);} }

const storage=new Map();
const storageHandle={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),get length(){return storage.size;},key(i){let n=0;for(const k of storage.keys()){if(n===i)return k;n++;}return null;}};
let jsScreens=[],jsCursors=[],jsError=null;
try{
  for(const seg of segments){
    const input={seed:seg.seed,datetime:seg.datetime,nethackrc:seg.nethackrc,moves:seg.moves,storage:storageHandle};
    const g=await runSegment(input);
    jsScreens.push(...(g.getScreens?.()||[]));
    jsCursors.push(...(g.getCursors?.()||[]));
  }
}catch(e){jsError=e.message+'\n'+e.stack;}

console.log('session:',sessionPath.split('/').pop());
console.log('jsError:',jsError);
console.log('cScreens:',cScreens.length,'jsScreens:',jsScreens.length);
const N=Math.min(maxSteps,cScreens.length);
for(let i=0;i<N;i++){
  const ga=decodeScreen(preDecode(jsScreens[i]||''));
  const gb=decodeScreen(preDecode(cScreens[i]||''));
  const d=firstDiff(ga,gb);
  const curOk = !Array.isArray(cCursors[i]) || (Array.isArray(jsCursors[i]) && cCursors[i][0]===jsCursors[i][0]&&cCursors[i][1]===jsCursors[i][1]&&cCursors[i][2]===jsCursors[i][2]);
  console.log(`\n===== STEP ${i} ${d?'CELLS-DIFFER':'cells-OK'} cursor:${curOk?'OK':'DIFF'} (C=${JSON.stringify(cCursors[i])} JS=${JSON.stringify(jsCursors[i])}) =====`);
  if(d){
    console.log(`first cell diff @ r${d.r} c${d.c}: JS=${JSON.stringify(d.a)} C=${JSON.stringify(d.b)}`);
    console.log('--- JS grid ---');
    console.log(gridToText(ga));
    console.log('--- C grid ---');
    console.log(gridToText(gb));
  }
}
