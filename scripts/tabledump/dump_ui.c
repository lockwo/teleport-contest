/* Included copy of u_init.c so its static tables are reachable. */
#include "../../nethack-c/recorder/src/u_init.c"
static void js(FILE*f,const char*s){ if(!s){fputs("null",f);return;} fputc('"',f); for(;*s;s++){ if(*s=='"'||*s=='\\') fprintf(f,"\\%c",*s); else if((unsigned char)*s<32) fprintf(f,"\\u%04x",*s); else fputc(*s,f);} fputc('"',f);}
static void tro(FILE*f,const char*name,const struct trobj*t){
    fprintf(f,"%s:[",name); 
    for(;t->trotyp||t->trclass;t++) fprintf(f,"[%d,%d,%d,%d,%d,%d],",t->trotyp,t->trspe,t->trclass,t->trquan_min,t->trquan_max,t->trbless);
    fputs("],\n",f);}
static void sk(FILE*f,const char*name,const struct def_skill*t){
    fprintf(f,"%s:[",name);
    for(;t->skill!=P_NONE;t++) fprintf(f,"[%d,%d],",t->skill,t->skmax);
    fputs("],\n",f);}
void dump_ui(FILE*f){
    fputs("{\n",f);
#define T(n) tro(f,"\"" #n "\"",n);
    T(Archeologist) T(Barbarian_0) T(Barbarian_1) T(Cave_man) T(Healer) T(Knight) T(Monk) T(Priest) T(Ranger) T(Rogue) T(Samurai) T(Tourist) T(Valkyrie) T(Wizard)
    T(Healing_book) T(Protection_book) T(Confuse_monster_book) T(Tinopener) T(Magicmarker) T(Lamp) T(Blindfold) T(Xtra_food) T(Leash) T(Towel) T(Wishing) T(Money)
#define S(n) sk(f,"\"" #n "\"",n);
    S(Skill_A) S(Skill_B) S(Skill_C) S(Skill_H) S(Skill_K) S(Skill_Mon) S(Skill_P) S(Skill_R) S(Skill_Ran) S(Skill_S) S(Skill_T) S(Skill_V) S(Skill_W)
    fputs("\"inv_subs\":[",f);
    for(const struct inv_sub*s=inv_subs;s->race_pm>=0;s++) fprintf(f,"[%d,%d,%d],",s->race_pm,s->item_otyp,s->subs_otyp);
    fputs("]\n}",f);
}
