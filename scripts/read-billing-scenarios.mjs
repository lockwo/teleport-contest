// Local faithful-recorder recipes, loaded by gen.mjs with NODE_OPTIONS=--import.
// Requires the optional swarm tooling. See docs/recording-environment.md.
import { H } from '../swarm/lib/gscen-recipes.mjs';
const { def, gotoShop, DIRK, wishL, inv } = H;

async function command(ctx, keys) {
    await ctx.k(keys);
    await ctx.more();
}

async function setup(ctx) {
    for (const item of await inv(ctx)) {
        if (/being worn/.test(item.d)) {
            await command(ctx, 'T');
            if (/What do you want/.test(ctx.top)) await command(ctx, item.l);
        }
    }
    let found = null;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
        await ctx.tele(2);
        if (attempt) await ctx.ext('wizmakemap');
        found = await gotoShop(ctx, { levels: [2], want: /general store/ });
    }
    if (!found) throw new Error('No general store found');
    await command(ctx, DIRK[found.shop.dir.join(',')]);
    const spot = found.shop.cells.find(([x, y]) => ctx.ch(x, y) === '.'
        && Math.max(Math.abs(x - found.shop.door[0]), Math.abs(y - found.shop.door[1])) > 1)
        || found.shop.cells.find(([x, y]) =>
            Math.max(Math.abs(x - found.shop.door[0]), Math.abs(y - found.shop.door[1])) > 1);
    if (!spot || !await ctx.tport(...spot)) throw new Error('Could not enter shop interior');
}

async function sellAndReclaim(ctx, description, match) {
    const letter = await wishL(ctx, description);
    if (!letter) throw new Error('Wish did not yield an inventory letter');
    await command(ctx, 'd' + letter);
    if (/Sell |\[ynaq\]|\[ynq\]/.test(ctx.top)) await command(ctx, 'y');
    await command(ctx, ',');
    if (/Pick up what/.test(ctx.text)) await command(ctx, ',\r');
    const item = (await inv(ctx)).find((it) => match.test(it.d) && /unpaid/.test(it.d));
    if (!item) throw new Error('Sold item was not reclaimed as unpaid');
    return item.l;
}

async function shopWater(ctx) {
    for (let attempt = 0; attempt < 50; attempt++) {
        await ctx.tele(2);
        if (attempt) await ctx.ext('wizmakemap');
        const found = await gotoShop(ctx, { levels: [2] });
        if (!found) continue;
        await command(ctx, DIRK[found.shop.dir.join(',')]);
        for (const spot of found.shop.cells.filter(([x, y]) => ctx.ch(x, y) === '!')) {
            if (!await ctx.tport(...spot)) continue;
            await command(ctx, ':');
            if (!/clear potion/.test(ctx.top)) continue;
            await command(ctx, ',');
            if (/Pick up what/.test(ctx.text)) await command(ctx, ',\r');
            const water = (await inv(ctx)).find((item) => /clear potion.*unpaid/.test(item.d));
            if (water) return water.l;
        }
    }
    throw new Error('No unpaid plain water found');
}

async function read(ctx, scroll) {
    await command(ctx, 'r' + scroll);
    if (/Call a scroll/.test(ctx.top)) await command(ctx, '\x1b');
    await inv(ctx);
    await command(ctx, '$');
}

for (const mode of ['armor-enchant', 'armor-proof', 'destroy-proof', 'weapon-proof', 'water-uncurse', 'water-confused']) {
    def('read-billing-' + mode, 'read.c unpaid billing: ' + mode, async (ctx) => {
        if (mode !== 'water-confused') await setup(ctx);
        if (mode === 'armor-enchant') {
            const armor = await sellAndReclaim(ctx, 'uncursed +0 pair of high boots', /boots/);
            await command(ctx, 'W' + armor);
            await read(ctx, await wishL(ctx, 'uncursed scroll of enchant armor'));
            await read(ctx, await wishL(ctx, 'cursed scroll of enchant armor'));
        } else if (mode.endsWith('proof')) {
            const weapon = mode === 'weapon-proof';
            const item = await sellAndReclaim(ctx,
                weapon ? 'uncursed rustproof +0 long sword' : 'uncursed fireproof +0 pair of speed boots',
                weapon ? /long sword/ : /boots/);
            await command(ctx, (weapon ? 'w' : 'W') + item);
            const scroll = await wishL(ctx, mode === 'destroy-proof'
                ? 'uncursed scroll of destroy armor'
                : 'cursed scroll of enchant ' + (weapon ? 'weapon' : 'armor'));
            const confusion = await wishL(ctx, 'cursed potion of confusion');
            await command(ctx, 'q' + confusion);
            await read(ctx, scroll);
        } else {
            const water = mode === 'water-confused' ? await shopWater(ctx)
                : await sellAndReclaim(ctx, 'potion of unholy water', /potion/);
            await command(ctx, 'w' + water);
            const scroll = await wishL(ctx, 'blessed scroll of remove curse');
            if (mode === 'water-confused') {
                const confusion = await wishL(ctx, 'cursed potion of confusion');
                await command(ctx, 'q' + confusion);
            }
            await read(ctx, scroll);
        }
    }, { nodec: true, roles: ['Wizard'], maxKeys: 6000 });
}
