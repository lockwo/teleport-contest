#include "hack.h"
#define DUMP_ENUMS
static struct enum_dump e_mons[] = {
#include "monsters.h"
    { NUMMONS, "NUMMONS" }, { NON_PM, "NON_PM" }, { LOW_PM, "LOW_PM" }, { HIGH_PM, "HIGH_PM" }, { SPECIAL_PM, "SPECIAL_PM" } };
static struct enum_dump e_obj[] = {
#include "objects.h"
    { NUM_OBJECTS, "NUM_OBJECTS" } };
#define DUMP_ENUMS_PCHAR
static struct enum_dump e_cmap[] = {
#include "defsym.h"
    { MAXPCHARS, "MAXPCHARS" } };
#undef DUMP_ENUMS_PCHAR
#define DUMP_ENUMS_MONSYMS
static struct enum_dump e_monsym[] = {
#include "defsym.h"
    { MAXMCLASSES, "MAXMCLASSES" } };
#undef DUMP_ENUMS_MONSYMS
#define DUMP_ENUMS_OBJCLASS_CLASSES
static struct enum_dump e_ocls[] = {
#include "defsym.h"
    { MAXOCLASSES, "MAXOCLASSES" } };
#undef DUMP_ENUMS_OBJCLASS_CLASSES
#define DUMP_ARTI_ENUM
static struct enum_dump e_arti[] = {
#include "artilist.h"
    { AFTER_LAST_ARTIFACT, "AFTER_LAST_ARTIFACT" } };
#undef DUMP_ARTI_ENUM
#undef DUMP_ENUMS
#define DEMIT(arr) do { fprintf(f, "\"" #arr "\":{"); for (i = 0; i < (int)(sizeof arr / sizeof arr[0]); i++) fprintf(f, "\"%s\":%d,", arr[i].nm, arr[i].val); fputs("},\n", f); } while (0)
void dump_enums(FILE *f) { int i; fputs("{", f); DEMIT(e_mons); DEMIT(e_obj); DEMIT(e_cmap); DEMIT(e_monsym); DEMIT(e_ocls); DEMIT(e_arti); fputs("\"end\":0}", f); }
