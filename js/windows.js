// windows.js -- windows.c's menu-window API (create_nhwindow(NHW_MENU), start_menu,
// add_menu, add_menu_str, add_menu_heading, end_menu, select_menu, destroy_nhwindow)
// over the one tty menu implementation this port has: select_command_menu()
// (js/invent.js, the process_menu_window()/tty_select_menu() port) plus
// dismiss_invent_screen() (tty_dismiss_nhwindow()'s erase_menu_or_text()).
//
// Every ported C menu builder (spell.c, botl.c, o_init.c, options.c, cmd.c, ...)
// fills a window object with these calls and reads select_menu()'s result the way
// C does: a count (-1 when the player used ESC) and `picks`, the menu_item array
// of { item: <the anything passed to add_menu>, count } in menu order.
import { game } from './gstate.js';
import { menuHeadAttr } from './menuattr.js';
import { NO_COLOR, ATR_NONE, ATR_BOLD, ATR_UNDERLINE, ATR_INVERSE } from './terminal.js';

// C ref: decl.c nul_glyphinfo.
export const nul_glyphinfo = { glyph: 0, ttychar: ' ', gm: {} };

const MENU_ITEMFLAGS_SELECTED = 0x1;

// options.c's menu-colour/attribute enum (ATR_BOLD 1, ATR_ULINE 4, ATR_INVERSE 7)
// to terminal.js's render bits.
function render_attr(attr) {
    return attr === 1 ? ATR_BOLD : attr === 4 ? ATR_UNDERLINE
        : attr === 7 ? ATR_INVERSE : undefined;
}

// State of an options.c handler (doset.js runOptionsHandler) that drives menus: its
// parent menu's docrt() left the status window blank and no bot() repaints it
// until a message does.  Inactive for every other caller.
export const menu_ctx = { active: false, blankStatus: false };

export function create_nhwindow(type) { return { type, items: [], query: '', lines: [] }; }
export function destroy_nhwindow(_win) {}
export function start_menu(win, behave) { win.items.length = 0; win.behave = behave; }
// C ref: wintty.c tty_add_menu() — an entry whose identifier is zero (a_void)
// is not selectable.
export function add_menu(win, _glyphinfo, any, accel, gacc, attr, clr, str, itemflags) {
    win.items.push({ any, accel, gacc, attr, clr, str, itemflags,
                     selectable: !!any && Object.values(any).some(Boolean) });
}
export function add_menu_str(win, str) {
    win.items.push({ any: null, str, selectable: false });
}
export function add_menu_heading(win, str) {
    win.items.push({ any: null, str, heading: true, selectable: false });
}
export function end_menu(win, query) { win.query = query; }
export function putstr(win, _attr, str) { win.lines.push(str); }

// C ref: windows.c select_menu() holds gb.bot_disabled across the selection AND
// the dismissal's docrt()+flush_screen(1).  Returns the pick count (-1 on ESC);
// `picks` receives { item, count } per selected entry.
export async function select_menu(win, how, picks) {
    const { select_command_menu, dismiss_invent_screen, menu_page_pending } = await import('./invent.js');
    const entries = [
        ...(win.query ? [{ text: win.query, attr: menuHeadAttr() }, { text: '' }] : []),
        ...win.items.map((it) => ({
            text: it.str,
            attr: it.heading ? menuHeadAttr() : render_attr(it.attr),
            bodyStyle: it.selectable ? (() => {
                const coloring = game.flags?.menucolors
                    ? game.menucolors?.find((rule) => rule.regex.test(it.str)) : null;
                const attr = coloring?.attr ?? it.attr;
                const color = coloring?.color ?? it.clr ?? NO_COLOR;
                return {
                    color: color === 7 ? NO_COLOR : color,
                    attr: render_attr(attr) ?? ATR_NONE,
                };
            })() : undefined,
            item: it.selectable ? {
                value: it.any,
                sel: it.accel || undefined,
                gsel: it.gacc || undefined,
                selected: !!(it.itemflags & MENU_ITEMFLAGS_SELECTED),
                count: -1,
            } : undefined,
        })),
    ];
    const old_bot_disabled = game.bot_disabled;
    game.bot_disabled = true;
    try {
        // the --More-- that pages a pending message repaints the status window
        if (await menu_page_pending() && menu_ctx.active) menu_ctx.blankStatus = false;
        const committed = await select_command_menu(entries, {
            how, blankStatus: menu_ctx.active && menu_ctx.blankStatus,
        });
        // A full-screen (offx 0) menu is torn down by docrt() under bot_disabled:
        // the status rows stay blank until the next bot().
        if (menu_ctx.active && game._menuOffx === 0) menu_ctx.blankStatus = true;
        await dismiss_invent_screen();
        if (!committed) return -1;
        for (const e of entries)
            if (e.item?.selected) picks.push({ item: e.item.value, count: e.item.count });
        return picks.length;
    } finally {
        game.bot_disabled = old_bot_disabled;
    }
}
