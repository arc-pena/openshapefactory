// A geometrical set from another file, brought in as a feature.
//
// THE ARGUMENT. Put a point, a plane, a circle, an extrude and a fillet in a
// geometrical set and you have described something - a mullion, a stair, a
// window head. What that set needs from the rest of the document is whatever
// its contents read from outside it, and that list is its argument list in
// every sense that matters. So a set IS a user-defined feature already; what
// was missing was the ability to take one out of one file and put it in
// another, which is the whole of this file.
//
// Copied, not referenced. A set instantiated here is a real set with real
// features in it, wired to each other exactly as they were, and editable
// afterwards like anything else - because a feature you cannot open is a
// feature you cannot fix at four o'clock on a Friday. What is NOT copied is
// anything the set read from outside itself: those arrive unwired, and they
// are what the definition panel then asks you for.
//
// Nothing here knows about the kernel or the DOM. It reads one model file and
// writes a list of edits, which is a pure function of the two and can be
// checked without either.

/* ----------------------------------------------------------- reading it */

//! The features of a model file, sanity-checked enough that a file somebody
//! hand-edited loses the entry it got wrong rather than the whole import.
export function featuresOf(model) {
  if (!model || !Array.isArray(model.features)) return [];
  return model.features.filter(one => one && one.id && one.type);
}

//! Everything filed under a set, and everything filed under those, and so on.
//! Not the set itself: the caller decides whether it wants the folder.
export function contentsOf(model, setId, deep = true) {
  const all = featuresOf(model);
  const out = [];
  const walk = holder => {
    for (const one of all) {
      if (one.parent !== holder || out.includes(one)) continue;
      out.push(one);
      if (deep) walk(one.id);
    }
  };
  walk(setId);
  return out;
}

//! WHAT A FILE OFFERS. Every geometrical set in it, with how much is in each
//! and what each would ask for - so the thing a person chooses from is a list
//! of features rather than a list of ids.
export function setsIn(model, { isSet = one => /set$/i.test(one.type) } = {}) {
  return featuresOf(model).filter(isSet).map(one => {
    const inside = contentsOf(model, one.id);
    return { id: one.id, name: one.name || one.id, type: one.type,
             holds: inside.length, inputs: inputsOf(model, one.id).length };
  });
}

/* --------------------------------------------------------- the wires in it

   A wire is written two ways in a model file - { ref: "PT1" } for one, and
   [{ ref: "PT1" }, { ref: "PT2" }] for a list - and a driven number writes a
   third, { value: 40, from: "NU1" }. All three are wires and all three have
   to be followed, or an imported set arrives with half its plumbing.       */

//! Every wire an entry holds, as { key, to, at }: which argument, what it
//! points at, and where in the list it sits (null when it is a single wire).
export function wiresIn(entry) {
  const out = [];
  for (const [key, value] of Object.entries((entry && entry.args) || {})) {
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      value.forEach((one, at) => {
        if (one && typeof one === "object" && one.ref) out.push({ key, to: String(one.ref), at });
      });
      continue;
    }
    if (value.ref) { out.push({ key, to: String(value.ref), at: null }); continue; }
    if (value.from) out.push({ key, to: String(value.from), at: null, drives: true });
  }
  return out;
}

//! What a set reads from OUTSIDE itself - its inputs, in the sense the panel
//! means. Each one says which feature inside holds the wire and which of its
//! arguments it is, because that is what has to be supplied afterwards.
export function inputsOf(model, setId) {
  const inside = new Set([setId, ...contentsOf(model, setId).map(one => one.id)]);
  const out = [];
  for (const entry of contentsOf(model, setId))
    for (const wire of wiresIn(entry))
      if (!inside.has(wire.to))
        out.push({ holder: entry.id, holderName: entry.name || entry.id,
                   key: wire.key, to: wire.to, at: wire.at, drives: !!wire.drives });
  return out;
}

/* --------------------------------------------------------- writing it out

   ORDER MATTERS AND NOTHING ELSE DOES. A feature cannot be wired to one that
   has not been made yet, so every feature is added first and every wire made
   afterwards - which also means a set with a cycle inside it, if such a thing
   were ever written, arrives whole rather than half.                       */

//! An id nothing in the document is using. Names are made the same way a
//! person would: the set's name with a number after it when there is already
//! one of those.
export function freshId(want, taken) {
  const base = String(want || "F").replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "F";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const tried = base + "_" + i;
    if (!taken.has(tried)) return tried;
  }
  return base + "_" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function freshName(want, taken) {
  const base = String(want || "Set").trim() || "Set";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const tried = base + "." + i;
    if (!taken.has(tried)) return tried;
  }
  return base + " " + Math.random().toString(36).slice(2, 6);
}

//! THE WHOLE OF IT: one set out of one model, as a list of edits this
//! document can be handed. Also the list of what was left unwired, so
//! whatever asked for this can say what has to be supplied.
//!
//! \p spec is asked for a type's arguments, so a choice written in the file
//! as its own words - "Closed", "Make faces" - goes back to the number the
//! document stores. Without it, choices are left at their defaults rather
//! than guessed at, because a guessed choice is a silently different model.
//! DUPLICATING A SELECTION, IN PLACE.
//!
//! The other half of instantiateEdits, and the difference between them is one
//! decision taken the opposite way: WHAT TO DO WITH A WIRE THAT LEAVES.
//!
//! Instantiating a set somewhere else CUTS those wires and declares them as
//! the component's inputs, because the point of reuse is that the somewhere
//! else is different and a wire pointed at whatever was lying about would be
//! worse than an empty field. Duplicating KEEPS them, pointed at the same
//! things the original reads, because the point of a duplicate is another one
//! of these - two columns on the same plane, off the same sketch, at different
//! heights. Cut those wires and what comes back is a pile of unbuilt features.
//!
//! Wires INSIDE the selection are rewritten to the copies, both ways round: a
//! fillet duplicated with its cube rounds the new cube, and a fillet
//! duplicated alone rounds the old one. That falls out of the rule rather than
//! being two rules.
//!
//! A container brings its contents. Duplicating a folder and getting an empty
//! folder is not what anybody means by duplicating a folder.
export function duplicateEdits(model, ids, { taken = new Set(), takenNames = new Set(),
                                             spec = null, into = undefined } = {}) {
  const all = featuresOf(model);
  const wanted = [];
  const seen = new Set();
  const want = id => {
    if (seen.has(id)) return;
    const entry = all.find(one => one.id === id);
    if (!entry) return;
    seen.add(id);
    wanted.push(entry);
    for (const child of contentsOf(model, id)) want(child.id);
  };
  //! In the order the DOCUMENT has them, not the order they were clicked, so
  //! a copy reads down the tree the way the original does.
  for (const entry of all) if ((ids || []).includes(entry.id)) want(entry.id);
  if (!wanted.length) throw new Error("nothing to duplicate");

  const used = new Set(taken);
  const usedNames = new Set(takenNames);
  const renamed = new Map();
  for (const entry of wanted) {
    const id = freshId(entry.id, used);
    used.add(id);
    renamed.set(entry.id, id);
  }

  const edits = [];
  for (const entry of wanted) {
    const given = freshName(entry.name || entry.type, usedNames);
    usedNames.add(given);
    edits.push({ op: "add", type: entry.type, id: renamed.get(entry.id),
                 name: given, refs: {} });
  }
  //! Filed after they all exist, so a copy going into a copied folder finds
  //! the folder. A copy of something loose goes where `into` says, or stays
  //! loose - which for a duplicate means beside the thing it came from.
  for (const entry of wanted) {
    const holder = renamed.get(entry.parent)
      || (seen.has(entry.parent) ? undefined : (into !== undefined ? into : entry.parent));
    if (holder) edits.push({ op: "group", id: renamed.get(entry.id), into: holder });
  }
  for (const entry of wanted)
    edits.push(...valueEdits(entry, renamed.get(entry.id),
                             spec ? spec(entry.type) : null, renamed));
  for (const entry of wanted) {
    const id = renamed.get(entry.id);
    for (const wire of wiresIn(entry)) {
      const to = renamed.get(wire.to) || wire.to;
      if (to) edits.push({ op: "connect", id, key: wire.key, from: to });
    }
  }
  return { edits, renamed: Object.fromEntries(renamed),
           made: wanted.map(entry => renamed.get(entry.id)) };
}

//! EVERY VALUE ON ONE FEATURE, AS EDITS. A number, a choice, a line of text,
//! a script, a drawing, a vertex somebody moved by hand, a set of picked edges,
//! a finish - everything that is stored ON a feature rather than wired INTO it.
//!
//! Split out because two callers need it and only one of them existed when it
//! was written: instantiating a set somewhere else, and duplicating a
//! selection in place. They differ entirely in what they do about WIRES and
//! not at all in what they do about values, and this is the half that has been
//! wrong before - a sketch's drawing is an object and fell straight through a
//! test for numbers, so a copied sketch arrived empty with everything else
//! about it intact. One copy of that, tested once.
//! \p renamed maps old ids to new ones, for the one value that contains an id:
//! a pick names the body it was taken from. Left unmapped, a duplicated fillet
//! carries "edge 2 of Extrude.1" while sitting on the copy of Extrude.1 - which
//! resolves anyway, because a pick is matched against the body it is actually
//! wired to, and reads as a lie in the file for as long as anybody looks at it.
export function valueEdits(entry, id, types = null, renamed = null) {
  const moved = of => (renamed && renamed.get && renamed.get(of)) || of;
  const edits = [];
  const args = entry.args || {};
  for (const [key, value] of Object.entries(args)) {
    const arg = types ? (types.args || []).find(one => one.key === key) : null;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) continue;                      // a list of wires
    if (typeof value === "object") {
      //! A DRAWING IS AN OBJECT, and it came here as one. The model writer
      //! publishes a sketch's drawing whole - {elements, constraints} - and
      //! this used to look at objects only for a driven number or a hand-
      //! moved vertex, so a sketch fell straight through and the copy
      //! arrived with an empty one. Everything else about the sketch came
      //! across, which is what made it look like the sketch had been
      //! skipped rather than emptied.
      //!
      //! Recognised two ways: by the argument's kind when the catalogue is
      //! to hand, and by the shape of the thing itself when it is not - an
      //! object with an elements array in it is a drawing whatever anybody
      //! says, and dropping it quietly is the one outcome worth ruling out
      //! twice.
      if ((arg && arg.kind === "sketch") || Array.isArray(value.elements)) {
        edits.push({ op: "sketch", id, drawing: value });
        continue;
      }
      //! A PICK MAY CARRY ITS SPREADING RULE, which makes it an object too.
      //! {mode, angle, picks} is what a fillet on a whole arris looks like in
      //! the file, and a copy that kept the seeds and lost the rule would
      //! round one edge where the original rounds eight.
      if (Array.isArray(value.picks)) {
        edits.push({ op: "pick", id, key,
                     picks: value.picks.map(one => ({ ...one, of: moved(one.of) })),
                     mode: value.mode, angle: value.angle });
        continue;
      }
      // { value, from } - the number is stored, the wire is made later.
      if (value.from !== undefined && Number.isFinite(Number(value.value)))
        edits.push({ op: "set", id, key, value: Number(value.value) });
      else if (value.ref === undefined && arg && arg.kind === "edits")
        // Vertices somebody moved by hand, one edit each - which is how the
        // language spells them, and the only op there is for it.
        for (const [at, to] of Object.entries(value))
          if (Array.isArray(to) && to.length >= 3)
            edits.push({ op: "vertex", id, index: Number(at),
                         x: Number(to[0]), y: Number(to[1]), z: Number(to[2]) });
      continue;
    }
    if (typeof value === "number") { edits.push({ op: "set", id, key, value }); continue; }
    if (typeof value === "string") {
      if (arg && arg.kind === "choice") {
        const at = (arg.options || []).indexOf(value);
        if (at >= 0) edits.push({ op: "set", id, key, value: at });
        continue;
      }
      // And a drawing written as text rather than as an object, which the
      // model format also allows.
      if (arg && arg.kind === "sketch") {
        edits.push({ op: "sketch", id, drawing: value });
        continue;
      }
      edits.push({ op: "code", id, key, text: value });
      continue;
    }
  }
  if (entry.appearance && typeof entry.appearance === "object")
    edits.push({ op: "appearance", id, appearance: entry.appearance });
  //! And how it pairs up the lists arriving on it, which is stored beside the
  //! appearance for the same reason and copies for the same reason.
  if (entry.spread && typeof entry.spread === "object")
    edits.push({ op: "spread", id, match: entry.spread.match,
                 graft: entry.spread.graft, flatten: entry.spread.flatten });
  // The picks written as a bare list, which is what a pick with no rule looks
  // like and what every file written before rules existed holds.
  for (const [key, value] of Object.entries(args)) {
    const arg = types ? (types.args || []).find(one => one.key === key) : null;
    if (arg && arg.kind === "subs" && Array.isArray(value) && value.length)
      edits.push({ op: "pick", id, key,
                   picks: value.map(one => ({ ...one, of: moved(one.of) })) });
  }
  return edits;
}

export function instantiateEdits(model, setId, { taken = new Set(),
                                                 takenNames = new Set(),
                                                 spec = null,
                                                 name = null } = {}) {
  const all = featuresOf(model);
  const set = all.find(one => one.id === setId);
  if (!set) throw new Error("that file has no set called " + setId);
  const members = contentsOf(model, setId);
  const inside = new Set([setId, ...members.map(one => one.id)]);

  const used = new Set(taken);
  const usedNames = new Set(takenNames);
  const renamed = new Map();
  const rebadge = entry => {
    const id = freshId(entry.id, used);
    used.add(id);
    renamed.set(entry.id, id);
    return id;
  };

  const edits = [];
  const setId2 = rebadge(set);
  const setName = freshName(name || set.name || "Set", usedNames);
  usedNames.add(setName);
  edits.push({ op: "add", type: set.type, id: setId2, name: setName, refs: {} });

  for (const entry of members) {
    const id = rebadge(entry);
    const given = freshName(entry.name || entry.type, usedNames);
    usedNames.add(given);
    edits.push({ op: "add", type: entry.type, id, name: given, refs: {} });
  }

  // Filed away second, so a set's contents are put into a set that exists.
  for (const entry of members)
    edits.push({ op: "group", id: renamed.get(entry.id),
                 into: renamed.get(entry.parent) || setId2 });

  // Then the numbers, the text and the picks - everything that is a value
  // rather than a wire. See valueEdits: one copy of it, two callers.
  const dropped = [];
  for (const entry of members)
    edits.push(...valueEdits(entry, renamed.get(entry.id),
                             spec ? spec(entry.type) : null, renamed));

  // And last the wires, now that everything they could point at exists.
  for (const entry of members) {
    const id = renamed.get(entry.id);
    for (const wire of wiresIn(entry)) {
      if (!inside.has(wire.to)) {
        // A WIRE THAT LEFT THE SET IS AN INPUT. It arrives unwired on
        // purpose: the whole point of reusing a set somewhere else is that
        // the somewhere else is different, and a wire quietly pointed at
        // whatever happened to be lying about would be worse than an empty
        // field that says what it wants.
        dropped.push({ id, holder: entry.name || entry.id, key: wire.key,
                       was: wire.to, drives: !!wire.drives });
        continue;
      }
      const to = renamed.get(wire.to);
      if (to) edits.push({ op: "connect", id, key: wire.key, from: to });
    }
  }

  //! WHICH OF THE DROPPED WIRES WERE ONE INPUT. Two features inside a set
  //! reading the same point outside it are not two inputs, they are one
  //! asked for twice - and once the wires are cut there is nothing left in
  //! the copy to say so. So it is written down here, where it is still
  //! known, and the set carries it: one row per thing that was pointed at,
  //! naming every argument that pointed there.
  const groups = [];
  for (const one of dropped) {
    const had = groups.find(row => row.was === one.was && row.drives === one.drives);
    const at = { id: one.id, key: one.key };
    if (had) { had.holders.push(at); continue; }
    const source = all.find(other => other.id === one.was);
    groups.push({ name: (source && source.name) || one.was, was: one.was,
                  drives: !!one.drives, holders: [at] });
  }
  if (groups.length)
    edits.push({ op: "code", id: setId2, key: "inputs",
                 text: JSON.stringify({ version: 1, inputs: groups }) });

  //! What each member was CALLED before it was copied, by its old id. A plan
  //! that overrides a value inside a copy names the member the way the panel
  //! spells it - "Column height · value" - and this is what turns that name
  //! back into the feature the copy actually made.
  const namesWas = {};
  for (const entry of [set, ...members]) namesWas[entry.id] = entry.name || entry.id;

  return { edits, id: setId2, name: setName, inputs: dropped, groups, namesWas,
           renamed: Object.fromEntries(renamed) };
}

//! And reading it back, tolerantly: a set whose note somebody hand-edited
//! loses the row it got wrong rather than the whole list, because a panel
//! that will not draw is worse than one with a gap in it.
export function readDeclared(text) {
  const said = String(text == null ? "" : text).trim();
  if (!said) return [];
  let read;
  try { read = JSON.parse(said); } catch (error) { return []; }
  const list = Array.isArray(read) ? read : (read && Array.isArray(read.inputs) ? read.inputs : []);
  return list.map(one => ({
    name: String((one && one.name) || ""),
    was: String((one && one.was) || ""),
    drives: !!(one && one.drives),
    holders: Array.isArray(one && one.holders)
      ? one.holders.filter(at => at && at.id && at.key)
                   .map(at => ({ id: String(at.id), key: String(at.key) }))
      : [],
  })).filter(one => one.holders.length);
}

//! One line about what is about to arrive, for the dialogue and the log.
export function saysReuse(one) {
  if (!one) return "nothing to instantiate";
  const holds = one.holds || 0, inputs = one.inputs || 0;
  return one.name + " · " + (holds ? holds + (holds === 1 ? " feature" : " features")
                                        : "empty")
       + " · " + (inputs ? inputs + (inputs === 1 ? " input" : " inputs")
                              : "nothing to supply");
}

/* ============================================ a set as a feature, live

   THE SAME QUESTION IN TWO WINDOWS. The definition panel lists what a set
   asks for; the node editor draws a set as ONE node with those same things
   as its ports. If the two worked it out separately they would sooner or
   later disagree about how many inputs a set has, which is the kind of
   disagreement nobody can debug from a screenshot. So it is worked out once,
   here, over plain feature records - no document, no DOM.                 */

//! Everything filed under a set in a LIVE tree, at any depth. The tree's
//! entries carry a parent; that is all this needs.
export function membersOf(features, setId) {
  const out = [];
  const walk = holder => {
    for (const one of features) {
      if (one.parent !== holder || out.includes(one)) continue;
      out.push(one);
      walk(one.id);
    }
  };
  walk(setId);
  return out;
}

//! What reaches INTO a set: every argument of everything inside it that is
//! wired to something outside, plus every argument that is wired to nothing
//! at all - an empty input is the set asking for something.
//!
//! \p spec looks a type up in the catalogue; \p applies says whether an
//! argument is shown for the feature's current choices, because an argument
//! that is not shown is not read either.
export function reachesIn(features, setId, { spec, applies = () => true } = {}) {
  const inside = new Set([setId, ...membersOf(features, setId).map(one => one.id)]);
  const rows = [];
  for (const child of features) {
    if (child.id === setId || !inside.has(child.id)) continue;
    const type = spec ? spec(child.type) : null;
    if (!type) continue;
    for (const arg of type.args || []) {
      if (!applies(child, arg)) continue;
      //! A NUMBER DRIVEN FROM OUTSIDE IS AN INPUT TOO. A set whose height
      //! follows a parameter in the document needs that parameter supplied
      //! when it is reused, exactly as it needs its plane supplied.
      if (arg.kind === "real") {
        const from = (child.driven || {})[arg.key];
        if (from && !inside.has(from))
          rows.push({ child, arg, outside: [from], number: true });
        continue;
      }
      if (arg.kind !== "ref" && arg.kind !== "refs") continue;
      const wired = arg.kind === "refs" ? ((child.lists || {})[arg.key] || [])
                                        : [(child.refs || {})[arg.key]].filter(Boolean);
      const outside = wired.filter(one => !inside.has(one));
      //! A wire that stays inside the set is the set's own plumbing, not an
      //! input to it: a circle standing on a point in the same set is not
      //! something anybody has to supply.
      if (outside.length || !wired.length) rows.push({ child, arg, outside });
    }
  }
  return rows;
}

//! And out the other side: what inside the set is read by something outside
//! it. Those are the set's results - the ports the rest of the model plugs
//! into when the set is drawn as one node.
export function reachesOut(features, setId, { spec, applies = () => true } = {}) {
  const inside = new Set([setId, ...membersOf(features, setId).map(one => one.id)]);
  const out = [];
  for (const other of features) {
    if (inside.has(other.id)) continue;
    const type = spec ? spec(other.type) : null;
    if (!type) continue;
    for (const arg of type.args || []) {
      if (!applies(other, arg)) continue;
      const wired = arg.kind === "refs" ? ((other.lists || {})[arg.key] || [])
                  : arg.kind === "ref" ? [(other.refs || {})[arg.key]].filter(Boolean)
                  : arg.kind === "real" ? [(other.driven || {})[arg.key]].filter(Boolean)
                  : [];
      for (const id of wired)
        if (inside.has(id) && !out.some(one => one.id === id))
          out.push({ id, by: other.id, key: arg.key });
    }
  }
  return out;
}

//! ONE INPUT, HOWEVER MANY THINGS READ IT. Two arguments inside a set wired
//! to the same thing outside are one input asked for twice; listing it twice
//! is noise in the panel and a wire too many in the graph, and repointing one
//! of them silently leaves the other where it was.
//!
//! Gathered two ways because there are two cases. A wire that is still there
//! groups by what it points AT. A wire that was CUT - which is what
//! instantiating a set does to every input it had - has nothing to group by,
//! so the set carries a note of which arguments shared a source and that note
//! is read back here.
export function gatherInputs(rows, { declared = [], nameOf = id => id } = {}) {
  const groups = [];
  const seat = new Map();
  const key = row => row.child.id + ":" + row.arg.key;

  for (const said of declared) {
    const mine = said.holders
      .map(at => rows.find(row => row.child.id === at.id && row.arg.key === at.key))
      .filter(Boolean);
    if (!mine.length) continue;
    const group = { rows: mine, name: said.name, declared: true, to: null };
    groups.push(group);
    for (const row of mine) seat.set(key(row), group);
  }

  for (const row of rows) {
    if (seat.has(key(row))) continue;
    const to = row.outside[0] || null;
    const had = to && groups.find(one => !one.declared && one.to === to
                                      && !!one.rows[0].number === !!row.number);
    if (had) { had.rows.push(row); seat.set(key(row), had); continue; }
    const group = { rows: [row], to, name: to ? nameOf(to) : "" };
    groups.push(group);
    seat.set(key(row), group);
  }
  return groups;
}

//! The whole of it, for a caller that has a tree and a catalogue: a set's
//! inputs, gathered, in the order the panel and the graph both show them.
export function setInputGroups(features, setId, { spec, applies, declaredText = "",
                                                 nameOf } = {}) {
  const rows = reachesIn(features, setId, { spec, applies });
  return gatherInputs(rows, { declared: readDeclared(declaredText), nameOf });
}
