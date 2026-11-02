#include "hack.h"
extern void dump_ui(FILE*); extern void dump_enums(FILE*); extern void dump_art(FILE*);
extern const struct shclass shtypes[];
static void js(FILE*f,const char*s){ if(!s){fputs("null",f);return;} fputc('"',f); for(;*s;s++){ if(*s=='"'||*s=='\\') fprintf(f,"\\%c",*s); else if((unsigned char)*s<32) fprintf(f,"\\u%04x",*s); else fputc(*s,f);} fputc('"',f);}
static void atk(FILE*f,const struct attack*a){ fprintf(f,"[%d,%d,%d,%d]",a->aatyp,a->adtyp,a->damn,a->damd);}
static void ra(FILE*f,const struct RoleAdvance*a){ fprintf(f,"[%d,%d,%d,%d,%d,%d]",a->infix,a->inrnd,a->lofix,a->lornd,a->hifix,a->hirnd);}
__attribute__((constructor)) static void dumpall(void){
    FILE*f=stdout; int i,j; objects_globals_init(); monst_globals_init(); for(i=0;i<NUM_OBJECTS;i++) objects[i].oc_name_idx=objects[i].oc_descr_idx=i;
    fputs("{\"objects\":[\n",f);
    for(i=0;i<NUM_OBJECTS;i++){ const struct objclass*o=&objects[i];
        fprintf(f,"{\"i\":%d,\"name\":",i); js(f,OBJ_NAME(*o)); fputs(",\"descr\":",f); js(f,OBJ_DESCR(*o));
        fprintf(f,",\"merge\":%d,\"magic\":%d,\"charged\":%d,\"unique\":%d,\"nowish\":%d,\"big\":%d,\"tough\":%d,\"dir\":%d,\"material\":%d,\"subtyp\":%d,\"oprop\":%d,\"class\":%d,\"delay\":%d,\"color\":%d,\"prob\":%d,\"weight\":%u,\"cost\":%d,\"wsdam\":%d,\"wldam\":%d,\"oc1\":%d,\"oc2\":%d,\"nutrition\":%u,\"uses_known\":%d,\"name_known\":%d}%s\n",
            o->oc_merge,o->oc_magic,o->oc_charged,o->oc_unique,o->oc_nowish,o->oc_big,o->oc_tough,o->oc_dir,o->oc_material,o->oc_subtyp,o->oc_oprop,o->oc_class,o->oc_delay,o->oc_color,o->oc_prob,o->oc_weight,o->oc_cost,o->oc_wsdam,o->oc_wldam,o->oc_oc1,o->oc_oc2,o->oc_nutrition,o->oc_uses_known,o->oc_name_known,i<NUM_OBJECTS-1?",":""); }
    fprintf(f,"],\n\"NUM_OBJECTS\":%d,\n\"mons\":[\n",NUM_OBJECTS);
    for(i=0;i<NUMMONS;i++){ const struct permonst*m=&mons[i];
        fprintf(f,"{\"i\":%d,\"pmidx\":%d,\"names\":[",i,m->pmidx); for(j=0;j<NUM_MGENDERS;j++){js(f,m->pmnames[j]);fputc(',',f);}
        fprintf(f,"],\"mlet\":%d,\"mlevel\":%d,\"mmove\":%d,\"ac\":%d,\"mr\":%d,\"align\":%d,\"geno\":%u,\"mattk\":[",m->mlet,m->mlevel,m->mmove,m->ac,m->mr,m->maligntyp,m->geno);
        for(j=0;j<NATTK;j++){atk(f,&m->mattk[j]);fputc(',',f);}
        fprintf(f,"],\"cwt\":%u,\"cnutrit\":%u,\"msound\":%d,\"msize\":%d,\"mresists\":%d,\"mconveys\":%d,\"mflags1\":%lu,\"mflags2\":%lu,\"mflags3\":%u,\"difficulty\":%d,\"mcolor\":%d}%s\n",
            m->cwt,m->cnutrit,m->msound,m->msize,m->mresists,m->mconveys,m->mflags1,m->mflags2,m->mflags3,m->difficulty,m->mcolor,i<NUMMONS-1?",":""); }
    fprintf(f,"],\n\"NUMMONS\":%d,\n\"artilist\":",NUMMONS); dump_art(f);
    fputs(",\n\"roles\":[\n",f);
    for(i=0;roles[i].name.m;i++){ const struct Role*r=&roles[i];
        fprintf(f,"{\"name\":["); js(f,r->name.m);fputc(',',f);js(f,r->name.f);
        fputs("],\"rank\":[",f); for(j=0;j<9;j++){fputc('[',f);js(f,r->rank[j].m);fputc(',',f);js(f,r->rank[j].f);fputs("],",f);}
        fputs("],\"gods\":[",f); js(f,r->lgod);fputc(',',f);js(f,r->ngod);fputc(',',f);js(f,r->cgod);
        fputs("],\"filecode\":",f);js(f,r->filecode);fputs(",\"homebase\":",f);js(f,r->homebase);fputs(",\"intermed\":",f);js(f,r->intermed);
        fprintf(f,",\"nums\":[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d],\"allow\":%d,\"attrbase\":[",r->mnum,r->petnum,r->ldrnum,r->guardnum,r->neminum,r->enemy1num,r->enemy2num,r->enemy1sym,r->enemy2sym,r->questarti,r->allow);
        for(j=0;j<A_MAX;j++)fprintf(f,"%d,",r->attrbase[j]); fputs("],\"attrdist\":[",f); for(j=0;j<A_MAX;j++)fprintf(f,"%d,",r->attrdist[j]);
        fputs("],\"hpadv\":",f);ra(f,&r->hpadv);fputs(",\"enadv\":",f);ra(f,&r->enadv);
        fprintf(f,",\"xlev\":%d,\"initrecord\":%d,\"spel\":[%d,%d,%d,%d,%d,%d,%d]}%s\n",r->xlev,r->initrecord,r->spelbase,r->spelheal,r->spelshld,r->spelarmr,r->spelstat,r->spelspec,r->spelsbon,roles[i+1].name.m?",":""); }
    fputs("],\n\"races\":[\n",f);
    for(i=0;races[i].noun;i++){ const struct Race*r=&races[i];
        fputs("{\"strs\":[",f);js(f,r->noun);fputc(',',f);js(f,r->adj);fputc(',',f);js(f,r->coll);fputc(',',f);js(f,r->filecode);fputc(',',f);js(f,r->individual.m);fputc(',',f);js(f,r->individual.f);
        fprintf(f,"],\"nums\":[%d,%d,%d],\"allow\":%d,\"masks\":[%d,%d,%d],\"attrmin\":[",r->mnum,r->mummynum,r->zombienum,r->allow,r->selfmask,r->lovemask,r->hatemask);
        for(j=0;j<A_MAX;j++)fprintf(f,"%d,",r->attrmin[j]); fputs("],\"attrmax\":[",f); for(j=0;j<A_MAX;j++)fprintf(f,"%d,",r->attrmax[j]);
        fputs("],\"hpadv\":",f);ra(f,&r->hpadv);fputs(",\"enadv\":",f);ra(f,&r->enadv);fprintf(f,"}%s\n",races[i+1].noun?",":""); }
    fputs("],\n\"shtypes\":[\n",f);
    for(i=0;shtypes[i].name;i++){ const struct shclass*s=&shtypes[i];
        fputs("{\"name\":",f);js(f,s->name);fputs(",\"annot\":",f);js(f,s->annotation);fprintf(f,",\"symb\":%d,\"prob\":%d,\"shdist\":%d,\"iprobs\":[",s->symb,s->prob,s->shdist);
        for(j=0;j<9&&s->iprobs[j].iprob;j++)fprintf(f,"[%d,%d],",s->iprobs[j].iprob,s->iprobs[j].itype);
        fputs("],\"shknms\":[",f); if(s->shknms){ for(j=0;s->shknms[j];j++){js(f,s->shknms[j]);fputc(',',f);} }
        fprintf(f,"]}%s\n",shtypes[i+1].name?",":""); }
    fputs("],\n\"defsyms\":[\n",f);
    for(i=0;i<MAXPCHARS;i++){ const struct symdef*s=&defsyms[i]; fprintf(f,"[%d,%d,",i,s->sym);js(f,s->explanation);fprintf(f,",%d,%d]%s\n",s->color,0,i<MAXPCHARS-1?",":""); }
    fputs("],\n\"oc_syms\":[\n",f);
    for(i=0;i<MAXOCLASSES;i++){ fprintf(f,"[%d,%d,",i,def_oc_syms[i].sym);js(f,def_oc_syms[i].name);fputc(',',f);js(f,def_oc_syms[i].explain);fprintf(f,"]%s\n",i<MAXOCLASSES-1?",":""); }
    fputs("],\n\"monsyms\":[\n",f);
    for(i=0;i<MAXMCLASSES;i++){ fprintf(f,"[%d,%d,",i,def_monsyms[i].sym);js(f,def_monsyms[i].name);fputc(',',f);js(f,def_monsyms[i].explain);fprintf(f,"]%s\n",i<MAXMCLASSES-1?",":""); }
    fputs("],\n\"warnsyms\":[\n",f);
    for(i=0;i<WARNCOUNT;i++){ fprintf(f,"[%d,%d,",i,def_warnsyms[i].sym);js(f,def_warnsyms[i].explanation);fprintf(f,",%d]%s\n",def_warnsyms[i].color,i<WARNCOUNT-1?",":""); }
    fputs("],\n\"u_init\":",f); dump_ui(f);
    { const char*e=getenv("TD_SEEDS"); fputs(",\n\"shuffles\":{",f);
      if(e){ char*b=strdup(e),*t,*sv; for(t=strtok_r(b,",",&sv);t;t=strtok_r(NULL,",",&sv)){ unsigned long seed=strtoul(t,0,10);
        objects_globals_init(); init_isaac64(seed, rn2); init_objects();
        fprintf(f,"\"%s\":{\"o\":[",t);
        for(i=0;i<NUM_OBJECTS;i++){ const struct objclass*o=&objects[i]; fprintf(f,"[%d,%d,%d,%d,%d,%d,%d,%d],",o->oc_name_idx,o->oc_descr_idx,o->oc_color,o->oc_tough,o->oc_material,o->oc_dir,o->oc_name_known,o->oc_prob); }
        fputs("],\"bases\":[",f); for(i=0;i<=MAXOCLASSES;i++) fprintf(f,"%d,",svb.bases[i]);
        fputs("],\"totals\":[",f); for(i=0;i<MAXOCLASSES;i++) fprintf(f,"%d,",go.oclass_prob_totals[i]);
        fputs("]},",f); } }
      fputs("}",f); }
    fputs(",\n\"fn\":{\"newuexp\":[",f); for(i=0;i<=40;i++) fprintf(f,"%ld,",newuexp(i)); fputs("],\"xlev_to_rank\":[",f); for(i=0;i<=40;i++) fprintf(f,"%d,",xlev_to_rank(i)); fputs("]}",f);
    fputs(",\n\"enums\":",f); dump_enums(f); fputs("\n}\n",f); fflush(f); _exit(0); }
