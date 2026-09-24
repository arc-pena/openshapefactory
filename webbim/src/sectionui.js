//! The section picker: standard, family, size - searchable - loading the pick as a type.

import { h, dialog } from "./ui_util.js";
import { SECTION_CATALOGUE } from "./sections.js";
import { sectionRows, sectionLabel, sectionType } from "./sectionlib.js";

/** Open the picker for a beam or column type key; `done(typeId)` gets the loaded type. */
export function sectionPicker(app, category, done) {
  const rows = sectionRows(), remembered = app.sectionPick || {};
  const stdSel = h("select", { "aria-label": "Standard" }, SECTION_CATALOGUE.map(s => h("option", { value: s.std, selected: s.std === remembered.std }, s.std)));
  const famSel = h("select", { "aria-label": "Family" });
  const find = h("input", { type: "search", placeholder: "search, e.g. W14 or 310UC or 200x100", "aria-label": "Search sections", style: { flex: "1" } });
  const list = h("select", { size: 14, "aria-label": "Sections", style: { width: "100%", fontFamily: "var(--mono, monospace)", fontSize: "12px" } });
  const note = h("div", { class: "muted", style: { fontSize: "11.5px", minHeight: "2.4em" } });
  const fams = () => { const s = SECTION_CATALOGUE.find(x => x.std === stdSel.value); famSel.replaceChildren(h("option", { value: "" }, "All families"), ...s.families.map(f => h("option", { value: f.name, selected: f.name === remembered.family }, `${f.name} (${f.items.length})`))); };
  const fill = () => {
    const q = find.value.trim().toLowerCase().replace(/\s+/g, "");
    const shown = rows.filter(r => (q ? true : r.std === stdSel.value) && (q || !famSel.value || r.family === famSel.value) && (!q || r.name.toLowerCase().replace(/\s+/g, "").includes(q) || (r.std === stdSel.value && r.family.toLowerCase().includes(q))));
    list.replaceChildren(...shown.slice(0, 800).map((r, i) => h("option", { value: String(rows.indexOf(r)), selected: i === 0 }, `${r.name.padEnd(22)} ${sectionLabel(r)}${q ? "   · " + r.std : ""}`)));
    const s = SECTION_CATALOGUE.find(x => x.std === stdSel.value);
    note.textContent = `${shown.length} section${shown.length === 1 ? "" : "s"}${shown.length > 800 ? " (first 800 shown - search to narrow)" : ""}. Source: ${s.source}.`;
  };
  stdSel.onchange = () => { fams(); fill(); }; famSel.onchange = fill; find.oninput = fill;
  fams(); fill();
  const load = () => {
    const r = rows[Number(list.value)]; if (!r) return false;
    const T = sectionType(r, category);
    if (!app.doc.lib.types[T.id]) { const res = app.apply({ op: "type", lib: "types", id: T.id, value: T.value }); if (!res.ok) { app.say(res.error, "error"); return false; } }
    app.sectionPick = { std: r.std, family: r.family };
    done(T.id, r);
    app.say(`${T.value.name} loaded${r.check ? " - Australian sizes are typed from the catalogue: check before relying on a dimension" : ""}`, r.check ? "note" : "ok");
  };
  list.ondblclick = () => { if (load() !== false) d.close(); };
  const d = dialog(`Load ${category === "IfcColumn" ? "column" : "beam"} section`, h("div", { style: { display: "grid", gap: "8px", width: "min(640px, 86vw)" } },
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, stdSel, famSel, find), list, note), [{ label: "Cancel", run: () => {} }, { label: "Load", primary: true, run: load }]);
  return d;
}
