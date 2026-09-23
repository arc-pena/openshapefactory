// Space Packing: does the brief go in the envelope?
//
// The package around the engine in packing.js. It brings one node, so a study
// can be committed to the document and rebuilt with it, and one mode, so the
// study can be driven: pick an envelope, paste or generate a schedule of
// accommodation, watch the rooms drop into the storeys, and see the ones that
// did not fit standing on the ground beside the building where they cannot be
// mistaken for a result.
//
// The mode is LIVE, and that is the point of it being in a parametric
// modeller. Push a face and the envelope changes; the storeys are re-cut, the
// headroom inset re-taken, and the packing runs again - but not from nothing.
// What was placed and is still valid stays exactly where it was, because a
// massing study that rearranges itself on every nudge is one you cannot steer.
// Only the backlog and whatever the edit invalidated are packed again, and the
// backlog goes first, because the usual reason for making the envelope bigger
// is that something did not fit.
//
// WHAT THE NUMBERS ARE. The geometry is computed and exact to the
// tessellation: volumes, sections, plate areas, whether a room is inside its
// floor and under enough ceiling. WHERE each room goes is a heuristic - three
// of them, offered as options - because packing rectangles into a polygon
// optimally is NP-hard and nobody does it exactly. Nothing here is measured
// and nothing here is a code check: a room that fits fits geometrically, and
// that is all it says.

import { ARG } from "./ocaf.js";
import { materialOf } from "./styles.js";
import { offerPlugin } from "./plugin.js";
import { MIN_HEADROOM, STRATEGIES, bandsOf, meshBounds, meshVolume, packAll, parkOf,
         readBrief, reflow, ringsArea, sampleBrief, summarise, writeBrief } from "./packing.js";

/* ----------------------------------------------------------------- nodes */

export const PACKING_NODES = [
  { type: "SpacePlan", guid: "9a1b2c30-00f0-4c00-9e00-caf0000000f0",
    category: "operation", produces: "solid",
    summary: "A schedule of accommodation packed into a massing envelope, as one solid "
           + "per room. The envelope is cut into storeys, each storey's floor plate is "
           + "inset for headroom, and the rooms are laid into what is left. What fits is "
           + "built; what does not is reported and not invented.",
    args: [ARG.ref("envelope", "Envelope", ["solid", "mesh"], false),
           ARG.text("brief", "Brief", "# name, area m2, height m, aspect, priority"),
           ARG.real("storey", "Storey height", 3500, 2000, 12000, 50),
           ARG.real("headroom", "Minimum headroom", MIN_HEADROOM, 900, 4000, 50),
           ARG.real("gap", "Gap between rooms", 300, 0, 3000, 50),
           ARG.choice("strategy", "Packing", ["Bottom left", "Rows", "Centre out"], 0),
           ARG.choice("orientation", "Orientation", ["Either way", "Long side across",
                                                     "Long side up"], 0)] },
];

const STRATEGY_OF = ["corner", "rows", "centre"];
const ORIENTATION_OF = ["either", "wide", "tall"];

//! The envelope's triangles, whichever kind of thing it is.
//!
//! A mesh already IS triangles and is used as it stands - tessellating one
//! would be converting a thing into itself and losing the vertices somebody
//! moved by hand on the way. A BRep has none until it is asked, so it is
//! asked, once, at the deflection the viewport would use.
export function envelopeMesh(kit, feature) {
  const { F, tessellate } = kit.toolkit();
  if (!feature) return null;
  const data = F.data(feature);
  if (data && data.kind === "mesh") {
    const points = F.triples(data);
    const positions = [];
    for (const p of points) positions.push(p[0], p[1], p[2]);
    const index = [];
    // A quad is two triangles and a pentagon is three; a fan off the first
    // corner is right for anything convex and near enough for a face somebody
    // pushed about, which is what these are.
    for (const face of meshFacesOf(data))
      for (let i = 1; i + 1 < face.length; i++) index.push(face[0], face[i], face[i + 1]);
    return { positions, index };
  }
  const shape = F.shape(feature);
  if (!shape) return null;
  const mesh = tessellate(shape, 0);
  return mesh && mesh.positions && mesh.index
    ? { positions: mesh.positions, index: mesh.index } : null;
}

//! The faces of a packed mesh, as lists of vertex indices. The same unpacking
//! ocaf.js does for the panel, here so a driver does not have to import the
//! interface to read its own argument.
function meshFacesOf(data) {
  const packed = (data && data.faces) || [];
  const out = [];
  for (let i = 0; i < packed.length;) {
    const n = packed[i++];
    const face = [];
    for (let k = 0; k < n && i < packed.length; k++) face.push(packed[i++]);
    if (face.length >= 3) out.push(face);
  }
  return out;
}

//! One run of the whole pipeline, from an envelope mesh and a brief to where
//! everything went. The driver and the mode both call this, so the solid the
//! document rebuilds and the boxes on screen can never be two different
//! answers to the same question.
export function packRun(mesh, brief, options = {}) {
  const bands = bandsOf(mesh, options);
  const rows = Array.isArray(brief) ? brief : readBrief(brief);
  const out = packAll(bands, rows, options);
  return { ...out, bands, rows, bounds: meshBounds(mesh),
           report: summarise(out, rows) };
}

export function packingDrivers(kit) {
  const { F, shape: SF, compoundOf, text } = kit.toolkit();
  return {
    SpacePlan: {
      precondition: f => {
        if (!F.reference(f, "envelope")) return "no envelope to pack into";
        if (!readBrief(F.text(f, "brief")).length)
          return "the brief is empty - a name and an area per line";
        if (F.real(f, "storey", 3500) < 2000) return "a storey under 2 m is not a storey";
        return null;
      },
      build: f => {
        const mesh = envelopeMesh(kit, F.reference(f, "envelope"));
        if (!mesh) throw new Error("that envelope has no geometry to cut");
        const run = packRun(mesh, F.text(f, "brief"), {
          storey: F.real(f, "storey", 3500),
          minHeadroom: F.real(f, "headroom", MIN_HEADROOM),
          gap: F.real(f, "gap", 300),
          strategy: STRATEGY_OF[F.choice(f, "strategy", 0)] || "corner",
          orientation: ORIENTATION_OF[F.choice(f, "orientation", 0)] || "either",
        });
        if (!run.placed.length)
          throw new Error("not one room in the brief fits in that envelope"
            + (run.bands.length ? "" : " - it has no storey with headroom in it"));
        const solids = run.placed.map(room =>
          SF.boxAt([room.x, room.y, room.z], room.w, room.h, room.height));
        const built = solids.length === 1 ? solids[0] : compoundOf(solids);
        //! The report rides with the shape, a line at a time, so the panel can
        //! say what was left out without re-running anything and the file
        //! records it. A packer that builds only what fitted and says nothing
        //! about the rest looks exactly like one that fitted everything.
        return { shape: built, data: text([
          reportLine(run.report),
          ...run.unplaced.map(r => "not placed · " + r.name + " · "
            + Math.round(r.area / 1e6) + " m²"),
        ]) };
      },
    },
  };
}

const reportLine = said =>
  said.placed + " of " + said.rooms + " rooms placed · "
  + Math.round(said.areaPlaced / 1e6) + " of " + Math.round(said.areaAsked / 1e6) + " m²";

/* ------------------------------------------------------------- the mode */

const SAFE = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const M2 = mm2 => Math.round(mm2 / 1e6);

//! Rooms are coloured by the storey they are on, because the question a
//! massing study is asked is "what is on the third floor" rather than "which
//! room is that". Unplaced is grey, always, and grey is used for nothing else.
const BAND_HUES = [205, 168, 42, 320, 265, 12];
const GREY = "#9aa1aa";

//! The mode. Live: the model changing is the reason it exists, so a rebuild
//! re-cuts the storeys and packs again rather than throwing the study away -
//! and keeps what was already placed exactly where it was.
export function PackingView(kit) {
  const view = Object.create(PackingView.prototype);
  view.kit = kit;
  view.on = false;
  view.stale = false;
  view.auto = true;
  view.seed = 1;
  view.options = { storey: 3500, minHeadroom: MIN_HEADROOM, gap: 300,
                   strategy: "corner", orientation: "either" };
  view.brief = "";
  view.run = null;
  view.envelope = null;               // feature id, or null for "the biggest thing"
  view.rooms = [];                    // what is drawn: { name, at, to, box, status }
  view.group = new kit.THREE.Group();
  view.group.visible = false;
  kit.world.add(view.group);
  view.buildPanel();
  return view;
}

PackingView.prototype = {
  constructor: PackingView,

  /* ------------------------------------------------------------ the panel */

  buildPanel() {
    const bar = document.createElement("section");
    bar.className = "float sp-bar";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="sp-row">
        <span class="sp-tag">envelope</span>
        <select class="sp-pick" id="sp-envelope"></select>
        <button class="sp-btn" id="sp-sample">Sample</button>
        <button class="sp-btn primary" id="sp-pack">Pack</button>
      </div>
      <div class="sp-row">
        <span class="sp-tag">storey</span>
        <input type="range" id="sp-storey" min="2000" max="9000" step="100" value="3500">
        <span class="sp-read" id="sp-storey-read">3.50 m</span>
        <span class="sp-tag">headroom</span>
        <input type="range" id="sp-head" min="900" max="4000" step="50" value="1500">
        <span class="sp-read" id="sp-head-read">1.50 m</span>
        <span class="sp-tag">gap</span>
        <input type="range" id="sp-gap" min="0" max="3000" step="50" value="300">
        <span class="sp-read" id="sp-gap-read">300 mm</span>
      </div>
      <div class="sp-row">
        <span class="sp-tag">packing</span>
        <div class="sp-seg" id="sp-strategy">
          <button data-key="corner" aria-pressed="true">Bottom left</button>
          <button data-key="rows" aria-pressed="false">Rows</button>
          <button data-key="centre" aria-pressed="false">Centre out</button>
        </div>
        <span class="sp-tag">rooms</span>
        <div class="sp-seg" id="sp-orientation">
          <button data-key="either" aria-pressed="true">Either way</button>
          <button data-key="wide" aria-pressed="false">Across</button>
          <button data-key="tall" aria-pressed="false">Up</button>
        </div>
        <span class="sp-tag">on edit</span>
        <div class="sp-seg" id="sp-reflow">
          <button data-key="auto" aria-pressed="true">Re-pack</button>
          <button data-key="manual" aria-pressed="false">Wait</button>
        </div>
        <button class="sp-btn" id="sp-rerun" hidden>Re-run</button>
      </div>
      <div class="sp-note" id="sp-note">pick an envelope, then Sample or paste a brief</div>`;
    document.body.appendChild(bar);
    this.bar = bar;

    const panel = document.createElement("aside");
    panel.className = "float sp-panel";
    panel.hidden = true;
    // Built once and only the report written into afterwards: a panel rebuilt
    // wholesale would take the brief out from under somebody's cursor every
    // time the envelope moved.
    panel.innerHTML = `
      <div class="sp-head"><h2>Space packing</h2><span class="sp-clock" id="sp-clock"></span></div>
      <div class="sp-body">
        <section class="sp-block"><h3>The brief</h3>
          <textarea id="sp-text" spellcheck="false"
            placeholder="name, area m2, height m, aspect, priority&#10;Office, 120, 3.0, 1.5, 2"></textarea>
          <div class="sp-actions">
            <button class="sp-btn" id="sp-commit">Commit to model</button>
          </div>
          <p class="sp-small">One room a line: a name, an area in square metres, and
            optionally a height, how square it should be, and a priority. Sample writes
            one for you.</p>
        </section>
      </div>
      <div id="sp-report"></div>`;
    document.body.appendChild(panel);
    this.panel = panel;
    this.reportAt = panel.querySelector("#sp-report");
    const text = panel.querySelector("#sp-text");
    text.addEventListener("change", () => { this.brief = text.value; this.repack(true); });
    text.addEventListener("keydown", event => event.stopPropagation());
    panel.querySelector("#sp-commit").addEventListener("click", () => this.commit());
    this.text = text;

    const at = id => bar.querySelector("#" + id);
    at("sp-sample").addEventListener("click", () => this.takeSample());
    at("sp-pack").addEventListener("click", () => this.repack(true));
    at("sp-rerun").addEventListener("click", () => this.reflowNow());
    at("sp-envelope").addEventListener("change", event => {
      this.envelope = event.target.value || null;
      this.repack(true);
    });
    const slider = (id, key, show) => {
      at(id).addEventListener("input", event => {
        this.options[key] = Number(event.target.value);
        at(id + "-read").textContent = show(Number(event.target.value));
        this.queueRepack();
      });
    };
    slider("sp-storey", "storey", v => (v / 1000).toFixed(2) + " m");
    slider("sp-head", "minHeadroom", v => (v / 1000).toFixed(2) + " m");
    slider("sp-gap", "gap", v => v + " mm");
    const segment = (id, pick) => {
      for (const button of at(id).querySelectorAll("button"))
        button.addEventListener("click", () => {
          for (const other of at(id).querySelectorAll("button"))
            other.setAttribute("aria-pressed", other === button ? "true" : "false");
          pick(button.dataset.key);
        });
    };
    segment("sp-strategy", key => { this.options.strategy = key; this.repack(true); });
    segment("sp-orientation", key => { this.options.orientation = key; this.repack(true); });
    segment("sp-reflow", key => {
      this.auto = key === "auto";
      at("sp-rerun").hidden = this.auto;
      if (this.auto && this.stale) this.reflowNow();
    });
  },

  //! Every solid and mesh in the document, so the envelope can be chosen. The
  //! one already chosen stays chosen across a rebuild; a document that has
  //! lost it falls back to the biggest thing in it, which is what a massing
  //! envelope nearly always is.
  fillEnvelopes() {
    const pick = this.bar.querySelector("#sp-envelope");
    const able = this.kit.tree().features.filter(f =>
      (f.produces === "solid" || f.produces === "mesh") && f.built && !f.consumedBy
      && f.type !== "SpacePlan");
    const was = this.envelope;
    pick.innerHTML = able.length
      ? able.map(f => '<option value="' + SAFE(f.id) + '">' + SAFE(f.name) + "</option>").join("")
      : '<option value="">nothing to pack into</option>';
    if (!able.some(f => f.id === was)) this.envelope = this.biggest(able);
    pick.value = this.envelope || "";
    return able;
  },

  biggest(able) {
    let best = null, most = -1;
    for (const f of able) {
      const mesh = this.kit.streams().get(f.id);
      const size = mesh ? meshVolume(mesh) : 0;
      if (size > most) { most = size; best = f.id; }
    }
    return best;
  },

  envelopeMeshNow() {
    const mesh = this.envelope ? this.kit.streams().get(this.envelope) : null;
    return mesh && mesh.positions && mesh.index && mesh.index.length >= 3 ? mesh : null;
  },

  /* ---------------------------------------------------------- the packing */

  //! A brief invented for whatever is in front of you. Straight into the same
  //! pipeline a pasted one goes into - it is a brief, not a demo mode, so
  //! nothing downstream knows or cares where it came from.
  takeSample() {
    const mesh = this.envelopeMeshNow();
    if (!mesh) { this.say("pick an envelope first"); return; }
    this.seed++;
    const rows = sampleBrief(mesh, { ...this.options, seed: this.seed });
    if (!rows.length) { this.say("that envelope has no storey with headroom in it"); return; }
    this.brief = writeBrief(rows);
    this.repack(true);
  },

  //! Pack from nothing. \p fresh means exactly that: the brief is laid out
  //! again from an empty envelope, which is what Pack, Sample and a change of
  //! strategy all want. Everything else goes through reflowNow.
  repack(fresh = false) {
    const mesh = this.envelopeMeshNow();
    if (!mesh) { this.run = null; this.draw(); this.say("pick an envelope first"); return; }
    const rows = readBrief(this.brief);
    if (!rows.length) { this.run = null; this.draw(); this.say("no brief yet - Sample makes one"); return; }
    const started = performance.now();
    this.run = packRun(mesh, rows, this.options);
    this.run.ms = Math.round(performance.now() - started);
    this.stale = false;
    this.draw(fresh);
    this.report();
    // A fresh pack is a new thing to look at, and there was nothing to frame
    // when the mode opened with no brief in it. A REFLOW never moves the
    // camera: the whole point of one is watching what your edit did from
    // where you were standing when you made it.
    if (fresh) this.overView();
  },

  //! Pack again, keeping what is already placed. This is the live one.
  //!
  //! Twice, and that is on purpose. A hand dragging a face sends an edit a
  //! frame, and each one wants an answer NOW rather than a good answer in a
  //! moment: so a coarse pass runs immediately - half as fine a grid, a
  //! quarter as many probes for the usable area - and the accurate one is
  //! booked for three hundred milliseconds after the hand stops. Drag, and the
  //! massing keeps up; let go, and the numbers settle to the real ones.
  reflowNow(quick = false) {
    const mesh = this.envelopeMeshNow();
    if (!mesh || !this.run) { this.repack(true); return; }
    const started = performance.now();
    const options = { ...this.options, quick };
    const bands = bandsOf(mesh, options);
    const out = reflow(this.run, bands, options);
    this.run = { ...out, bands, rows: this.run.rows, bounds: meshBounds(mesh), quick,
                 report: summarise(out, this.run.rows), ms: Math.round(performance.now() - started) };
    this.stale = false;
    this.bar.querySelector("#sp-rerun").classList.remove("waiting");
    this.draw();
    this.report();
    clearTimeout(this.settling);
    if (quick) this.settling = setTimeout(() => { if (this.on) this.reflowNow(false); }, 300);
  },

  //! One re-pack a frame however many times a slider says it moved.
  queueRepack() {
    if (this.queued) return;
    this.queued = requestAnimationFrame(() => {
      this.queued = 0;
      if (this.on) this.repack(true);
    });
  },

  say(words) { this.bar.querySelector("#sp-note").textContent = words; },

  //! The study, into the document. A massing study that only exists in a mode
  //! is a screenshot; this makes it a feature - wired to the envelope it was
  //! packed into, carrying the brief and the settings it was packed with, and
  //! rebuilt with everything else when the envelope changes. What is on screen
  //! and what is in the file are then the same run, because they are made by
  //! the same function.
  async commit() {
    if (!this.envelope) { this.say("pick an envelope first"); return; }
    if (!readBrief(this.brief).length) { this.say("no brief to commit"); return; }
    try {
      const born = await this.kit.mdl.run({ op: "add", type: "SpacePlan",
        refs: { envelope: this.envelope } });
      const id = born && born.id;
      if (!id) return;
      await this.kit.mdl.runAll([
        { op: "code", id, key: "brief", text: this.brief },
        { op: "set", id, key: "storey", value: this.options.storey },
        { op: "set", id, key: "headroom", value: this.options.minHeadroom },
        { op: "set", id, key: "gap", value: this.options.gap },
        { op: "set", id, key: "strategy",
          value: Math.max(0, STRATEGY_OF.indexOf(this.options.strategy)) },
        { op: "set", id, key: "orientation",
          value: Math.max(0, ORIENTATION_OF.indexOf(this.options.orientation)) },
      ]);
      this.say("committed as " + id + " - it rebuilds with the envelope now");
    } catch (err) { this.say(err.message); }
  },

  /* ---------------------------------------------------------- the drawing */

  //! What is on screen, from the same list the report counts. A room is a box
  //! where it was placed, or a grey box on the ground beside the building if
  //! it was not - never nothing, because a room that vanishes is a brief that
  //! quietly got shorter.
  draw(snap = false) {
    const THREE = this.kit.THREE;
    while (this.group.children.length) {
      const child = this.group.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.rooms = [];
    if (!this.run) { this.kit.draw(); return; }

    // The envelope itself, as a glass case. The model's own meshes are hidden
    // while this mode is open - an opaque massing block with the rooms inside
    // it is a picture of a block - so it is drawn here instead, see-through,
    // with a line on every edge so the shape still reads.
    //
    // In WHATEVER it was given in the model. A finish and an opacity assigned
    // to a body are properties of that body, not of the mode somebody happens
    // to be looking at it in: an envelope set to 30% glass has been set to 30%
    // glass everywhere. Only when nothing has been said does this pick the
    // neutral case, and even then it never goes more opaque than it can be
    // seen through - the rooms are the thing being looked at.
    const shell = this.envelopeMeshNow();
    if (shell) {
      const said = (this.kit.tree().features.find(f => f.id === this.envelope) || {}).appearance;
      const worn = said ? materialOf(said) : null;
      const colour = worn ? new THREE.Color(worn.color[0], worn.color[1], worn.color[2])
                          : new THREE.Color("#8fa3b8");
      // What was asked for, capped: a solid envelope drawn solid would hide
      // the packing, which is the one thing this mode is for.
      const clear = worn ? Math.min(worn.opacity, 0.35) : 0.07;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(shell.positions, 3));
      geometry.setIndex(Array.from(shell.index));
      geometry.computeVertexNormals();
      this.group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: clear,
        side: THREE.DoubleSide, depthWrite: false })));
      this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({ color: colour.clone().multiplyScalar(0.7),
                                      transparent: true, opacity: 0.5 })));
    }

    const parked = parkOf(this.run.bounds, this.run.unplaced, { gap: this.options.gap * 4 || 1200 });
    const all = [...this.run.placed.map(r => ({ ...r, parked: false })), ...parked];
    for (const room of all) {
      const height = Math.max(room.height || this.options.minHeadroom, 100);
      const geometry = new THREE.BoxGeometry(room.w, room.h, height);
      const hue = room.parked ? null : BAND_HUES[(room.band || 0) % BAND_HUES.length];
      const colour = room.parked ? new THREE.Color(GREY)
        : new THREE.Color().setHSL(hue / 360, 0.42, 0.56);
      const box = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
        color: colour, transparent: true, opacity: room.parked ? 0.75 : 0.9 }));
      const to = [room.x + room.w / 2, room.y + room.h / 2, room.z + height / 2];
      // A room that has just moved between the ground and the building slides
      // there rather than teleporting: the whole use of the grey row is that
      // you can see something leave it.
      const before = this.was && this.was.get(room.name);
      const from = snap || !before ? to : before;
      box.position.set(from[0], from[1], from[2]);
      box.userData.id = room.parked ? null : this.envelope;
      this.group.add(box);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.85 }));
      edge.position.copy(box.position);
      this.group.add(edge);
      this.rooms.push({ name: room.name, box, edge, to, status: room.parked ? "unplaced" : "placed" });
    }
    this.was = new Map(this.rooms.map(r => [r.name, r.to]));
    this.kit.draw();
  },

  //! The slide. Nothing else about this mode moves, so a frame that has
  //! nothing travelling costs one comparison.
  tick(dt) {
    let moving = false;
    for (const room of this.rooms) {
      const at = room.box.position;
      const dx = room.to[0] - at.x, dy = room.to[1] - at.y, dz = room.to[2] - at.z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1) continue;
      const step = Math.min(1, dt * 4);
      at.set(at.x + dx * step, at.y + dy * step, at.z + dz * step);
      room.edge.position.copy(at);
      moving = true;
    }
    if (moving) this.kit.draw();
  },

  /* ----------------------------------------------------------- the report */

  //! What happened, counted off the same lists the boxes were drawn from -
  //! never recomputed, so the number on the panel and the grey box on the
  //! ground cannot say different things.
  report() {
    if (this.text && this.text.value !== this.brief) this.text.value = this.brief;
    if (!this.run) { this.reportAt.innerHTML = ""; return; }
    const said = this.run.report;
    const bands = this.run.bands;
    const perBand = bands.map((band, i) => {
      const here = this.run.placed.filter(r => r.band === i);
      const used = here.reduce((sum, r) => sum + r.w * r.h, 0);
      return { i, band, rooms: here.length, used };
    });
    const bar = share => '<div class="sp-meter"><i style="width:'
      + Math.round(Math.max(0, Math.min(1, share)) * 100) + '%"></i></div>';

    this.panel.querySelector("#sp-clock").textContent = said.placed + " of " + said.rooms + " rooms";
    this.reportAt.innerHTML = `
      <div class="sp-body">
        <section class="sp-block"><h3>What went in</h3>
          ${spPair("rooms placed", said.placed + " of " + said.rooms)}
          ${spPair("area placed", M2(said.areaPlaced) + " of " + M2(said.areaAsked) + " m²")}
          ${bar(said.share)}
          ${spPair("of the brief", Math.round(said.share * 100) + "%")}
          <p class="sp-small">Area is what was laid out, not what could be built: the
            rooms are rectangles on a plate, without walls, structure or circulation
            between them. Where each one went is a heuristic - bottom left, rows or
            centre out - and a run says how much IT placed, not that no better one
            exists.</p>
        </section>
        <section class="sp-block"><h3>Storeys</h3>
          ${perBand.map(b => spPair((b.band.z / 1000).toFixed(1) + " m",
              b.rooms + " rooms · " + M2(b.used) + " of " + M2(b.band.usable) + " m² usable")).join("")}
          <p class="sp-small">Usable is the part of the plate with ${(this.options.minHeadroom / 1000).toFixed(2)} m
            over it - the section at your feet and the section at your head, agreeing.
            On a box it is the whole plate; under a slope it is not, and that is the
            difference between this and a plan area.</p>
        </section>
        <section class="sp-block sp-left"><h3>Not placed
            <span class="sp-count">${this.run.unplaced.length}</span></h3>
          ${this.run.unplaced.length
            ? this.run.unplaced.map(r => '<div class="sp-pair sp-grey"><span>' + SAFE(r.name)
                + "</span><b>" + M2(r.area) + " m²</b></div>").join("")
              + '<p class="sp-small">Standing on the ground beside the building, in grey. '
              + "They are still in the brief and still in these numbers - make the envelope "
              + "bigger, or the storey taller, and they go in where they stand."
            : '<p class="sp-small">Everything in the brief went in.</p>'}
        </section>
      </div>`;
    this.say(this.run.placed.length + " placed · " + this.run.unplaced.length + " outstanding · "
      + bands.length + (bands.length === 1 ? " storey" : " storeys") + " · " + this.run.ms + " ms"
      + (this.run.quick ? " · rough, while the model is moving" : "")
      + (this.stale ? " · the envelope has moved" : ""));
  },

  /* ------------------------------------------------------------- the mode */

  enter() {
    this.on = true;
    this.bar.hidden = false;
    this.panel.hidden = false;
    this.group.visible = true;
    document.body.classList.add("packing");
    this.kit.setModelVisible(false);
    this.fillEnvelopes();
    if (this.run) this.reflowNow(); else this.repack(true);
    this.overView();
  },

  //! Everything this mode drew, in frame - which is the building AND the rows
  //! of grey boxes standing beside it. Framing the envelope alone would put
  //! the backlog off the side of the screen, and the backlog is half of what
  //! there is to look at.
  overView() {
    if (!this.group.children.length) return;
    const box = new this.kit.THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const middle = box.getCenter(new this.kit.THREE.Vector3());
    const size = box.getSize(new this.kit.THREE.Vector3());
    this.kit.frameOn([middle.x, middle.y, middle.z],
                     Math.max(size.x, size.y, size.z) * 0.62);
  },

  leave() {
    this.on = false;
    if (this.queued) { cancelAnimationFrame(this.queued); this.queued = 0; }
    this.bar.hidden = true;
    this.panel.hidden = true;
    this.group.visible = false;
    document.body.classList.remove("packing");
    this.kit.setModelVisible(true);
    this.kit.draw();
  },

  //! The model changed, and this is the whole reason it is in a parametric
  //! modeller rather than in a spreadsheet.
  //!
  //! The study is NOT thrown away. The storeys are cut again from the new
  //! triangles and the packing runs again - keeping every room that is still
  //! valid exactly where it was, trying the backlog first in whatever space
  //! has appeared, and sending back to the ground anything the envelope no
  //! longer covers. Watching a room that would not fit slide up off the grass
  //! into the building as you pull the roof higher is the thing this is for.
  //!
  //! On Wait, it only says the envelope has moved and lights the button: a
  //! re-pack of a large brief is not free, and somebody dragging a face
  //! through twenty frames should not pay for twenty of them unless they
  //! asked to see it live.
  invalidate() {
    if (!this.on) { this.stale = true; return; }
    this.fillEnvelopes();
    if (this.auto) { this.reflowNow(true); return; }
    this.stale = true;
    const again = this.bar.querySelector("#sp-rerun");
    again.hidden = false;
    again.classList.add("waiting");
    if (this.run) this.report();
  },

  dispose() {
    clearTimeout(this.settling);
    this.leave();
    this.bar.remove();
    this.panel.remove();
    this.kit.world.remove(this.group);
  },
};

const spPair = (label, value) =>
  '<div class="sp-pair"><span>' + SAFE(label) + "</span><b>" + SAFE(value) + "</b></div>";

/* ------------------------------------------------------- the declaration */

export const PACKING = offerPlugin({
  id: "packing",
  name: "Space Packing",
  version: 1,
  summary: "Does the brief go in the envelope? Cuts a massing into storeys, insets each "
         + "floor plate for headroom, and packs a schedule of accommodation into what is "
         + "left - live, so pulling a face re-packs the building. What does not fit "
         + "stands on the ground beside it in grey rather than disappearing.",

  nodes: PACKING_NODES,

  api: {
    name: "PackingFactory",
    summary: "Geometry on the envelope's own triangles: volume, the horizontal section at "
           + "any height, the area of a floor plate, whether a rectangle is inside one. "
           + "All exact to the tessellation. WHERE the rooms go is a heuristic - packing "
           + "rectangles into a polygon is NP-hard - and three are offered rather than "
           + "one answer. Nothing here is a code check.",
    operations: [
      { name: "meshVolume", takes: "mesh", gives: "volume",
        summary: "How much space is inside a closed envelope, by the divergence theorem." },
      { name: "sectionAt", takes: "mesh, z", gives: "rings",
        summary: "The horizontal section at a height: the outline of the floor plate "
               + "there and the outlines of its holes. A lightwell comes out as a ring "
               + "inside a ring and is a hole for that reason alone." },
      { name: "bandsOf", takes: "mesh, { storey, minHeadroom }", gives: "storeys",
        summary: "The envelope cut into floors, each carrying its plate and the part of "
               + "that plate you can stand up in - which is where the section at your "
               + "feet and the section at your head both say there is room." },
      { name: "packAll", takes: "bands, brief, options", gives: "{ placed, unplaced }",
        summary: "The brief laid into the storeys, highest priority and biggest first, "
               + "lower floors before higher. What does not fit comes back in a list "
               + "rather than being dropped." },
      { name: "reflow", takes: "before, bands, options", gives: "{ placed, unplaced, moved }",
        summary: "Pack again after the envelope moved, keeping every room that is still "
               + "valid where it was. The backlog is tried first, because the usual "
               + "reason for making it bigger is that something did not fit." },
      { name: "sampleBrief", takes: "mesh, { seed }", gives: "brief",
        summary: "A scatter of rooms sized against the plate, so the packing can be seen "
               + "working on a shape somebody has just pulled without them first writing "
               + "a schedule. Seeded, so the same demo comes back." },
      { name: "parkOf", takes: "bounds, rooms", gives: "places",
        summary: "Where the rooms that did not fit stand: on the ground, off the side of "
               + "the footprint, in rows." },
    ],
  },

  view: { key: "packing", label: "Packing", title: "Fit a brief into a massing envelope" },

  resources: [],

  //! Built wherever the modelling is - see the same note on the Climate
  //! package.
  drivers: packingDrivers,

  async start(kit) {
    const view = kit.THREE ? PackingView(kit) : null;
    return {
      view,
      dispose: () => { if (view) view.dispose(); },
    };
  },
});
