// A script that writes the model, rather than one that builds a shape.
//
// `Script` takes code and hands back geometry. This takes code and hands back a
// LIST OF NODES THAT SHOULD EXIST - and the difference is the whole point. A
// script that builds geometry makes one feature however complicated it is; a
// script that writes the model makes a hundred features you can open, wire,
// override and pick in the viewport, and it keeps making the right number of
// them as its input changes.
//
// THE PLAN IS A DECLARATION, NOT A SEQUENCE OF EDITS. The script says what
// should be there, keyed; the reconciler works out the difference between that
// and what is there, and emits only the edits that close the gap. Which is what
// makes it safe to run on every regeneration: a plan that has not changed
// produces no edits at all, so it cannot loop, and a plan whose input list grew
// by one produces one `add` rather than a hundred deletes and a hundred adds.
//
// The same idea as a virtual DOM, and for the same reason: the alternative -
// letting a script call add() and delete() itself - means the script has to
// know what it did last time, and no two scripts would remember it the same
// way.
import { readDeclared, wiresIn } from "./reuse.js";

//! How many nodes one generator may make. Not a performance guess: a plan with
//! a mistake in it - a loop that does not terminate, a list read from the wrong
//! input - asks for millions, and the difference between a refusal and a hung
//! page is this number. Sayable, so a real model that needs more can have more.
export const PLAN_CEILING = 2000;

//! How many times the reconciler will run before it stops. A plan that settles
//! needs one pass; a plan that feeds another generator needs one per link in
//! the chain. A plan that never settles - one that reads its own output - would
//! run forever, so it does not: it stops and says so.
export const RECONCILE_PASSES = 8;

export function compilePlan(source) {
  let module;
  try {
    module = new Function('"use strict"; return (' + source + ");")();
  } catch (err) {
    throw new Error("the plan did not compile: " + (err && err.message ? err.message : err));
  }
  if (!module || typeof module !== "object")
    throw new Error("the code must evaluate to an object with params and plan");
  if (typeof module.plan !== "function")
    throw new Error("the code must define plan(params, doc)");

  const params = [];
  for (const raw of module.params || []) {
    if (!raw || typeof raw.key !== "string" || !raw.key)
      throw new Error("every parameter needs a key");
    if (Array.isArray(raw.options)) {
      if (raw.options.length < 2)
        throw new Error("'" + raw.key + "' needs at least two options");
      params.push({ key: raw.key, label: raw.label || raw.key,
                    options: raw.options.map(String),
                    def: Number.isFinite(raw.def) ? Math.round(raw.def) : 0,
                    min: 0, max: raw.options.length - 1, step: 1, unit: "" });
      continue;
    }
    params.push({ key: raw.key, label: raw.label || raw.key,
                  def: Number.isFinite(raw.def) ? raw.def : 0,
                  min: Number.isFinite(raw.min) ? raw.min : -1e6,
                  max: Number.isFinite(raw.max) ? raw.max : 1e6,
                  step: Number.isFinite(raw.step) ? raw.step : 1,
                  unit: typeof raw.unit === "string" ? raw.unit : undefined });
  }
  return { module, params };
}

/* ------------------------------------------------------------- the doc API

   What a plan is allowed to know. Read-only on purpose: a plan that could
   write would be back to remembering what it did last time.

   Everything is looked up by NAME first and by id second, because a plan is
   written by a person against a model they are looking at, and the names are
   what is on screen. An id still works, and is what survives a rename.      */

export function planDoc(model, { data = () => null, here = null, catalogue = [] } = {}) {
  const features = (model && model.features) || [];
  const byId = new Map(features.map(one => [one.id, one]));

  const find = want => {
    if (!want) return null;
    if (typeof want === "object") return want.id ? byId.get(want.id) || null : null;
    return byId.get(want) || features.find(one => one.name === want) || null;
  };

  //! A generator's own wired inputs, in the order they were wired, which is the
  //! order they appear in the panel and in the graph. Named by what they point
  //! at, so `doc.points("Stations")` reads as English against the tree.
  const inputs = () => {
    const self = here && byId.get(here);
    if (!self) return [];
    const list = (self.args && self.args.reads) || [];
    return (Array.isArray(list) ? list : [list])
      .map(one => one && one.ref ? byId.get(one.ref) || null : null)
      .filter(Boolean);
  };

  //! The numbers or points a feature COMPUTED, as opposed to the arguments it
  //! was given. A Panel, a Range, an EvaluateCurve and a Drape all publish a
  //! list this way, which is what a generator is usually driven by.
  const readData = one => (one ? data(one.id) : null) || null;

  //! WHICH INPUT. A number is the position, a string is the name or the id,
  //! and nothing at all means "the first one that has what I am asking for" -
  //! which is what a person means when a generator has one input wired and
  //! they write doc.points(). Asking by position when several are wired is
  //! still there and still exact.
  const input = (which, wants = null) => {
    const all = inputs();
    if (Number.isInteger(which)) return all[which] || null;
    if (which) return all.find(one => one.name === which || one.id === which) || null;
    if (!wants) return all[0] || null;
    return all.find(one => { const got = readData(one); return got && wants.test(got.kind); })
        || null;
  };

  const api = {
    features: () => features.slice(),
    feature: find,
    id: want => { const one = find(want); return one ? one.id : null; },

    sets: () => features.filter(one => /set$|^Body$/i.test(one.type)),
    set: want => {
      const one = find(want);
      if (!one) throw new Error("there is no set called " + JSON.stringify(want));
      return one.id;
    },

    //! EVERYTHING THAT CAN BE MADE, in one list, whoever made it. A Circle out
    //! of the catalogue and a set somebody built are both a name you can ask
    //! for, and the only thing a plan gains by knowing which is which is the
    //! shape of the fields it should fill in - so that is what is reported,
    //! rather than a category.
    nodes: () => [
      ...catalogue.map(spec => ({
        name: spec.type, kind: "system", summary: spec.summary || "",
        takes: (spec.args || []).filter(a => a.kind === "ref" || a.kind === "refs")
          .map(a => a.key),
        sets: (spec.args || []).filter(a => a.kind === "real" || a.kind === "choice")
          .map(a => a.key),
      })),
      ...features.filter(one => api.isSet(one)).map(one => ({
        name: one.name || one.id, kind: "user", id: one.id,
        summary: (api.contents(one.id).length) + " nodes inside",
        takes: api.declared(one.id),
        sets: Object.keys(api.values(one.id)),
      })),
    ],

    //! A GENERATOR IS NOT A COMPONENT. It is a container, and black-boxing it
    //! works, but it is not a thing to copy: the first plan written here found
    //! the generator itself in its own list of user nodes and instantiated it,
    //! which made a generator that made a generator. A component is a folder
    //! of geometry; a generator is a folder of whatever it is currently
    //! making, and copying that copies a decision rather than a thing.
    isSet: one => !!one && /set$|^Body$/i.test(one.type),

    //! WHICH ONE A NAME MEANS. The catalogue first, so nobody can shadow
    //! Circle by naming a folder Circle, and the document second. `copy:`
    //! says the document was meant when the name is in both.
    resolve: (want, forceCopy = false) => {
      const named = String(want);
      if (!forceCopy) {
        const spec = catalogue.find(one => one.type === named);
        if (spec) return { kind: "system", name: spec.type };
      }
      const one = find(named);
      if (one && api.isSet(one)) return { kind: "user", id: one.id, name: one.name };
      if (!forceCopy && one)
        throw new Error(JSON.stringify(named) + " is a " + one.type
          + ", not a type of node and not a set that can be copied");
      return null;
    },

    inputs,
    input,
    //! The points at an input, as [x, y, z] triples. The one call a power-copy
    //! plan is built around.
    points: which => {
      const got = readData(input(which, /^points?$|^vectors?$/));
      //! The kind is singular on the label - "point", not "points" - because it
      //! names what each entry IS rather than how many there are. Both spellings
      //! are taken here so a plan written either way reads.
      if (!got || !/^points?$|^vectors?$/.test(got.kind)) return [];
      const out = [];
      for (let i = 0; i + 2 < got.values.length; i += 3)
        out.push([got.values[i], got.values[i + 1], got.values[i + 2]]);
      return out;
    },
    numbers: which => {
      const got = readData(input(which, /^numbers?$/));
      return got && /^numbers?$/.test(got.kind) ? Array.from(got.values) : [];
    },
    data: which => readData(input(which)),

    //! What a set asks for when it is instantiated, and what can be overridden
    //! inside it. Both read off the model rather than off anything a plan has
    //! to be told, so a plan written against a set keeps working when the set
    //! gains a parameter.
    //! WHAT A SET ASKS FOR FROM OUTSIDE.
    //!
    //! Read from the declaration when there is one - a set that has been
    //! instantiated carries the list, grouped, because instantiating is what
    //! writes it. Worked out from the wiring when there is not, which is the
    //! usual case: a set somebody BUILT has never been copied, so nobody has
    //! written anything down, and a plan that wants to place it needs the
    //! names before the first copy exists rather than after it.
    //!
    //! Both roads end at the same names - what each cut wire used to point at -
    //! because that is what instantiateEdits calls its groups, and a plan wires
    //! them by that name.
    declared: want => {
      const one = find(want);
      if (!one) return [];
      const text = one.args && one.args.inputs;
      const stored = readDeclared(typeof text === "string" ? text : "");
      if (stored.length) return stored.map(row => row.name);

      const inside = new Set([one.id, ...api.contents(one.id).map(other => other.id)]);
      const names = [];
      for (const member of api.contents(one.id))
        for (const wire of wiresIn(member)) {
          if (inside.has(wire.to)) continue;          // the set's own plumbing
          const source = byId.get(wire.to);
          const named = (source && source.name) || wire.to;
          if (!names.includes(named)) names.push(named);
        }
      return names;
    },
    contents: want => {
      const one = find(want);
      if (!one) return [];
      const deep = [];
      const walk = parent => {
        for (const other of features)
          if (other.parent === parent) { deep.push(other); walk(other.id); }
      };
      walk(one.id);
      return deep;
    },
    values: want => {
      const out = {};
      for (const one of api.contents(want)) {
        const driven = new Set(wiresIn(one).map(w => w.key));
        for (const [key, value] of Object.entries(one.args || {}))
          if (typeof value === "number" && !driven.has(key))
            out[(one.name || one.id) + " · " + key] = value;
      }
      return out;
    },
  };
  return api;
}

/* ------------------------------------------------------------ reading a plan

   ONE KIND OF NODE. A node is a node: a Circle out of the catalogue and a
   geometrical set somebody built are both things you can ask for by name, and
   a plan should not have to know which it is asking for. So there is one
   field:

     { key, type: "Circle",      refs: {…}, set: {…} }
     { key, type: "Column one",  inputs: {…}, set: {…} }

   and `type` is resolved against the catalogue first and the document second.
   A set is amalgamated exactly the way a catalogue type is atomic - it arrives
   as one node in the plan, however many features it turns out to be - which is
   the same promise the tree makes when it black-boxes one and the graph makes
   when it collapses one.

   The catalogue wins a tie, so nobody can shadow Circle by naming a folder
   Circle; `copy:` forces the document reading when that is what was meant.

   The rest is the same either way:

     name    what to call it
     refs    wires, by argument key. "@otherKey" points at another plan item.
     inputs  a set's DECLARED inputs, by the name the panel shows for them
     set     values. Inside a set, keyed "Member · arg" as doc.values() spells it.
     code    text arguments, same keying.                                     */

export function readPlan(said, resolve = () => null) {
  if (!Array.isArray(said)) throw new Error("plan() must return a list of nodes");
  if (said.length > PLAN_CEILING)
    throw new Error("that plan asks for " + said.length + " nodes and the ceiling is "
      + PLAN_CEILING + " - check the list it is reading from");

  const seen = new Set();
  const out = [];
  said.forEach((raw, at) => {
    if (!raw || typeof raw !== "object")
      throw new Error("node " + at + " in the plan is not an object");
    const key = String(raw.key === undefined ? at : raw.key);
    if (seen.has(key))
      throw new Error("two nodes in the plan share the key " + JSON.stringify(key)
        + " - a key is how one of them is told from the other between runs");
    seen.add(key);
    const want = raw.copy ? String(raw.copy) : raw.type ? String(raw.type) : "";
    if (!want) throw new Error("node " + JSON.stringify(key) + " does not say what to make");
    const is = resolve(want, !!raw.copy);
    if (!is)
      throw new Error("nothing is called " + JSON.stringify(want)
        + " - doc.nodes() lists everything that can be made");
    out.push({
      key,
      type: is.kind === "system" ? is.name : null,
      copy: is.kind === "user" ? is.id : null,
      calls: want,
      name: raw.name === undefined ? null : String(raw.name),
      refs: plainObject(raw.refs),
      inputs: plainObject(raw.inputs),
      set: plainObject(raw.set),
      code: plainObject(raw.code),
    });
  });
  return out;
}

const plainObject = value =>
  value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};

//! WHAT WOULD MAKE THIS NODE DIFFERENT. Everything the reconciler would have to
//! change if it changed, and nothing else - so moving a node in the graph, or
//! renaming something it does not touch, does not rebuild it.
export const fingerprint = item => JSON.stringify([
  item.type, item.copy, item.name, item.refs, item.inputs, item.set, item.code]);

/* ----------------------------------------------------------- the reconciler

   The difference between what the plan says and what is there, as edits.

   Deletes first: a plan that shrank frees its ids before a plan that also grew
   asks for new ones, so a list of ten going to eight and back to ten gets the
   same ids each time rather than climbing forever.                          */

export function reconcile({ plan, made = {}, owner, mint, instantiate,
                            rename = key => key }) {
  const edits = [];
  const next = {};
  const wanted = new Map(plan.map(item => [item.key, item]));

  const gone = Object.keys(made).filter(key => !wanted.has(key));
  for (const key of gone) {
    const was = made[key];
    if (was && was.id) edits.push({ op: "delete", id: was.id });
  }

  //! A NODE THAT CHANGED IS REPLACED, NOT PATCHED. A power-copy whose source
  //! set changed shape cannot be edited into the new shape - the members are
  //! different features - and a plain node whose type changed is a different
  //! node. Values and wires are patched; identity is not.
  const fresh = [];
  for (const item of plan) {
    const was = made[item.key];
    const print = fingerprint(item);
    if (was && was.print === print) { next[item.key] = was; continue; }
    if (was && was.id && (was.type !== item.type || was.copy !== item.copy)) {
      edits.push({ op: "delete", id: was.id });
      fresh.push({ item, print });
      continue;
    }
    if (was && was.id) { fresh.push({ item, print, id: was.id, keep: true }); continue; }
    fresh.push({ item, print });
  }

  //! Two passes over the new ones, because a wire may point at a sibling: every
  //! id is minted before any wire is written.
  const idFor = new Map(Object.entries(next).map(([key, was]) => [key, was.id]));
  for (const row of fresh) {
    if (row.keep) { idFor.set(row.item.key, row.id); continue; }
    //! A COPY NAMES ITSELF. The instantiate path mints ids for the set and for
    //! every member of it in one pass, so asking it for a copy and then forcing
    //! a different id on the set afterwards means rewriting its edits - which
    //! was done by string replacement, and string replacement over a blob of
    //! JSON full of ids is a bug waiting for two ids to share a prefix. The
    //! copy's own id is as good as any, and the plan never sees it.
    if (row.item.copy) {
      row.parts = instantiate(row.item.copy, row.item.name || rename(row.item.key));
      row.id = row.parts.id;
    } else {
      row.id = mint(row.item, owner);
    }
    idFor.set(row.item.key, row.id);
  }

  const resolve = want => {
    if (typeof want !== "string") return null;
    if (want.startsWith("@")) {
      const to = idFor.get(want.slice(1));
      if (!to) throw new Error("the plan wires to " + JSON.stringify(want)
        + ", and there is no node with that key in it");
      return to;
    }
    return want;
  };

  for (const row of fresh) {
    const { item, id } = row;
    if (!row.keep) {
      //! A copy is the instantiate path, unchanged: the same code that makes a
      //! user feature when somebody picks it off a menu. One implementation of
      //! what copying a set means.
      if (row.parts) edits.push(...row.parts.edits);
      else edits.push({ op: "add", type: item.type, id,
                        name: item.name || rename(item.key), refs: {} });
      edits.push({ op: "group", id, into: owner });
    } else if (item.name) {
      edits.push({ op: "rename", id, name: item.name });
    }

    for (const [key, value] of Object.entries(item.set)) {
      const at = row.parts ? insideRef(row.parts, key) : { id, key };
      if (at) edits.push({ op: "set", id: at.id, key: at.key, value: Number(value) });
    }
    for (const [key, text] of Object.entries(item.code)) {
      const at = row.parts ? insideRef(row.parts, key) : { id, key };
      if (at) edits.push({ op: "code", id: at.id, key: at.key, text: String(text) });
    }
    for (const [key, want] of Object.entries(item.refs)) {
      const to = resolve(want);
      if (to) edits.push({ op: "connect", id, key, from: to });
    }
    //! A COPY'S INPUTS ARE THE WIRES IT ARRIVED WITHOUT. instantiateEdits cuts
    //! every wire that left the set and writes down what each one was, grouped
    //! - so one input read by three members is wired once here and reaches all
    //! three, which is the same rule the panel and the graph already use.
    for (const [name, want] of Object.entries(item.inputs)) {
      const to = resolve(want);
      if (!to || !row.parts) continue;
      const group = (row.parts.groups || []).find(one => one.name === name);
      if (!group) continue;
      for (const holder of group.holders)
        edits.push({ op: "connect", id: holder.id, key: holder.key, from: to });
    }

    next[item.key] = { id, print: row.print, type: item.type, copy: item.copy };
  }

  return { edits, made: next, added: fresh.filter(r => !r.keep).length,
           removed: gone.length, kept: Object.keys(next).length - fresh.length };
}

//! "Member · arg" back into the feature the copy actually made. The label is
//! what doc.values() spells and what the black-box panel shows, so a plan can
//! be written by reading the panel.
function insideRef(parts, label) {
  const [who, key] = String(label).split("·").map(s => s.trim());
  if (!key) return null;
  const renamed = parts.renamed || {};
  const was = Object.keys(renamed).find(from =>
    from === who || (parts.namesWas && parts.namesWas[from] === who));
  return was ? { id: renamed[was], key } : null;
}

//! What the generator writes down about what it made, and reads back next time.
//! Tolerant on the way in: a record somebody hand-edited loses the row it got
//! wrong rather than the whole list, because a generator that forgets
//! everything rebuilds everything.
export function readMade(text) {
  const said = String(text == null ? "" : text).trim();
  if (!said) return {};
  let read;
  try { read = JSON.parse(said); } catch (error) { return {}; }
  const rows = read && typeof read === "object" ? read.made : null;
  if (!rows || typeof rows !== "object") return {};
  const out = {};
  for (const [key, row] of Object.entries(rows))
    if (row && typeof row === "object" && typeof row.id === "string")
      out[key] = { id: row.id, print: String(row.print || ""),
                   type: row.type || null, copy: row.copy || null };
  return out;
}

export const writeMade = made => JSON.stringify({ version: 1, made });

//! What the tree and the panel say a generator did, in one line.
export function saysPlan({ added, removed, kept, total }) {
  const said = [];
  said.push(total + (total === 1 ? " node" : " nodes"));
  if (added) said.push(added + " new");
  if (removed) said.push(removed + " removed");
  if (kept && (added || removed)) said.push(kept + " unchanged");
  return said.join(" · ");
}
