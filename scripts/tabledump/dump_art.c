#include "../../nethack-c/recorder/src/artifact.c"
static void jsa(FILE*f,const struct attack*a){ fprintf(f,"[%d,%d,%d,%d]",a->aatyp,a->adtyp,a->damn,a->damd);}
static void js(FILE*f,const char*s){ if(!s){fputs("null",f);return;} fputc('"',f); for(;*s;s++){ if(*s=='"'||*s=='\\') fprintf(f,"\\%c",*s); else fputc(*s,f);} fputc('"',f);}
void dump_art(FILE*f){
    const struct artifact*a; fputs("[\n",f);
    for(a=artilist;;a++){
        fprintf(f,"{\"otyp\":%d,\"name\":",a->otyp); js(f,a->name);
        fprintf(f,",\"spfx\":%lu,\"cspfx\":%lu,\"mtype\":%lu,\"attk\":",a->spfx,a->cspfx,a->mtype); jsa(f,&a->attk);
        fputs(",\"defn\":",f); jsa(f,&a->defn); fputs(",\"cary\":",f); jsa(f,&a->cary);
        fprintf(f,",\"inv_prop\":%d,\"alignment\":%d,\"role\":%d,\"race\":%d,\"gen_spe\":%d,\"gift_value\":%d,\"cost\":%ld,\"acolor\":%d}",
            a->inv_prop,a->alignment,a->role,a->race,a->gen_spe,a->gift_value,a->cost,a->acolor);
        if(!a->otyp && a!=artilist) break;
        fputs(",\n",f);
    }
    fputs("]",f);
}
