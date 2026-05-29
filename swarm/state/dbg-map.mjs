// Batch divergence map: for each session, report first diverging screen step + reason.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { decodeScreen, diffCell, ROWS_24, COLS_80 } from '../../frozen/screen-decode.mjs';
import { normalizeSession } from '../../frozen/session_loader.mjs';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const STARTUP = [/Version\s+\d+\.\d+\.\d+[^\n]*/];
function preDecode(s){let c=String(s);for(const re of STARTUP)c=c.replace(re,'<<VB>>');c=c.replace(/^\d{2}:\d{2}:\d{2}\.$/gm,'<t>.');return c;}
function firstNonblankLine(g){for(let r=0;r<ROWS_24;r++){const t=g[r].map(c=>c&&c.ch!=null&&c.ch!==''?c.ch:' ').join('').replace(/\s+$/,'');if(t.trim())return 'r'+r+':'+t.slice(0,46);}return '(blank)';}
function firstDiff(ga,gb){for(let r=0;r<ROWS_24;r++)for(let c=0;c<COLS_80;c++)if(diffCell(ga[r][c],gb[r][c]))return {r,c};return null;}

const dir=join(PROJECT_ROOT,'sessions');
const files=readdirSync(dir).filter(f=>f.endsWith('.session.json')).sort();
const { runSegment } = await import(join(PROJECT_ROOT,'js/jsmain.js'));

for(const f of files){
  const sessionData=JSON.parse(readFileSync(join(dir,f),'utf8'));
  const segments=normalizeSession(sessionData).segments;
  const rc=segments[0].nethackrc||'';
  const hasName=/name:/.test(rc);
  const roleM=rc.match(/role:(\w+)/); const hasRole=!!roleM;
  const cScreens=[],cCursors=[];
  for(const seg of segments)for(const st of seg.steps||[]){if(st.screen){cScreens.push(st.screen);cCursors.push(st.cursor||null);}}
  const storage=new Map();
  const sh={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),get length(){return storage.size;},key(i){let n=0;for(const k of storage.keys()){if(n===i)return k;n++;}return null;}};
  let jsScreens=[],jsCursors=[],err=null;
  try{for(const seg of segments){const inp={seed:seg.seed,datetime:seg.datetime,nethackrc:seg.nethackrc,moves:seg.moves,storage:sh};const g=await runSegment(inp);jsScreens.push(...(g.getScreens?.()||[]));jsCursors.push(...(g.getCursors?.()||[]));}}catch(e){err=e.message;}
  let firstBad=-1,reason='',cLine='',jLine='';
  for(let i=0;i<cScreens.length;i++){
    const ga=decodeScreen(preDecode(jsScreens[i]||''));const gb=decodeScreen(preDecode(cScreens[i]||''));
    const d=firstDiff(ga,gb);
    const curOk=!Array.isArray(cCursors[i])||(Array.isArray(jsCursors[i])&&cCursors[i][0]===jsCursors[i][0]&&cCursors[i][1]===jsCursors[i][1]&&cCursors[i][2]===jsCursors[i][2]);
    if(d||!curOk){firstBad=i;reason=d?('cell@r'+d.r+'c'+d.c):('cursor C='+JSON.stringify(cCursors[i])+' JS='+JSON.stringify(jsCursors[i]));cLine=firstNonblankLine(gb);jLine=firstNonblankLine(ga);break;}
  }
  const tag=(hasName?'N':'-')+(hasRole?'R':'-');
  const role=roleM?roleM[1]:'?';
  console.log(`${f.replace('.session.json','').replace('seed','').padEnd(40)} ${tag} ${String(cScreens.length).padStart(4)}st firstBad=${String(firstBad).padStart(4)} ${reason}`);
  if(firstBad>=0){console.log(`     C : ${cLine}`);console.log(`     JS: ${jLine}`);}
  if(err)console.log('     ERR:',err);
}
