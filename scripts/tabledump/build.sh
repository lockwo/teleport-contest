#!/bin/sh
# builds /tmp/tabledump from the recorder objects and dumps /tmp/ctables.json
set -e
R=${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
cd $R/nethack-c/recorder/src
D=$(cd "$(dirname "$0")" && pwd)
L=$(make -n -W allmain.c nethack 2>&1 | grep -A8 "Linking" | tr '\\' ' ' | tr -s ' \t\n' ' ' | sed 's/.*cc  *-o nethack//; s/ touch Sysunix.*//; s/ echo .*//' | sed 's/ u_init.o / /; s/ artifact.o / /')
F="-g -I../include -DNOTPARMDECL -DNO_TIMED_DELAY -w"
cc $F -c -o /tmp/d_ui.o $D/dump_ui.c; cc $F -c -o /tmp/d_art.o $D/dump_art.c; cc $F -c -o /tmp/d_main.o $D/dump_main.c; cc $F -c -o /tmp/d_enum.o $D/dump_enum.c
cc -o /tmp/tabledump /tmp/d_ui.o /tmp/d_art.o /tmp/d_main.o /tmp/d_enum.o $L
/tmp/tabledump > /tmp/ctables.json
