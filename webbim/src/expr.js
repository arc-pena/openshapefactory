//! Typed, unit-aware expressions (spec §4.1). Tokenise → AST → evaluate with an
//! injected lookup. Never `eval`: a parser can say "no parameter called `widht`"
//! and point at the character; `eval` says ReferenceError.
//!
//! Values are { kind, v } where kind is "Length" | "Angle" | "Number" | "Text" |
//! "Boolean". A trailing unit is an AST node (`scaled`), so `sqrt(2) m` scales
//! the result and `10mm + 2cm` converts both operands.

export const UNITS = {
  mm: { q: "Length", f: 1 }, cm: { q: "Length", f: 10 }, m: { q: "Length", f: 1000 },
  in: { q: "Length", f: 25.4 }, '"': { q: "Length", f: 25.4 }, ft: { q: "Length", f: 304.8 }, "'": { q: "Length", f: 304.8 },
  deg: { q: "Angle", f: 1 }, "°": { q: "Angle", f: 1 }, rad: { q: "Angle", f: 180 / Math.PI },
};
export const DOC_UNIT = "mm";

export class ExprError extends Error {
  constructor(msg, at) { super(msg); this.at = at; }
}

// ---------------------------------------------------------------- tokens
export function tokenise(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" && /[-+0-9]/.test(src[j + 1] || "")) { j += 2; while (/[0-9]/.test(src[j] || "")) j++; }
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new ExprError(`"${src.slice(i, j)}" is not a number`, i);
      out.push({ t: "num", v: n, at: i }); i = j; continue;
    }
    if (c === '"' && out.length && out[out.length - 1].t === "num") { out.push({ t: "unit", v: '"', at: i }); i++; continue; }
    if (c === "'" && out.length && out[out.length - 1].t === "num") { out.push({ t: "unit", v: "'", at: i }); i++; continue; }
    if (c === '"') {
      let j = i + 1; while (j < src.length && src[j] !== '"') j++;
      if (j >= src.length) throw new ExprError("this text is missing its closing quote", i);
      out.push({ t: "str", v: src.slice(i + 1, j), at: i }); i = j + 1; continue;
    }
    if (c === "°") { out.push({ t: "unit", v: "°", at: i }); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_.\-]/.test(src[j])) {
        // a '-' belongs to a name only after an all-capitals prefix: ids like G-A, T-EXTCAV300
        if (src[j] === "-" && !(/^[A-Z]+$/.test(src.slice(i, j)) && /[A-Za-z0-9]/.test(src[j + 1] || ""))) break;
        j++;
      }
      let name = src.slice(i, j);
      while (name.endsWith(".")) { name = name.slice(0, -1); j--; }
      const prev = out[out.length - 1];
      if (name === "x" && prev && (prev.t === "num" || prev.t === "unit" || (prev.t === "op" && prev.v === ")"))) out.push({ t: "op", v: "*", at: i });
      else out.push({ t: "name", v: name, at: i });
      i = j; continue;
    }
    if ("+-*/^(),&".includes(c)) { out.push({ t: "op", v: c, at: i }); i++; continue; }
    if (c === "×") { out.push({ t: "op", v: "*", at: i }); i++; continue; }
    throw new ExprError(`"${c}" is not something an expression can contain`, i);
  }
  return out;
}

// ---------------------------------------------------------------- parser
// expr   := concat
// concat := sum ('&' sum)*
// sum    := prod (('+'|'-') prod)*
// prod   := unary (('*'|'/') unary)*
// unary  := '-' unary | power
// power  := atom ('^' unary)?
// atom   := (num | name | call | '(' expr ')' | str) unit?
export function parse(src) {
  const toks = tokenise(String(src));
  let k = 0;
  const peek = () => toks[k], next = () => toks[k++];
  const isOp = v => peek() && peek().t === "op" && peek().v === v;
  const expect = v => { if (!isOp(v)) throw new ExprError(`expected "${v}"`, peek() ? peek().at : src.length); next(); };
  function concat() { let n = sum(); while (isOp("&")) { next(); n = { k: "bin", op: "&", a: n, b: sum() }; } return n; }
  function sum() { let n = prod(); while (isOp("+") || isOp("-")) { const op = next().v; n = { k: "bin", op, a: n, b: prod() }; } return n; }
  function prod() {
    let n = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) { const op = next().v; n = { k: "bin", op, a: n, b: unary() }; continue; }
      // implicit multiplication: "2 span", "sqrt(2) m" handled by unit; "2(3)" allowed
      if (peek() && (peek().t === "num" || (peek().t === "op" && peek().v === "("))) { n = { k: "bin", op: "*", a: n, b: unary() }; continue; }
      return n;
    }
  }
  function unary() { if (isOp("-")) { next(); return { k: "neg", a: unary() }; } if (isOp("+")) { next(); return unary(); } return power(); }
  function power() { const n = atom(); if (isOp("^")) { next(); return { k: "bin", op: "^", a: n, b: unary() }; } return n; }
  function atom() {
    const t = next();
    if (!t) throw new ExprError("the expression ends too soon", src.length);
    let n;
    if (t.t === "num") n = { k: "num", v: t.v };
    else if (t.t === "str") n = { k: "str", v: t.v };
    else if (t.t === "op" && t.v === "(") { n = concat(); expect(")"); }
    else if (t.t === "name") {
      if (isOp("(")) {
        next(); const args = [];
        if (!isOp(")")) { args.push(concat()); while (isOp(",")) { next(); args.push(concat()); } }
        expect(")"); n = { k: "call", f: t.v, args, at: t.at };
      } else n = { k: "name", v: t.v, at: t.at };
    } else throw new ExprError(`"${t.v}" cannot start a value`, t.at);
    // a trailing unit — a name that is a unit, directly after a value
    const u = peek();
    if (u && (u.t === "unit" || (u.t === "name" && UNITS[u.v]))) { next(); n = { k: "scaled", a: n, unit: u.v }; }
    return n;
  }
  const tree = concat();
  if (k < toks.length) throw new ExprError(`unexpected "${toks[k].v}"`, toks[k].at);
  return tree;
}

/** The identifiers a tree references — known before evaluating (for wiring). */
export function namesIn(tree, out = new Set()) {
  if (!tree) return out;
  if (tree.k === "name") { if (!CONSTS[tree.v]) out.add(tree.v); }
  else if (tree.k === "call") tree.args.forEach(a => namesIn(a, out));
  else if (tree.k === "bin") { namesIn(tree.a, out); namesIn(tree.b, out); }
  else if (tree.k === "neg" || tree.k === "scaled") namesIn(tree.a, out);
  return [...out];
}

const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E, true: 1, false: 0 };
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180),
  atan2: (y, x) => Math.atan2(y, x) * 180 / Math.PI,
};

const num = (kind, v) => ({ kind, v });
export function formatValue(val, unit = DOC_UNIT) {
  if (val == null) return "";
  if (val.kind === "Text") return val.v;
  if (val.kind === "Boolean") return val.v ? "Yes" : "No";
  if (val.kind === "Length") return `${fmt(val.v / UNITS[unit].f)} ${unit}`;
  if (val.kind === "Area") return `${fmt(val.v / 1e6)} m²`;
  if (val.kind === "Angle") return `${fmt(val.v)}°`;
  return fmt(val.v);
}
const fmt = x => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(Number(x.toFixed(3))));

/** Evaluate with `lookup(name) → value | undefined`. `into` is the quantity
 *  wanted: a bare number typed into a Length field is millimetres. */
export function evaluate(tree, { lookup = () => undefined, into = "Number" } = {}) {
  const ev = n => {
    switch (n.k) {
      // A bare literal is dimensionless until the end: "2 * span" must stay a
      // Length, not become an area. The field's quantity is applied once, below.
      case "num": return num("Number", n.v);
      case "str": return num("Text", n.v);
      case "name": {
        if (n.v in CONSTS) return num("Number", CONSTS[n.v]);
        const got = lookup(n.v);
        if (got === undefined) throw new ExprError(`no parameter called \`${n.v}\``, n.at);
        if (got && got.error) throw new ExprError(`\`${n.v}\` has an error: ${got.error}`, n.at);
        return typeof got === "number" ? num("Number", got) : typeof got === "string" ? num("Text", got) : got;
      }
      case "neg": { const a = ev(n.a); if (a.kind === "Text") throw new ExprError("text cannot be negated"); return num(a.kind, -a.v); }
      case "scaled": {
        // the unit scales the literal it follows: 10 m is 10 000 mm, sqrt(2) m is 1414.2 mm
        const a = ev(n.a), U = UNITS[n.unit];
        return num(U.q, a.v * U.f);
      }
      case "call": {
        const f = FUNCS[n.f];
        if (!f) throw new ExprError(`there is no function called \`${n.f}\``, n.at);
        const args = n.args.map(ev);
        const r = f(...args.map(a => a.v));
        const keep = ["abs", "min", "max", "round", "floor", "ceil"].includes(n.f) ? args[0].kind : "Number";
        return num(keep, r);
      }
      case "bin": {
        const a = ev(n.a), b = ev(n.b);
        if (n.op === "&") return num("Text", formatValue(a) + formatValue(b));
        if (a.kind === "Text" || b.kind === "Text") throw new ExprError(`"${n.op}" needs numbers; use & to join text`);
        switch (n.op) {
          case "+": case "-": {
            const kind = a.kind === "Number" ? b.kind : a.kind;
            return num(kind, n.op === "+" ? a.v + b.v : a.v - b.v);
          }
          case "*": {
            const kind = a.kind === "Length" && b.kind === "Length" ? "Area" : a.kind === "Number" ? b.kind : a.kind;
            return num(kind, a.v * b.v);
          }
          case "/": {
            if (Math.abs(b.v) < 1e-300) throw new ExprError("division by zero");
            const kind = a.kind === b.kind ? "Number" : b.kind === "Number" ? a.kind : "Number";
            return num(kind, a.v / b.v);
          }
          case "^": return num("Number", Math.pow(a.v, b.v));
        }
      }
    }
    throw new ExprError("cannot evaluate this");
  };
  const out = ev(tree);
  return out;
}

/** Does this text read as an expression rather than a literal? */
export function saysFormula(text) {
  const s = String(text).trim();
  if (s === "") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return false;
  return true;
}

/** Read what a person typed into a typed field. Returns
 *  { value, expr, names } — `expr` kept for round-tripping when it is a formula. */
export function readValue(text, { kind = "Length", lookup } = {}) {
  const tree = parse(text);
  const names = namesIn(tree);
  const val = evaluate(tree, { lookup, into: kind === "Integer" ? "Number" : kind });
  if ((kind === "Length" || kind === "Angle") && val.kind === "Number") val.kind = kind;
  if (kind === "Length" && val.kind !== "Length") throw new ExprError(`this field wants a length; that is ${val.kind === "Angle" ? "an angle" : "a " + val.kind.toLowerCase()}`);
  if (kind === "Angle" && val.kind !== "Angle") throw new ExprError(`this field wants an angle; that is a ${val.kind.toLowerCase()}`);
  return { value: val.v, val, expr: saysFormula(text) ? String(text).trim() : null, names };
}
