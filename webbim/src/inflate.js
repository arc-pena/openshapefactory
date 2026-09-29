//! A small raw-DEFLATE decoder (RFC 1951), synchronous, for data the page carries compressed - the
//! drawings lifted from a PDF, which are text and deflate to a quarter of their size. After tinf
//! (Joergen Ibsen): stored, fixed and dynamic Huffman blocks.

function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
const sltree = new Tree(), sdtree = new Tree();
const lengthBits = new Uint8Array(30), lengthBase = new Uint16Array(30), distBits = new Uint8Array(30), distBase = new Uint16Array(30);
const clcidx = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
function buildBitsBase(bits, base, delta, first) {
  for (let i = 0; i < delta; i++) bits[i] = 0;
  for (let i = 0; i < 30 - delta; i++) bits[i + delta] = (i / delta) | 0;
  for (let sum = first, i = 0; i < 30; i++) { base[i] = sum; sum += 1 << bits[i]; }
}
const offs = new Uint16Array(16);
function buildTree(t, lengths, off, num) {
  t.table.fill(0);
  for (let i = 0; i < num; i++) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (let sum = 0, i = 0; i < 16; i++) { offs[i] = sum; sum += t.table[i]; }
  for (let i = 0; i < num; i++) if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
}
(function fixed() {
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8; for (let i = 144; i < 256; i++) l[i] = 9; for (let i = 256; i < 280; i++) l[i] = 7; for (let i = 280; i < 288; i++) l[i] = 8;
  buildTree(sltree, l, 0, 288);
  const d = new Uint8Array(30).fill(5); buildTree(sdtree, d, 0, 30);
  buildBitsBase(lengthBits, lengthBase, 4, 3); buildBitsBase(distBits, distBase, 2, 1);
  lengthBits[28] = 0; lengthBase[28] = 258;
})();

/** Inflate raw DEFLATE bytes. */
export function inflateRaw(src) {
  let pos = 0, tag = 0, bitcount = 0, out = new Uint8Array(src.length * 6 + 1024), n = 0;
  const grow = need => { if (n + need <= out.length) return; const o = new Uint8Array(Math.max(out.length * 2, n + need)); o.set(out.subarray(0, n)); out = o; };
  const bit = () => { if (!bitcount--) { tag = src[pos++]; bitcount = 7; } const b = tag & 1; tag >>>= 1; return b; };
  const bits = (num, base) => { if (!num) return base; while (bitcount < 24 && pos < src.length) { tag |= src[pos++] << bitcount; bitcount += 8; } const v = tag & (0xffff >>> (16 - num)); tag >>>= num; bitcount -= num; return v + base; };
  const sym = t => {
    while (bitcount < 24 && pos < src.length) { tag |= src[pos++] << bitcount; bitcount += 8; }
    let sum = 0, cur = 0, len = 0, tg = tag;
    do { cur = 2 * cur + (tg & 1); tg >>>= 1; ++len; sum += t.table[len]; cur -= t.table[len]; } while (cur >= 0);
    tag = tg; bitcount -= len; return t.trans[sum + cur];
  };
  const lt = new Tree(), dt = new Tree(), lengths = new Uint8Array(320);
  const dynamic = () => {
    const hlit = bits(5, 257), hdist = bits(5, 1), hclen = bits(4, 4);
    lengths.fill(0, 0, 19);
    for (let i = 0; i < hclen; i++) lengths[clcidx[i]] = bits(3, 0);
    const code = new Tree(); buildTree(code, lengths, 0, 19);
    for (let num = 0; num < hlit + hdist;) {
      const s = sym(code);
      if (s === 16) { const prev = lengths[num - 1]; for (let l = bits(2, 3); l; l--) lengths[num++] = prev; }
      else if (s === 17) for (let l = bits(3, 3); l; l--) lengths[num++] = 0;
      else if (s === 18) for (let l = bits(7, 11); l; l--) lengths[num++] = 0;
      else lengths[num++] = s;
    }
    buildTree(lt, lengths, 0, hlit); buildTree(dt, lengths, hlit, hdist);
  };
  const block = (L, D) => {
    for (;;) {
      const s = sym(L);
      if (s === 256) return;
      if (s < 256) { grow(1); out[n++] = s; continue; }
      const i = s - 257, len = bits(lengthBits[i], lengthBase[i]), ds = sym(D), dist = bits(distBits[ds], distBase[ds]);
      grow(len); for (let k = n - dist, e = n + len; n < e;) out[n++] = out[k++];
    }
  };
  let last;
  do {
    last = bit();
    const type = bits(2, 0);
    if (type === 0) {
      // stored: realign to a byte, read LEN
      bitcount = 0; tag = 0;
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      grow(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
    } else if (type === 1) block(sltree, sdtree);
    else if (type === 2) { dynamic(); block(lt, dt); }
    else throw new Error("inflate: bad block type");
  } while (!last);
  return out.subarray(0, n);
}
/** Base64 of raw DEFLATE bytes → the text they hold. */
export function inflateBase64(b64) {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(inflateRaw(bytes));
}
