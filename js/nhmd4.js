// nhmd4.js — MD4 (RFC-1320) message digest.  C ref: src/nhmd4.c.
//
// C guards the whole file with `#ifdef CRASHREPORT`; the digest is used only to
// tag a traceback with the identity of the binary that produced it, never for
// security.  Ported for completeness: no other module calls it.
//
// C's `const unsigned char *` walk over the input is expressed here as an
// integer offset into a Uint8Array, and nhmd4_body() returns the offset C
// returns as a pointer.
//
// Every arithmetic step is forced back to 32 bits with `>>> 0` because C's
// quint32 wraps; JS numbers do not.

/* include/nhmd4.h NHMD4_RESULTLEN */
export const NHMD4_RESULTLEN = 16;

/* include/nhmd4.h struct nhmd4_context.  `block` is the SET()/GET() scratch
   word array; `buffer` is the 64-byte partial-block accumulator. */
export function nhmd4_context() {
    return {
        lo: 0, hi: 0,
        a: 0, b: 0, c: 0, d: 0,
        block: new Uint32Array(16),
        buffer: new Uint8Array(64),
    };
}

/* nhmd4.c:43 #define F(x, y, z) ((z) ^ ((x) & ((y) ^ (z)))) */
function F(x, y, z) { return (z ^ (x & (y ^ z))) >>> 0; }
/* nhmd4.c:44 #define G(x, y, z) (((x)&(y)) | ((x)&(z)) | ((y)&(z))) */
function G(x, y, z) { return ((x & y) | (x & z) | (y & z)) >>> 0; }
/* nhmd4.c:45 #define H(x, y, z) ((x) ^ (y) ^ (z)) */
function H(x, y, z) { return (x ^ y ^ z) >>> 0; }

/* nhmd4.c:53 #define STEP(f, a, b, c, d, x, s) — returns the new 'a'. */
function STEP(f, a, b, c, d, x, s) {
    a = (a + f(b, c, d) + x) >>> 0;
    return (((a << s) | (a >>> (32 - s))) >>> 0);
}

/* Processes one or more 64-byte data blocks, but does NOT update the bit
   counters.  `data` is a Uint8Array, `off` the C `data` pointer and `size` a
   multiple of 64; returns the offset C returns in `ptr`.
   C ref: nhmd4.c:82. */
export function nhmd4_body(ctx, data, size, off = 0) {
    let ptr = off;
    let a = ctx.a >>> 0, b = ctx.b >>> 0, c = ctx.c >>> 0, d = ctx.d >>> 0;
    let saved_a, saved_b, saved_c, saved_d;

    /* nhmd4.c:69 SET(n): read 4 input bytes little-endian into ctx->block[n].
       nhmd4.c:75 GET(n): re-read that word.  (The __i386__/__x86_64__ variant
       reads straight from ptr for both, which yields the same values.) */
    const SET = (n) => {
        ctx.block[n] = ((data[ptr + n * 4]
                         | (data[ptr + n * 4 + 1] << 8)
                         | (data[ptr + n * 4 + 2] << 16)
                         | (data[ptr + n * 4 + 3] << 24)) >>> 0);
        return ctx.block[n];
    };
    const GET = (n) => ctx.block[n];

    do {
        saved_a = a;
        saved_b = b;
        saved_c = c;
        saved_d = d;

        /* Round 1 */
        a = STEP(F, a, b, c, d, SET(0), 3);
        d = STEP(F, d, a, b, c, SET(1), 7);
        c = STEP(F, c, d, a, b, SET(2), 11);
        b = STEP(F, b, c, d, a, SET(3), 19);

        a = STEP(F, a, b, c, d, SET(4), 3);
        d = STEP(F, d, a, b, c, SET(5), 7);
        c = STEP(F, c, d, a, b, SET(6), 11);
        b = STEP(F, b, c, d, a, SET(7), 19);

        a = STEP(F, a, b, c, d, SET(8), 3);
        d = STEP(F, d, a, b, c, SET(9), 7);
        c = STEP(F, c, d, a, b, SET(10), 11);
        b = STEP(F, b, c, d, a, SET(11), 19);

        a = STEP(F, a, b, c, d, SET(12), 3);
        d = STEP(F, d, a, b, c, SET(13), 7);
        c = STEP(F, c, d, a, b, SET(14), 11);
        b = STEP(F, b, c, d, a, SET(15), 19);
        /* Round 2 */
        a = STEP(G, a, b, c, d, (GET(0) + 0x5A827999) >>> 0, 3);
        d = STEP(G, d, a, b, c, (GET(4) + 0x5A827999) >>> 0, 5);
        c = STEP(G, c, d, a, b, (GET(8) + 0x5A827999) >>> 0, 9);
        b = STEP(G, b, c, d, a, (GET(12) + 0x5A827999) >>> 0, 13);

        a = STEP(G, a, b, c, d, (GET(1) + 0x5A827999) >>> 0, 3);
        d = STEP(G, d, a, b, c, (GET(5) + 0x5A827999) >>> 0, 5);
        c = STEP(G, c, d, a, b, (GET(9) + 0x5A827999) >>> 0, 9);
        b = STEP(G, b, c, d, a, (GET(13) + 0x5A827999) >>> 0, 13);

        a = STEP(G, a, b, c, d, (GET(2) + 0x5A827999) >>> 0, 3);
        d = STEP(G, d, a, b, c, (GET(6) + 0x5A827999) >>> 0, 5);
        c = STEP(G, c, d, a, b, (GET(10) + 0x5A827999) >>> 0, 9);
        b = STEP(G, b, c, d, a, (GET(14) + 0x5A827999) >>> 0, 13);

        a = STEP(G, a, b, c, d, (GET(3) + 0x5A827999) >>> 0, 3);
        d = STEP(G, d, a, b, c, (GET(7) + 0x5A827999) >>> 0, 5);
        c = STEP(G, c, d, a, b, (GET(11) + 0x5A827999) >>> 0, 9);
        b = STEP(G, b, c, d, a, (GET(15) + 0x5A827999) >>> 0, 13);
        /* Round 3 */
        a = STEP(H, a, b, c, d, (GET(0) + 0x6ED9EBA1) >>> 0, 3);
        d = STEP(H, d, a, b, c, (GET(8) + 0x6ED9EBA1) >>> 0, 9);
        c = STEP(H, c, d, a, b, (GET(4) + 0x6ED9EBA1) >>> 0, 11);
        b = STEP(H, b, c, d, a, (GET(12) + 0x6ED9EBA1) >>> 0, 15);

        a = STEP(H, a, b, c, d, (GET(2) + 0x6ED9EBA1) >>> 0, 3);
        d = STEP(H, d, a, b, c, (GET(10) + 0x6ED9EBA1) >>> 0, 9);
        c = STEP(H, c, d, a, b, (GET(6) + 0x6ED9EBA1) >>> 0, 11);
        b = STEP(H, b, c, d, a, (GET(14) + 0x6ED9EBA1) >>> 0, 15);

        a = STEP(H, a, b, c, d, (GET(1) + 0x6ED9EBA1) >>> 0, 3);
        d = STEP(H, d, a, b, c, (GET(9) + 0x6ED9EBA1) >>> 0, 9);
        c = STEP(H, c, d, a, b, (GET(5) + 0x6ED9EBA1) >>> 0, 11);
        b = STEP(H, b, c, d, a, (GET(13) + 0x6ED9EBA1) >>> 0, 15);

        a = STEP(H, a, b, c, d, (GET(3) + 0x6ED9EBA1) >>> 0, 3);
        d = STEP(H, d, a, b, c, (GET(11) + 0x6ED9EBA1) >>> 0, 9);
        c = STEP(H, c, d, a, b, (GET(7) + 0x6ED9EBA1) >>> 0, 11);
        b = STEP(H, b, c, d, a, (GET(15) + 0x6ED9EBA1) >>> 0, 15);

        a = (a + saved_a) >>> 0;
        b = (b + saved_b) >>> 0;
        c = (c + saved_c) >>> 0;
        d = (d + saved_d) >>> 0;

        ptr += 64;
    } while ((size -= 64) !== 0);

    ctx.a = a;
    ctx.b = b;
    ctx.c = c;
    ctx.d = d;

    return ptr;
}

/* C ref: nhmd4.c:182. */
export function nhmd4_init(ctx) {
    ctx.a = 0x67452301;
    ctx.b = 0xefcdab89;
    ctx.c = 0x98badcfe;
    ctx.d = 0x10325476;

    ctx.lo = 0;
    ctx.hi = 0;
}

/* C ref: nhmd4.c:195.  `data` is a Uint8Array; C's pointer arithmetic on it is
   an offset here. */
export function nhmd4_update(ctx, data, size, off = 0) {
    let saved_lo;
    let used, free;

    saved_lo = ctx.lo >>> 0;
    ctx.lo = ((saved_lo + size) & 0x1fffffff) >>> 0;
    if (ctx.lo < saved_lo)
        ctx.hi = (ctx.hi + 1) >>> 0;
    ctx.hi = (ctx.hi + Math.floor(size / 0x20000000)) >>> 0;  /* size >> 29 */

    used = saved_lo & 0x3f;

    if (used) {
        free = 64 - used;

        if (size < free) {
            ctx.buffer.set(data.subarray(off, off + size), used);
            return;
        }

        ctx.buffer.set(data.subarray(off, off + free), used);
        off += free;
        size -= free;
        nhmd4_body(ctx, ctx.buffer, 64, 0);
    }

    if (size >= 64) {
        off = nhmd4_body(ctx, data, size & ~0x3f, off);
        size &= 0x3f;
    }

    ctx.buffer.set(data.subarray(off, off + size), 0);
}

/* C ref: nhmd4.c:234.  `result` is a Uint8Array of NHMD4_RESULTLEN bytes. */
export function nhmd4_final(ctx, result) {
    let used, free;

    used = ctx.lo & 0x3f;

    ctx.buffer[used++] = 0x80;

    free = 64 - used;

    if (free < 8) {
        ctx.buffer.fill(0, used, used + free);
        nhmd4_body(ctx, ctx.buffer, 64, 0);
        used = 0;
        free = 64;
    }

    ctx.buffer.fill(0, used, used + (free - 8));

    ctx.lo = (ctx.lo << 3) >>> 0;
    ctx.buffer[56] = ctx.lo & 0xff;
    ctx.buffer[57] = (ctx.lo >>> 8) & 0xff;
    ctx.buffer[58] = (ctx.lo >>> 16) & 0xff;
    ctx.buffer[59] = (ctx.lo >>> 24) & 0xff;
    ctx.buffer[60] = ctx.hi & 0xff;
    ctx.buffer[61] = (ctx.hi >>> 8) & 0xff;
    ctx.buffer[62] = (ctx.hi >>> 16) & 0xff;
    ctx.buffer[63] = (ctx.hi >>> 24) & 0xff;

    nhmd4_body(ctx, ctx.buffer, 64, 0);

    result[0] = ctx.a & 0xff;
    result[1] = (ctx.a >>> 8) & 0xff;
    result[2] = (ctx.a >>> 16) & 0xff;
    result[3] = (ctx.a >>> 24) & 0xff;
    result[4] = ctx.b & 0xff;
    result[5] = (ctx.b >>> 8) & 0xff;
    result[6] = (ctx.b >>> 16) & 0xff;
    result[7] = (ctx.b >>> 24) & 0xff;
    result[8] = ctx.c & 0xff;
    result[9] = (ctx.c >>> 8) & 0xff;
    result[10] = (ctx.c >>> 16) & 0xff;
    result[11] = (ctx.c >>> 24) & 0xff;
    result[12] = ctx.d & 0xff;
    result[13] = (ctx.d >>> 8) & 0xff;
    result[14] = (ctx.d >>> 16) & 0xff;
    result[15] = (ctx.d >>> 24) & 0xff;

    /* memset(ctx, 0, sizeof *ctx) */
    ctx.a = ctx.b = ctx.c = ctx.d = 0;
    ctx.lo = ctx.hi = 0;
    ctx.block.fill(0);
    ctx.buffer.fill(0);
}

/*nhmd4.js*/
