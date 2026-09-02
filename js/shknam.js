// shknam.js — shop stocking (stock_room / shkinit / mkshobj_at).
// C ref: shknam.c.
//
// Imported by sp_lev.js (fill_special_room).  Does NOT import sp_lev.js, so no
// circular dependency.  The shop-type table + get_shop_item live in shtypes.js
// (a leaf module) so makemon.js's set_mimic_sym can share them.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { depth } from './hacklib.js';
import { distmin } from './hacklib.js';
import { IS_ROOM, ROOMOFFSET, D_NODOOR, D_ISOPEN, D_LOCKED, D_TRAPPED,
         SDOOR, DOOR, CORR, ROOM, MM_ESHK } from './const.js';
import { mksobj, mksobj_at, mkobj_at, objects, weight, CORPSE } from './mkobj.js';
import { set_tin_variety, HEALTHY_TIN } from './eat.js';
import { makemon, mkclass, mpickobj, name_to_pmidx, monster_by_pmidx } from './makemon.js';
import { make_engr_at } from './engrave.js';
import { shtypes, get_shop_item, VEGETARIAN_CLASS } from './shtypes.js';
import { Is_special } from './dungeon.js';
import { obj_resists } from './zap.js';

// C ref: shknam.c shkliquors[]..shkgeneral[] — per-shop-type personal name
// pools for nameshk().  Platform-conditional entries (#ifdef OVERLAY/WIN32/
// MACOS9/AMIGA/TOS/OS2/VMS) are omitted; the Unix build never defines them.
const shkliquors = [
    'Njezjin', 'Tsjernigof', 'Ossipewsk', 'Gorlowka', 'Gomel',
    'Konosja', 'Weliki Oestjoeg', 'Syktywkar', 'Sablja', 'Narodnaja', 'Kyzyl',
    'Walbrzych', 'Swidnica', 'Klodzko', 'Raciborz', 'Gliwice', 'Brzeg',
    'Krnov', 'Hradec Kralove',
    'Leuk', 'Brig', 'Brienz', 'Thun', 'Sarnen', 'Burglen', 'Elm', 'Flims',
    'Vals', 'Schuls', 'Zum Loch',
];
const shkbooks = [
    'Skibbereen', 'Kanturk', 'Rath Luirc', 'Ennistymon',
    'Lahinch', 'Kinnegad', 'Lugnaquillia', 'Enniscorthy',
    'Gweebarra', 'Kittamagh', 'Nenagh', 'Sneem',
    'Ballingeary', 'Kilgarvan', 'Cahersiveen', 'Glenbeigh',
    'Kilmihil', 'Kiltamagh', 'Droichead Atha', 'Inniscrone',
    'Clonegal', 'Lisnaskea', 'Culdaff', 'Dunfanaghy',
    'Inishbofin', 'Kesh',
];
const shkarmors = [
    'Demirci', 'Kalecik', 'Boyabai', 'Yildizeli', 'Gaziantep',
    'Siirt', 'Akhalataki', 'Tirebolu', 'Aksaray', 'Ermenak',
    'Iskenderun', 'Kadirli', 'Siverek', 'Pervari', 'Malasgirt',
    'Bayburt', 'Ayancik', 'Zonguldak', 'Balya', 'Tefenni',
    'Artvin', 'Kars', 'Makharadze', 'Malazgirt', 'Midyat',
    'Birecik', 'Kirikkale', 'Alaca', 'Polatli', 'Nallihan',
];
const shkwands = [
    'Yr Wyddgrug', 'Trallwng', 'Mallwyd', 'Pontarfynach', 'Rhaeader',
    'Llandrindod', 'Llanfair-ym-muallt', 'Y-Fenni', 'Maesteg', 'Rhydaman',
    'Beddgelert', 'Curig', 'Llanrwst', 'Llanerchymedd', 'Caergybi',
    'Nairn', 'Turriff', 'Inverurie', 'Braemar', 'Lochnagar', 'Kerloch',
    'Beinn a Ghlo', 'Drumnadrochit', 'Morven', 'Uist', 'Storr',
    'Sgurr na Ciche', 'Cannich', 'Gairloch', 'Kyleakin', 'Dunvegan',
];
const shkrings = [
    'Feyfer', 'Flugi', 'Gheel', 'Havic', 'Haynin',
    'Hoboken', 'Imbyze', 'Juyn', 'Kinsky', 'Massis',
    'Matray', 'Moy', 'Olycan', 'Sadelin', 'Svaving',
    'Tapper', 'Terwen', 'Wirix', 'Ypey',
    'Rastegaisa', 'Varjag Njarga', 'Kautekeino', 'Abisko', 'Enontekis',
    'Rovaniemi', 'Avasaksa', 'Haparanda', 'Lulea', 'Gellivare',
    'Oeloe', 'Kajaani', 'Fauske',
];
const shkfoods = [
    'Djasinga', 'Tjibarusa', 'Tjiwidej', 'Pengalengan',
    'Bandjar', 'Parbalingga', 'Bojolali', 'Sarangan',
    'Ngebel', 'Djombang', 'Ardjawinangun', 'Berbek',
    'Papar', 'Baliga', 'Tjisolok', 'Siboga',
    'Banjoewangi', 'Trenggalek', 'Karangkobar', 'Njalindoeng',
    'Pasawahan', 'Pameunpeuk', 'Patjitan', 'Kediri',
    'Pemboeang', 'Tringanoe', 'Makin', 'Tipor',
    'Semai', 'Berhala', 'Tegal', 'Samoe',
];
const shkweapons = [
    'Voulgezac', 'Rouffiac', 'Lerignac', 'Touverac', 'Guizengeard',
    'Melac', 'Neuvicq', 'Vanzac', 'Picq', 'Urignac',
    'Corignac', 'Fleac', 'Lonzac', 'Vergt', 'Queyssac',
    'Liorac', 'Echourgnac', 'Cazelon', 'Eypau', 'Carignan',
    'Monbazillac', 'Jonzac', 'Pons', 'Jumilhac', 'Fenouilledes',
    'Laguiolet', 'Saujon', 'Eymoutiers', 'Eygurande', 'Eauze',
    'Labouheyre',
];
const shktools = [
    'Ymla', 'Eed-morra', 'Elan Lapinski', 'Cubask', 'Nieb', 'Bnowr Falr',
    'Sperc', 'Noskcirdneh', 'Yawolloh', 'Hyeghu', 'Niskal', 'Trahnil',
    'Htargcm', 'Enrobwem', 'Kachzi Rellim', 'Regien', 'Donmyar', 'Yelpur',
    'Nosnehpets', 'Stewe', 'Renrut', 'Senna Hut', '-Zlaw', 'Nosalnef',
    'Rewuorb', 'Rellenk', 'Yad', 'Cire Htims', 'Y-crad', 'Nenilukah',
    'Corsh', 'Aned', 'Dark Eery', 'Niknar', 'Lapu', 'Lechaim',
    'Rebrol-nek', 'AlliWar Wickson', 'Oguhmk', 'Telloc Cyaj',
];
const shkhealthfoods = [
    "Ga'er", 'Zhangmu', 'Rikaze', 'Jiangji', 'Changdu',
    'Linzhi', 'Shigatse', 'Gyantse', 'Ganden', 'Tsurphu',
    'Lhasa', 'Tsedong', 'Drepung',
    '=Azura', '=Blaze', '=Breanna', '=Breezy', '=Dharma',
    '=Feather', '=Jasmine', '=Luna', '=Melody', '=Moonjava',
    '=Petal', '=Rhiannon', '=Starla', '=Tranquilla', '=Windsong',
    '=Zennia', '=Zoe', '=Zora',
];
const shklight = [
    'Zarnesti', 'Slanic', 'Nehoiasu', 'Ludus', 'Sighisoara', 'Nisipitu',
    'Razboieni', 'Bicaz', 'Dorohoi', 'Vaslui', 'Fetesti', 'Tirgu Neamt',
    'Babadag', 'Zimnicea', 'Zlatna', 'Jiu', 'Eforie', 'Mamaia',
    'Silistra', 'Tulovo', 'Panagyuritshte', 'Smolyan', 'Kirklareli', 'Pernik',
    'Lom', 'Haskovo', 'Dobrinishte', 'Varvara', 'Oryahovo', 'Troyan',
    'Lovech', 'Sliven',
];
const shkgeneral = [
    'Hebiwerie', 'Possogroenoe', 'Asidonhopo', 'Manlobbi',
    'Adjama', 'Pakka Pakka', 'Kabalebo', 'Wonotobo',
    'Akalapi', 'Sipaliwini',
    'Annootok', 'Upernavik', 'Angmagssalik',
    'Aklavik', 'Inuvik', 'Tuktoyaktuk', 'Chicoutimi',
    'Ouiatchouane', 'Chibougamau', 'Matagami', 'Kipawa',
    'Kinojevis', 'Abitibi', 'Maganasipi',
    'Akureyri', 'Kopasker', 'Budereyri', 'Akranes',
    'Bordeyri', 'Holmavik',
];

// C ref: shknam.c shtypes[].shknms field — map the shtypes.js identity tag to
// the actual name pool.
const SHKNAME_POOL = {
    general: shkgeneral, armors: shkarmors, books: shkbooks,
    liquors: shkliquors, weapons: shkweapons, foods: shkfoods,
    rings: shkrings, wands: shkwands, tools: shktools,
    healthfoods: shkhealthfoods, light: shklight,
};

// C ref: dungeon.c ledger_no() — dlevel + the dungeon's ledger_start.
function ledger_no_of(uz) {
    const dungeon = game.dungeons?.[uz?.dnum ?? 0];
    return (dungeon?.ledger_start ?? 0) + (uz?.dlevel ?? 1);
}

// C ref: u_init.c/calendar.c — ubirthday is the game-start wall-clock time
// (mktime'd from the recording datetime), used only as nameshk()'s
// game-to-game name seed.  The recording process ran at a FIXED UTC-4 offset
// (no DST): that is the only whole-hour offset that reproduces all four
// recorded shopkeeper names across both DST seasons — seed0012 "Adjama" (May),
// seed0002 "Ermenak" (Apr), seed0030 seg3 "Maganasipi" and seg7 "Swidnica"
// (Jan/Feb).  A DST-observing US zone fits only the April/May pair.
const UBIRTHDAY_UTC_OFFSET = -4 * 3600;
function ubirthdaySeconds() {
    const dt = String(game.datetime || '');
    if (!/^\d{14}$/.test(dt)) return 0;
    const y = +dt.slice(0, 4), mo = +dt.slice(4, 6), d = +dt.slice(6, 8);
    const h = +dt.slice(8, 10), mi = +dt.slice(10, 12), s = +dt.slice(12, 14);
    return Math.trunc(Date.UTC(y, mo - 1, d, h, mi, s) / 1000) - UBIRTHDAY_UTC_OFFSET;
}

// C ref: shknam.c nameshk() — extract a personal shopkeeper name for the
// given shop-name pool; sets shk.eshk.shknam and shk.female.  RNG-neutral
// except the shktools pool (rn2(names_avail) per retry) and the rare
// same-level-name-collision retry.
function nameshk(shk, poolKey) {
    let nlp = SHKNAME_POOL[poolKey];
    if (!nlp) return; // unknown pool: leave unnamed (falls back to species name)

    if (poolKey === 'light') {
        // C: minetown lighting shk special-case — the 'light' shtype (prob 0)
        // is only ever placed via the Mine Town special level.
        shk.eshk.shknam = '+Izchak';
        shk.female = 0;
        return;
    }

    const nseed = Math.trunc(ubirthdaySeconds() / 257);
    let name_wanted = shk.m_id + ledger_no_of(game.u?.uz) + (nseed % 13) - (nseed % 5);
    if (name_wanted < 0) name_wanted += 18;
    shk.female = name_wanted & 1;

    let names_avail = nlp.length;
    name_wanted = name_wanted % names_avail;

    let shname = null;
    for (let trycnt = 0; trycnt < 50; trycnt++) {
        if (nlp === shktools) {
            shname = shktools[rn2(names_avail)];
            shk.female = 0; // reversed below for '_' prefix
        } else if (name_wanted < names_avail) {
            shname = nlp[name_wanted];
        } else {
            const i = rn2(names_avail);
            if (i !== 0) {
                shname = nlp[i - 1];
            } else if (nlp !== shkgeneral) {
                nlp = shkgeneral;
                names_avail = nlp.length;
                continue;
            } else {
                shname = shk.female ? '-Lucrezia' : '+Dirk';
            }
        }
        if (shname[0] === '_' || shname[0] === '-') shk.female = 1;
        else if (shname[0] === '|' || shname[0] === '+') shk.female = 0;

        // is name already in use on this level?
        let collision = false;
        for (const mtmp of game.level?.monsters || []) {
            if (mtmp === shk || !mtmp.isshk) continue;
            if (mtmp.mhp != null && mtmp.mhp <= 0) continue;
            if (mtmp.eshk?.shknam === shname) { collision = true; break; }
        }
        if (!collision) break;
        name_wanted = names_avail; // try a random name
    }
    shk.eshk.shknam = shname;
}

const FOOD_CLASS = 7;
const S_MIMIC = 13;
// 263 is BELL_OF_OPENING and 343 is SCR_STINKING_CLOUD; both indices were wrong,
// and mongets_shk() feeds the otyp straight to mksobj() (RNG-consuming).
const SKELETON_KEY = 221, TOUCHSTONE = 472, SCR_CHARGING = 342;
const GOLD_PIECE = 438;
const DUST = 1;      // engrave.h DUST

// C ref: shknam.c veggy_item(NULL, otyp) — the type-only mode used by
// shkveg(): a FOOD_CLASS item whose material is VEGGY or which is an egg is
// veggy outright; TIN and CORPSE are "items which might go either way" and
// the type-only caller stands in a corpsenm of PM_LICHEN (mlet S_FUNGUS,
// vegan() true), so both are unconditionally veggy in this mode too.
const VEGGY_MATERIAL = 3; // mkobj.js VEGGY material index
const EGG_OTYP = 266;
function veggy_item_type(otyp) {
    const o = objects[otyp];
    if (!o || o.oc_class !== FOOD_CLASS) return false;
    if (o.material === VEGGY_MATERIAL || otyp === EGG_OTYP) return true;
    if (otyp === TIN_OTYP || otyp === CORPSE) return true;
    return false;
}

// C ref: shknam.c shkveg() — pick a random vegetarian food item by oc_prob.
// js/mkobj.js's objects[] table has a synthetic "generic food" class-marker
// entry (oc_prob 0) that does not sit contiguously before the real FOOD_CLASS
// otyp range, so (unlike C's svb.bases[oclass]-anchored scan) this cannot
// assume contiguity — scan the whole table and filter by class instead.
function shkveg() {
    const oclass = FOOD_CLASS;
    const ok = [];
    let maxprob = 0;
    for (let i = 0; i < objects.length; i++) {
        if (!objects[i] || objects[i].oc_class !== oclass) continue;
        if (veggy_item_type(i)) { ok.push(i); maxprob += (objects[i].oc_prob || 0); }
    }
    if (maxprob < 1 || ok.length === 0) return EGG_OTYP;
    let prob = rnd(maxprob);
    let j = 0, i = ok[0];
    while ((prob -= (objects[i].oc_prob || 0)) > 0) { j++; i = ok[j]; }
    return i;
}

const TIN_OTYP = 296;
// C ref: shknam.c mkveggy_at().
function mkveggy_at(sx, sy) {
    const obj = mksobj_at(shkveg(), sx, sy, true, true);
    if (obj && obj.otyp === TIN_OTYP && typeof set_tin_variety === 'function')
        set_tin_variety(obj, HEALTHY_TIN);
    return obj;
}

// C ref: rm.h MON_AT — a live monster occupies <x,y>.
function MON_AT(x, y) {
    for (const m of game.level?.monsters || []) {
        if (m.mx === x && m.my === y && (m.mhp == null || m.mhp > 0)) return true;
    }
    return false;
}

// C ref: shknam.c mkshobj_at() — make an object of the appropriate type for a
// shop square.  shp is a shtypes[] entry; shp_indx its index.
function mkshobj_at(shp, shp_indx, sx, sy, mkspecl) {
    // 3.6 tribute: rare/secondhand bookstore special spot gets a novel.
    if (mkspecl && (shp.name === 'rare books' || shp.name === 'second-hand bookstore')) {
        const novel = mksobj_at(408 /* SPE_NOVEL (385 is SPE_CLAIRVOYANCE) */, sx, sy, false, false);
        if (novel) game._tribute_bookstock = true;
        return;
    }

    if (rn2(100) < depth(game.u?.uz) && !MON_AT(sx, sy)) {
        const ptr = mkclass(S_MIMIC, 0);
        if (ptr) {
            const m = makemon(ptr, sx, sy, 0 /*NO_MM_FLAGS*/);
            if (m) return; // mimic created
        }
    }
    const atype = get_shop_item(shp_indx);
    if (atype === VEGETARIAN_CLASS) {
        mkveggy_at(sx, sy);
    } else if (atype < 0) {
        mksobj_at(-atype, sx, sy, true, true);
    } else {
        mkobj_at(atype, sx, sy, true);
    }
}

// C ref: shknam.c good_shopdoor() — find the shop entrance door and the inside
// square adjacent to it.  Returns the doors[] index (svd.doors) or -1.
function good_shopdoor(sroom) {
    const doors = game.level?.doors || [];
    for (let i = 0; i < (sroom.doorct || 0); i++) {
        const di = sroom.fdoor + i;
        const d = doors[di];
        if (!d) continue;
        let sx = d.x, sy = d.y;
        // Regular rectangular shop: shift the door coordinate one square inside.
        if (sx === sroom.lx - 1) sx++;
        else if (sx === sroom.hx + 1) sx--;
        else if (sy === sroom.ly - 1) sy++;
        else if (sy === sroom.hy + 1) sy--;
        else continue;
        return { di, sx, sy };
    }
    return { di: -1, sx: 0, sy: 0 };
}

// C ref: shknam.c shkinit() — create the shopkeeper monster.
function shkinit(shp, sroom) {
    const sd = good_shopdoor(sroom);
    if (sd.di < 0) return -1;
    const { di: sh, sx, sy } = sd;

    const shkPmidx = name_to_pmidx('shopkeeper');
    const shkPtr = monster_by_pmidx(shkPmidx);
    const shk = makemon(shkPtr, sx, sy, MM_ESHK);
    if (!shk) return -1;
    shk.isshk = 1;
    shk.mpeaceful = 1;
    shk.msleeping = 0;
    shk.eshk = shk.eshk || {};
    shk.eshk.shoproom = (sroom.roomnoidx ?? 0) + ROOMOFFSET;
    sroom.resident = shk;
    shk.eshk.shoptype = sroom.rtype;
    // C ref: shknam.c:674 `eshkp->shd = svd.doors[sh]` — a struct copy BY VALUE.
    // Storing the reference makes flip_level() flip this coord twice (once via
    // level.doors[], once via eshk.shd) and leaves the other alias unflipped.
    shk.eshk.shd = { ...game.level.doors[sh] };
    shk.eshk.shk = { x: sx, y: sy };

    // C ref: mkmonmoney(shk, 1000 + 30 * rnd(100)) — initial capital.  The gold
    // is a real mksobj(GOLD_PIECE, FALSE) -> next_ident rnd(2), and it goes
    // into minvent: mdrop_special_objs() counts it.
    const amount = 1000 + 30 * rnd(100);
    if (amount > 0) {
        const gold = mksobj(GOLD_PIECE, false, false);
        if (gold) {
            gold.quan = amount;
            gold.owt = weight(gold);
            shk._hasinv = true;
            mpickobj(shk, gold);
        }
    }

    if (shp.shknms === 'rings') mongets_shk(shk, TOUCHSTONE);
    if (shp.shknms === 'tools' || shp.shknms === 'wands'
        || (shp.shknms === 'rings' && rn2(2))
        || (shp.shknms === 'general' && rn2(5))) {
        mongets_shk(shk, SCR_CHARGING);
    }
    nameshk(shk, shp.shknms);
    return sh;
}

// C ref: makemon.c mongets() — give a monster a freshly made object.  For a
// shopkeeper (not demon/minion/mplayer/prince), the only RNG is mksobj().
function mongets_shk(mtmp, otyp) {
    if (!otyp) return null;
    const otmp = mksobj(otyp, true, false);
    if (mtmp && otmp) { mtmp._hasinv = true; mpickobj(mtmp, otmp); }
    return otmp;
}

// C ref: shknam.c stock_room_goodpos() — a square eligible for stocking.
function stock_room_goodpos(sroom, rmno, shDoor, sx, sy) {
    const doors = game.level?.doors || [];
    const dd = doors[shDoor];
    if (!dd) return false;
    // Regular (non-irregular) shop edge test.
    if ((sx === sroom.lx && dd.x === sx - 1)
        || (sx === sroom.hx && dd.x === sx + 1)
        || (sy === sroom.ly && dd.y === sy - 1)
        || (sy === sroom.hy && dd.y === sy + 1))
        return false;
    const loc = game.level?.at(sx, sy);
    if (!loc || !IS_ROOM(loc.typ)) return false;
    return true;
}

// C ref: shknam.c stock_room() — stock a newly-created shop room.
export function stock_room(shp_indx, sroom) {
    const shp = shtypes[shp_indx];
    const rmno = (sroom.roomnoidx ?? 0) + ROOMOFFSET;

    const was_full = game._full_mon_gen;
    game._full_mon_gen = true;
    let sh;
    try {
        sh = shkinit(shp, sroom);
    } finally {
        game._full_mon_gen = was_full;
    }
    if (sh < 0) return;

    // Door fixups (no RNG): ensure the shop door is real and not trapped.
    const doors = game.level.doors;
    const fd = doors[sroom.fdoor];
    if (fd) {
        const loc = game.level.at(fd.x, fd.y);
        if (loc) {
            if (loc.doormask === D_NODOOR) loc.doormask = D_ISOPEN;
            if (loc.typ === SDOOR) loc.typ = DOOR;
            if (loc.doormask & D_TRAPPED) loc.doormask = D_LOCKED;
            if (loc.doormask === D_LOCKED) {
                let m = fd.x, n = fd.y;
                if (inside_shop(fd.x + 1, fd.y)) m--;
                else if (inside_shop(fd.x - 1, fd.y)) m++;
                if (inside_shop(fd.x, fd.y + 1)) n--;
                else if (inside_shop(fd.x, fd.y - 1)) n++;
                make_engr_at(m, n, 'Closed for inventory', null, 0, DUST);
                const ml = game.level.at(m, n);
                // C: `levl[m][n].typ = (Is_special(&u.uz) || *in_rooms(m, n, 0))
                //                       ? ROOM : CORR;`
                if (ml && ml.typ !== CORR && ml.typ !== ROOM)
                    ml.typ = (Is_special(game.u?.uz) || in_any_room(m, n)) ? ROOM : CORR;
            }
        }
    }

    // C ref: tribute special-spot — choose one stocking spot to receive the
    // tribute item.  The recorder runs with tribute enabled.
    let stockcount = 0, specialspot = 0;
    if (!game._tribute_bookstock) {
        for (let sx = sroom.lx; sx <= sroom.hx; sx++)
            for (let sy = sroom.ly; sy <= sroom.hy; sy++)
                if (stock_room_goodpos(sroom, rmno, sh, sx, sy)) stockcount++;
        specialspot = rnd(stockcount); // shknam.c:777
        stockcount = 0;
    }

    const was_full2 = game._full_mon_gen;
    game._full_mon_gen = true;
    try {
        for (let sx = sroom.lx; sx <= sroom.hx; sx++)
            for (let sy = sroom.ly; sy <= sroom.hy; sy++)
                if (stock_room_goodpos(sroom, rmno, sh, sx, sy)) {
                    stockcount++;
                    mkshobj_at(shp, shp_indx, sx, sy, stockcount === specialspot);
                }
    } finally {
        game._full_mon_gen = was_full2;
    }

    // C ref: shknam.c:794 — "Hack for Orcus's level: it's a ghost town, get rid
    // of shopkeepers".  mongone() -> mdrop_special_objs() (steal.c:862) rolls
    // obj_resists(obj, 0, 0) for EVERY minvent item, so the shopkeeper's
    // inventory size is worth that many rn2(100) draws before the next shop's
    // shkinit().
    const orc = game.orcus_level;
    if (orc && game.u?.uz?.dnum === orc.dnum && game.u?.uz?.dlevel === orc.dlevel)
        shk_mongone(sroom.resident, sroom);

    if (game.level?.flags) game.level.flags.has_shop = true;
    // C ref: shknam.c has exactly two references to context.tribute.bookstock —
    // it is set TRUE once at :466 and read at :768; it is NEVER reset.  Clearing
    // it per shop made every shop after the first bookstore draw a spurious
    // rnd(stockcount) at shknam.c:777.
}

// C ref: mon.c:3267 mongone(mdef) — the shopkeeper leaves the game without
// dying.  mdrop_special_objs() walks minvent and calls obj_resists(obj, 0, 0)
// on each; with ochance 0 only the invocation tools / the Amulet / a Rider
// corpse pass, and those are the ones that skip the rn2(100) entirely.
// m_detach() then takes the monster off the map and shkgone() (shk.c:247)
// clears sroom->resident.
function shk_mongone(shk, sroom) {
    if (!shk) return;
    shk.mhp = 0;
    for (const obj of [...(shk.minvent || [])]) obj_resists(obj, 0, 0);
    shk.minvent = [];                    // discard_minvent(shk, FALSE)
    const list = game.level?.monsters;
    if (list) {
        const i = list.indexOf(shk);
        if (i >= 0) list.splice(i, 1);
    }
    if (sroom) sroom.resident = null;
    shk.isshk = 0;
}

// C ref: shk.c inside_shop() — is <x,y> inside any shop room (returns the
// shop's room number, or 0).  We only need a boolean for the door fixup.
function inside_shop(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const rno = (loc.roomno ?? 0) - ROOMOFFSET;
    if (rno < 0) return false;
    const r = game.level.rooms[rno];
    return !!(r && r.rtype >= 14 /*SHOPBASE*/);
}

// C ref: hack.c *in_rooms(x, y, 0) — non-empty iff <x,y> is roomno-assigned to
// a real room (typewanted==0 means "any room type").  Like inside_shop() above,
// this treats a SHARED/SHARED_PLUS boundary square (roomno 1 or 2) as "not in
// a room", matching that function's existing simplification.
function in_any_room(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return (loc.roomno ?? 0) - ROOMOFFSET >= 0;
}
