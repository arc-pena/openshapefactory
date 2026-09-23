// What a person may type into a number.
//
// Every CAD modeller worth the name lets you type "10m" into a field that is
// in millimetres, and "2400/3" into one that wants a spacing, and the name of
// a parameter into one that should follow it. CATIA has had this since it had
// fields; Grasshopper is built on it. A box that only accepts 4.5 is a box
// that makes you do arithmetic on paper and then type the answer in, which is
// how a model ends up full of numbers nobody can explain.
//
// Three things are going on and they are worth telling apart:
//
//   A QUANTITY is a number with a unit on it. 10m is a length and so is
//   10000mm, and they are the same length. The FIELD has a unit too, so the
//   conversion is decided rather than guessed: type 10m into a field that is
//   in millimetres and it is ten thousand of them.
//
//   AN EXPRESSION is arithmetic over quantities. 10 x 10mm, 2400/3, (a+b)/2.
//   It is evaluated here, in a parser written for the job, and never with
//   eval: a modeller that runs whatever is typed into a number box is a
//   modeller that runs whatever is in a file somebody sent you.
//
//   A REFERENCE is the name of something else in the document. Typing a name
//   into a value does not COPY that value - it wires the two together, which
//   is the whole difference between a parametric model and a spreadsheet of
//   numbers that used to agree.
//
// Nothing here knows about the kernel, the DOM or the document. It takes text
// and gives back either a number or a description of what would have to be
// wired up, so all of it can be checked without a browser.

/* ------------------------------------------------------------------ units

   Held as how many of the BASE unit one of them is: millimetres for length,
   degrees for angle. The base is the unit the modeller itself works in, so a
   field that says "mm" needs no conversion at all and the common case costs
   nothing.                                                                 */

export const UNITS = [
  // length
  { key: "mm", of: "length", is: 1, names: ["mm", "millimetre", "millimetres", "millimeter", "millimeters"] },
  { key: "cm", of: "length", is: 10, names: ["cm", "centimetre", "centimetres", "centimeter", "centimeters"] },
  { key: "dm", of: "length", is: 100, names: ["dm"] },
  { key: "m", of: "length", is: 1000, names: ["m", "metre", "metres", "meter", "meters"] },
  { key: "km", of: "length", is: 1e6, names: ["km", "kilometre", "kilometres", "kilometer", "kilometers"] },
  { key: "in", of: "length", is: 25.4, names: ["in", "inch", "inches", "\""] },
  { key: "ft", of: "length", is: 304.8, names: ["ft", "foot", "feet", "'"] },
  { key: "yd", of: "length", is: 914.4, names: ["yd", "yard", "yards"] },
  { key: "mi", of: "length", is: 1609344, names: ["mi", "mile", "miles"] },
  // angle
  { key: "deg", of: "angle", is: 1, names: ["deg", "degree", "degrees", "°"] },
  { key: "rad", of: "angle", is: 180 / Math.PI, names: ["rad", "radian", "radians"] },
  { key: "grad", of: "angle", is: 0.9, names: ["grad", "gon", "gons"] },
  { key: "turn", of: "angle", is: 360, names: ["turn", "turns", "rev", "revs"] },
];

//! Longest name first, so "mm" is not read as "m" with an m left over.
const UNIT_INDEX = (() => {
  const rows = [];
  for (const unit of UNITS) for (const name of unit.names) rows.push({ name, unit });
  rows.sort((a, b) => b.name.length - a.name.length);
  return rows;
})();

export const unitNamed = name => {
  const said = String(name || "").trim().toLowerCase();
  const row = UNIT_INDEX.find(one => one.name.toLowerCase() === said);
  return row ? row.unit : null;
};

//! WHAT A FIELD IS IN. The catalogue writes a field's unit as it wants it
//! shown - "mm", "°", or nothing at all - so it is read the same way a typed
//! unit is, and a field with no unit is a plain number that no conversion
//! applies to.
export function fieldUnit(said) {
  const unit = unitNamed(said);
  if (unit) return unit;
  return null;
}

//! How many of \p into one of \p from is. Null when the two are not the same
//! kind of thing, because a length is not an angle and quietly treating one
//! as the other is how a wall ends up 90 millimetres long.
export function convert(from, into) {
  if (!from) return 1;               // a bare number takes the field's own unit
  if (!into) return null;            // a unit typed into a field that has none
  if (from.of !== into.of) return null;
  return from.is / into.is;
}

/* ------------------------------------------------------------ the reading

   A tokeniser and a recursive-descent parser, which for this grammar is fifty
   lines and is the only way to be sure that what runs is arithmetic. NO EVAL,
   anywhere: a number box that runs what is typed into it runs what is in the
   file somebody sent you.                                                  */

const SYMBOLS = ["(", ")", ",", "+", "-", "*", "/", "^", "%"];

export function tokenise(text) {
  const said = String(text == null ? "" : text);
  const out = [];
  let i = 0;
  while (i < said.length) {
    const c = said[i];
    if (/\s/.test(c)) { i++; continue; }
    if (SYMBOLS.includes(c)) { out.push({ kind: "op", said: c }); i++; continue; }
    //! × and ÷ as they are actually typed, and x between two things as the
    //! multiplication everybody writes it as - "10 x 10mm" is a request, not
    //! a mistake. A bare x is only a multiply when something can be
    //! multiplied, which the parser decides; here it is just a token.
    if (c === "×") { out.push({ kind: "op", said: "*" }); i++; continue; }
    if (c === "÷") { out.push({ kind: "op", said: "/" }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      const found = said.slice(i).match(/^\d*\.?\d+(?:[eE][-+]?\d+)?/);
      if (!found) throw new Error("that is not a number: " + said.slice(i, i + 8));
      i += found[0].length;
      // A unit stuck to the number, or standing just after it.
      const rest = said.slice(i);
      const unit = UNIT_INDEX.find(one =>
        rest.toLowerCase().startsWith(one.name.toLowerCase())
        && !/[a-z0-9_]/i.test(rest[one.name.length] || ""));
      if (unit) i += unit.name.length;
      out.push({ kind: "number", value: Number(found[0]), unit: unit ? unit.unit : null });
      continue;
    }
    const word = said.slice(i).match(/^[A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*/);
    if (!word) throw new Error("what is " + c + "?");
    i += word[0].length;
    //! A WORD THAT IS A UNIT carries it, so "sqrt(2) m" is a length and not a
    //! reference to something called m. Units win over names, which is a
    //! choice rather than an accident: a parameter called "m" or "in" is
    //! asking to be misread by every person who reads the formula, never mind
    //! by the parser.
    out.push({ kind: "word", said: word[0], unit: unitNamed(word[0]) });
    continue;
  }
  return out;
}

//! The functions a value field may use. Small on purpose: this is a number
//! box, not a language, and every one of these is something an architect has
//! actually wanted in a dimension.
export const CALLS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, sign: Math.sign, log: Math.log, exp: Math.exp,
  sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180),
  tan: x => Math.tan(x * Math.PI / 180),
  asin: x => Math.asin(x) * 180 / Math.PI, acos: x => Math.acos(x) * 180 / Math.PI,
  atan: x => Math.atan(x) * 180 / Math.PI,
  min: Math.min, max: Math.max, hypot: Math.hypot, pow: Math.pow,
};

export const CONSTANTS = { pi: Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2 };

//! The grammar, in the order things bind:
//!
//!   sum     := product (("+" | "-") product)*
//!   product := power (("*" | "/" | "%" | juxtaposition) power)*
//!   power   := unary ("^" power)?          right to left, as powers go
//!   unary   := ("-" | "+")? atom
//!   atom    := number | word | word "(" args ")" | "(" sum ")"
//!
//! JUXTAPOSITION is the one liberty taken: "2 pi" and "3 walls" read as
//! multiplication, because that is what a person writing them means and a
//! number box that refused it would be pedantic about the one thing everybody
//! does.
export function parse(text) {
  const tokens = tokenise(text);
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const isOp = said => peek() && peek().kind === "op" && peek().said === said;
  const isWord = said => peek() && peek().kind === "word"
    && peek().said.toLowerCase() === said;

  function sum() {
    let left = product();
    while (isOp("+") || isOp("-")) {
      const op = take().said;
      left = { kind: "binary", op, left, right: product() };
    }
    return left;
  }
  function product() {
    let left = power();
    for (;;) {
      if (isOp("*") || isOp("/") || isOp("%")) {
        const op = take().said;
        left = { kind: "binary", op, left, right: power() };
        continue;
      }
      // A unit standing after a value scales it: "sqrt(2) m", "(a+b) mm".
      if (peek() && peek().kind === "word" && peek().unit && !isWord("x")) {
        left = { kind: "scaled", of: left, unit: take().unit };
        continue;
      }
      // "10 x 10" and "2 pi": a thing straight after a thing is a product.
      if (isWord("x")) { take(); left = { kind: "binary", op: "*", left, right: power() }; continue; }
      if (peek() && (peek().kind === "number"
                     || (peek().kind === "word" && !isWord("x")))) {
        left = { kind: "binary", op: "*", left, right: power() };
        continue;
      }
      return left;
    }
  }
  function power() {
    const left = unary();
    if (isOp("^")) { take(); return { kind: "binary", op: "^", left, right: power() }; }
    return left;
  }
  function unary() {
    if (isOp("-")) { take(); return { kind: "negate", of: unary() }; }
    if (isOp("+")) { take(); return unary(); }
    return atom();
  }
  function atom() {
    const token = take();
    if (!token) throw new Error("that stops in the middle");
    if (token.kind === "number") return { kind: "number", value: token.value, unit: token.unit };
    if (token.kind === "op" && token.said === "(") {
      const inside = sum();
      if (!isOp(")")) throw new Error("a bracket was opened and not closed");
      take();
      return inside;
    }
    if (token.kind === "word") {
      if (token.unit && !isOp("("))
        throw new Error(token.said + " is a unit, not a value - it goes after a number");
      if (isOp("(")) {
        take();
        const args = [];
        if (!isOp(")")) {
          args.push(sum());
          while (isOp(",")) { take(); args.push(sum()); }
        }
        if (!isOp(")")) throw new Error(token.said + "( was opened and not closed");
        take();
        return { kind: "call", name: token.said.toLowerCase(), args };
      }
      return { kind: "name", said: token.said };
    }
    throw new Error("that is not something a number can start with: " + (token.said || ""));
  }

  const tree = sum();
  if (at < tokens.length)
    throw new Error("there is something left over: "
      + tokens.slice(at).map(t => t.said !== undefined ? t.said : t.value).join(" "));
  return tree;
}

/* ------------------------------------------------------------- the answer */

//! Every name a formula mentions, once each and in the order they appear -
//! which is the order they will be wired up in, so it has to be stable.
export function namesIn(tree, out = []) {
  if (!tree) return out;
  if (tree.kind === "name") {
    const said = tree.said;
    if (!CONSTANTS[said.toLowerCase()] && !out.includes(said)) out.push(said);
    return out;
  }
  if (tree.kind === "binary") { namesIn(tree.left, out); namesIn(tree.right, out); }
  if (tree.kind === "negate" || tree.kind === "scaled") namesIn(tree.of, out);
  if (tree.kind === "call") for (const one of tree.args) namesIn(one, out);
  return out;
}

//! Worked out, in the FIELD'S OWN UNIT. A number with a unit on it is
//! converted; one without takes the field's unit, which is what makes "250"
//! in a millimetre field two hundred and fifty millimetres and "0.25m" the
//! same thing.
export function evaluate(tree, { into = null, lookup = null } = {}) {
  const walk = node => {
    switch (node.kind) {
      case "number": {
        const factor = convert(node.unit, into);
        if (factor === null)
          throw new Error(node.unit
            ? "this is not a field you can put " + node.unit.key + " into"
            : "that unit means nothing here");
        return node.value * factor;
      }
      case "name": {
        const known = CONSTANTS[node.said.toLowerCase()];
        if (known !== undefined) return known;
        const got = lookup ? lookup(node.said) : undefined;
        if (got === undefined || got === null || !Number.isFinite(Number(got)))
          throw new Error("nothing in this document is called " + node.said);
        return Number(got);
      }
      case "negate": return -walk(node.of);
      case "scaled": {
        const factor = convert(node.unit, into);
        if (factor === null)
          throw new Error("this is not a field you can put " + node.unit.key + " into");
        return walk(node.of) * factor;
      }
      case "call": {
        const call = CALLS[node.name];
        if (!call) throw new Error(node.name + " is not something a value can do");
        return call(...node.args.map(walk));
      }
      case "binary": {
        const a = walk(node.left), b = walk(node.right);
        switch (node.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/":
            if (Math.abs(b) < 1e-12) throw new Error("that divides by nothing");
            return a / b;
          case "%":
            if (Math.abs(b) < 1e-12) throw new Error("that divides by nothing");
            return a % b;
          case "^": return Math.pow(a, b);
          default: throw new Error("what is " + node.op + "?");
        }
      }
      default: throw new Error("that is not a value");
    }
  };
  return walk(tree);
}

//! The same formula written as JavaScript over the letters the Expression
//! node binds - a, b, c - so the tree can hold it and recompute it whenever
//! anything it is wired to changes. The units are already folded in, because
//! the node works in the field's unit and always will.
export function jsOf(tree, names = [], into = null) {
  const letter = said => {
    const at = names.indexOf(said);
    return at >= 0 && at < 26 ? "abcdefghijklmnopqrstuvwxyz"[at] : null;
  };
  const walk = node => {
    switch (node.kind) {
      case "number": {
        const factor = convert(node.unit, into);
        return String(node.value * (factor === null ? 1 : factor));
      }
      case "name": {
        const known = CONSTANTS[node.said.toLowerCase()];
        if (known !== undefined) return String(known);
        const one = letter(node.said);
        if (!one) throw new Error("too many different things in one formula");
        return one;
      }
      case "negate": return "(-" + walk(node.of) + ")";
      case "scaled": {
        const factor = convert(node.unit, into);
        return "(" + walk(node.of) + " * " + (factor === null ? 1 : factor) + ")";
      }
      case "call": {
        const call = node.name;
        const args = node.args.map(walk);
        if (["sin", "cos", "tan"].includes(call))
          return "Math." + call + "((" + args[0] + ") * Math.PI / 180)";
        if (["asin", "acos", "atan"].includes(call))
          return "(Math." + call + "(" + args[0] + ") * 180 / Math.PI)";
        return "Math." + call + "(" + args.join(", ") + ")";
      }
      case "binary": {
        const a = walk(node.left), b = walk(node.right);
        if (node.op === "^") return "Math.pow(" + a + ", " + b + ")";
        return "(" + a + " " + node.op + " " + b + ")";
      }
      default: throw new Error("that is not a value");
    }
  };
  return walk(tree);
}

/* --------------------------------------------------------- what to do next

   ONE FUNCTION THE FIELD CALLS, and it gives back one of three answers:

     a NUMBER       - set it and be done; this is nearly everything
     a WIRE         - the text was one name, so connect the two
     a FORMULA      - make an Expression node, wire what it mentions into it,
                      and wire that into the field

   The field does not have to know which case it is in until it is told, and
   nothing in here has to know how any of those three are carried out.      */

export function readValue(text, { unit = null, lookup = null, known = null } = {}) {
  const said = String(text == null ? "" : text).trim();
  if (!said) return { kind: "blank" };
  const into = fieldUnit(unit);
  let tree;
  try { tree = parse(said); }
  catch (error) { return { kind: "error", message: error.message }; }

  const names = namesIn(tree);
  // A plain number, possibly with a unit and some arithmetic: the answer is a
  // number and there is nothing to wire.
  if (!names.length) {
    try { return { kind: "number", value: evaluate(tree, { into }), tree }; }
    catch (error) { return { kind: "error", message: error.message }; }
  }
  const missing = known ? names.filter(one => !known(one)) : [];
  if (missing.length)
    return { kind: "error",
             message: missing.length === 1
               ? "nothing in this document is called " + missing[0]
               : "nothing here is called " + missing.join(" or ") };

  // ONE NAME AND NOTHING ELSE is a wire, not a formula. Making an Expression
  // node whose whole formula is "a" would be a node in the tree that does
  // nothing, for ever, in every model anybody builds this way.
  if (tree.kind === "name")
    return { kind: "wire", name: tree.said };

  if (names.length > 3)
    return { kind: "error", message: "a value can follow at most three other things; "
             + "that one mentions " + names.length + " - build it up in steps" };
  let js, value;
  try {
    js = jsOf(tree, names, into);
    value = lookup ? evaluate(tree, { into, lookup }) : null;
  } catch (error) { return { kind: "error", message: error.message }; }
  return { kind: "formula", names, js, value, tree, said };
}

//! One line naming what a formula does, for the node it becomes. A tree full
//! of "Expression.4" is a tree nobody can read; a tree that says
//! "Width / Bays" is a tree that explains itself.
export const saysFormula = said =>
  String(said || "").replace(/\s+/g, " ").trim().slice(0, 48);
