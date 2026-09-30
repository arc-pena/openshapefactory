//! The Prompt panel: the architect's feedback to Claude, written where the work is. Words, images
//! (dropped anywhere on the window, pasted, or captured from the view on screen) and the context they
//! are about (the view or sheet open, what is selected) go into the project file's prompt log
//! (prompts.js); the history is a tree - a topic, its replies and follow-ups - that the next session,
//! Claude's or the architect's, continues. "Copy for Claude" writes the open threads out to paste.

import { h, clear, store } from "./ui_util.js";
import { promptLog, addPrompt, setPromptStatus, removePrompt, promptTree, promptBrief } from "./prompts.js";

const PP_MAX = 1600;   // an image's longest side as kept in the file: legible markup, a few hundred kB at most

/** An image file (or a data URL) as the log keeps it: downscaled, JPEG unless it is small, with its size. */
export function promptImage(src, name) {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src), img = new Image();
    img.onload = () => {
      const k = Math.min(1, PP_MAX / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), hh = Math.round(img.naturalHeight * k);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = hh; const g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, hh); g.drawImage(img, 0, 0, w, hh);
      const png = cv.toDataURL("image/png"), jpg = cv.toDataURL("image/jpeg", 0.85), data = png.length < 200000 ? png : jpg;
      if (typeof src !== "string") URL.revokeObjectURL(url);
      resolve({ name: name || (src.name || "image"), type: data.slice(5, data.indexOf(";")), w, h: hh, data });
    };
    img.onerror = () => reject(new Error(`${name || "the file"} is not an image this browser can read`));
    img.src = url;
  });
}

export function installPromptPanel(app) {
  const st = { open: !!store("prompts-open"), width: store("prompts-width") || 380, draft: "", images: [], replyTo: null, filter: "all", folded: new Set() };
  const panel = h("aside", { class: "promptpanel", role: "complementary", "aria-label": "Prompts to Claude" });
  const tab = h("button", { class: "prompttab", title: "Prompts to Claude (feedback on this project)", onclick: () => toggle(true) });
  const css = h("style", {}, `
.promptpanel{position:fixed;right:0;top:calc(var(--qat-h) + var(--rtab-h) + var(--rpanel-h) + 4px);bottom:calc(var(--status-h) + 2px);z-index:40;background:var(--panel);color:var(--ink);border-left:1px solid var(--rule);box-shadow:var(--shadow);display:none;grid-template-rows:auto auto 1fr;font-size:12.5px;min-width:280px;max-width:70vw}
.promptpanel.open{display:grid}
.promptpanel header{display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--chrome);border-bottom:1px solid var(--rule)}
.promptpanel header b{flex:1}
.promptpanel .pp-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:ew-resize}
.promptpanel .pp-compose{padding:8px;border-bottom:1px solid var(--rule);display:grid;gap:6px}
.promptpanel textarea{width:100%;min-height:74px;resize:vertical;box-sizing:border-box;font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--rule);padding:6px}
.promptpanel .pp-drop{border:1.5px dashed var(--rule);border-radius:4px;padding:8px;text-align:center;color:var(--ink-3)}
.promptpanel .pp-drop.over,.pp-dropall{border-color:var(--accent);background:var(--accent-2);color:var(--ink)}
.promptpanel .pp-thumbs{display:flex;flex-wrap:wrap;gap:6px}
.promptpanel .pp-thumb{position:relative;width:72px;height:54px;border:1px solid var(--rule);background:#fff center/contain no-repeat;cursor:zoom-in}
.promptpanel .pp-thumb button{position:absolute;right:1px;top:1px;padding:0 4px;line-height:14px}
.promptpanel .pp-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.promptpanel .pp-ctx{color:var(--ink-3);font-size:11.5px}
.promptpanel .pp-list{overflow:auto;padding:6px 8px 12px}
.promptpanel .pp-node{border-left:2px solid var(--rule-2);padding:4px 0 2px 8px;margin:4px 0}
.promptpanel .pp-node.claude{border-left-color:var(--accent)}
.promptpanel .pp-node.open>.pp-head .pp-st{background:var(--note-bg);color:var(--note)}
.promptpanel .pp-node.answered>.pp-head .pp-st{background:var(--accent-2);color:var(--accent)}
.promptpanel .pp-node.done>.pp-head .pp-st{background:var(--ok-bg);color:var(--ok)}
.promptpanel .pp-head{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.promptpanel .pp-st{border-radius:8px;padding:0 6px;font-size:11px}
.promptpanel .pp-text{white-space:pre-wrap;margin:2px 0 4px}
.promptpanel .pp-kids{margin-left:6px}
.promptpanel .linkish{background:none;border:0;padding:0;color:var(--accent);cursor:pointer;font:inherit;font-size:11.5px}
.prompttab{position:fixed;right:0;top:45%;z-index:39;writing-mode:vertical-rl;transform:rotate(180deg);padding:10px 4px;border:1px solid var(--rule);border-right:0;background:var(--panel);color:var(--ink);border-radius:0 4px 4px 0;cursor:pointer;font-size:12px}
.prompttab .n{display:inline-block;margin-top:6px;background:var(--note-bg);color:var(--note);border-radius:8px;padding:4px 2px}
.pp-dropall{position:fixed;inset:12px;z-index:80;border:3px dashed;border-radius:10px;display:grid;place-items:center;font-size:18px;pointer-events:none}`);
  document.head.append(css); document.body.append(panel, tab);

  function toggle(open) { st.open = open; store("prompts-open", open); render(); }
  function save() { if (app.saveDraftSoon) app.saveDraftSoon(); if (app.markChanged) app.markChanged(); renderTab(); }
  function context() {
    const d = app.doc, v = d.element(app.activeView), ctx = {};
    if (v) { const t = d.typeOf(v); if (t === "Sheet") ctx.sheet = String(d.argValue(v, "number") || app.activeView); else ctx.view = app.activeView; ctx.viewName = String(v.get("Name") || app.activeView); }
    const sel = [...app.selection].filter(id => !id.includes(":")); if (sel.length) ctx.selection = sel.slice(0, 50);
    return ctx;
  }
  async function attach(files) {
    for (const f of files) { if (!f.type || !f.type.startsWith("image/")) { app.say(`${f.name}: only images can be attached`, "note"); continue; }
      try { st.images.push(await promptImage(f, f.name)); } catch (e) { app.say(e.message, "error"); } }
    toggle(true);
  }
  /** The view on screen, as an image: its canvas (2D or 3D), or nothing if the view does not draw to one. */
  function capture() {
    const cvs = [...document.querySelectorAll("#main canvas")].filter(c => c.width > 50 && c.height > 50).sort((a, b) => b.width * b.height - a.width * a.height);
    if (!cvs.length) { app.say("this view has nothing to capture (it is not drawn on a canvas)", "note"); return; }
    try { const data = cvs[0].toDataURL("image/png"); promptImage(data, `${context().viewName || "view"}.png`).then(im => { st.images.push(im); render(); }); }
    catch (e) { app.say("the view could not be captured: " + e.message, "error"); }
  }
  function send() {
    const text = st.draft.trim(); if (!text && !st.images.length) { app.say("write something or attach an image first", "note"); return; }
    try { const e = addPrompt(app.doc, { text, images: st.images.slice(), context: context(), parent: st.replyTo, author: "architect" });
      st.draft = ""; st.images = []; st.replyTo = null; save(); render(); app.say(`${e.id} saved in the project file`, "ok"); }
    catch (err) { app.say(err.message, "error"); }
  }
  function viewImage(im) {
    const back = h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 90, display: "grid", placeItems: "center", cursor: "zoom-out" }, onclick: () => back.remove() },
      h("img", { src: im.data, alt: im.name, style: { maxWidth: "94vw", maxHeight: "94vh", background: "#fff" } }));
    document.body.append(back);
  }
  const thumb = (im, onRemove) => h("div", { class: "pp-thumb", title: `${im.name} (${im.w}×${im.h})`, style: { backgroundImage: `url(${im.data})` }, onclick: () => viewImage(im) },
    onRemove ? h("button", { class: "btn small", "aria-label": `Remove ${im.name}`, onclick: e => { e.stopPropagation(); onRemove(); } }, "✕") : null);

  function renderTab() {
    if (!app.doc) { tab.style.display = "none"; return; }
    const n = promptLog(app.doc).entries.filter(e => e.status === "open").length;
    clear(tab).append("Prompts", n ? h("span", { class: "n" }, String(n)) : null);
    tab.style.display = st.open ? "none" : "";
  }
  function render() {
    renderTab(); if (!app.doc) return; panel.classList.toggle("open", st.open); panel.style.width = st.width + "px"; clear(panel);
    if (!st.open) return;
    const grip = h("div", { class: "pp-grip", onpointerdown: e => { e.target.setPointerCapture(e.pointerId); const mv = ev => { st.width = Math.max(280, Math.min(window.innerWidth * 0.7, window.innerWidth - ev.clientX)); panel.style.width = st.width + "px"; };
      e.target.addEventListener("pointermove", mv); e.target.addEventListener("pointerup", () => { e.target.removeEventListener("pointermove", mv); store("prompts-width", st.width); }, { once: true }); } });
    const header = h("header", {}, h("b", {}, "Prompts to Claude"),
      h("button", { class: "btn small", title: "Copy the open threads as text to paste into a conversation with Claude", onclick: () => copyBrief(false) }, "Copy for Claude"),
      h("button", { class: "btn small", "aria-label": "Close the prompt panel", onclick: () => toggle(false) }, "✕"));
    // the composer
    const ctx = context(), ta = h("textarea", { placeholder: st.replyTo ? `Reply to ${st.replyTo}…` : "Describe the change, the detail, the markup… (Ctrl+Enter saves)", "aria-label": "Prompt text",
      oninput: e => { st.draft = e.target.value; }, onkeydown: e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } e.stopPropagation(); },
      onpaste: e => { const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => f.type.startsWith("image/")); if (fs.length) { e.preventDefault(); attach(fs); } } });
    ta.value = st.draft;
    const file = h("input", { type: "file", accept: "image/*", multiple: true, style: { display: "none" }, onchange: e => attach([...e.target.files]) });
    const drop = h("div", { class: "pp-drop", ondragover: e => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"),
      ondrop: e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("over"); attach([...e.dataTransfer.files]); } },
      "Drop sketches, markups or photos here, paste them, or ", h("button", { class: "linkish", onclick: () => file.click() }, "choose files"), file);
    const compose = h("div", { class: "pp-compose" },
      st.replyTo ? h("div", { class: "pp-row" }, `Replying to ${st.replyTo}`, h("button", { class: "linkish", onclick: () => { st.replyTo = null; render(); } }, "cancel")) : null,
      ta, drop,
      st.images.length ? h("div", { class: "pp-thumbs" }, st.images.map((im, i) => thumb(im, () => { st.images.splice(i, 1); render(); }))) : null,
      h("div", { class: "pp-ctx" }, "About: ", [ctx.sheet && `sheet ${ctx.sheet}`, ctx.view && (ctx.viewName || ctx.view), ctx.selection && `${ctx.selection.length} selected`].filter(Boolean).join(" · ") || "the project"),
      h("div", { class: "pp-row" }, h("button", { class: "btn small", title: "Attach an image of the view on screen", onclick: capture }, "Capture view"),
        h("span", { style: { flex: 1 } }), h("button", { class: "btn primary small", onclick: send }, st.replyTo ? "Reply" : "Save prompt")));
    // the history, as a tree
    const filters = h("div", { class: "pp-row", style: { padding: "0 8px" } }, ["all", "open", "answered", "done"].map(f => h("button", { class: "linkish", style: { fontWeight: st.filter === f ? 700 : 400 }, onclick: () => { st.filter = f; render(); } }, f)));
    const list = h("div", { class: "pp-list" });
    const tree = promptTree(app.doc), keep = n => st.filter === "all" || n.entry.status === st.filter || n.replies.some(keep);
    const node = n => { const e = n.entry, c = e.context || {}, folded = st.folded.has(e.id);
      return h("div", { class: `pp-node ${e.author} ${e.status}` },
        h("div", { class: "pp-head" },
          n.replies.length ? h("button", { class: "linkish", "aria-label": folded ? "Unfold" : "Fold", onclick: () => { folded ? st.folded.delete(e.id) : st.folded.add(e.id); render(); } }, folded ? "▸" : "▾") : null,
          h("b", {}, e.id), h("span", {}, e.author === "claude" ? "Claude" : "Architect"), h("span", { class: "pp-st" }, e.status),
          h("span", { class: "pp-ctx" }, e.at.slice(0, 16).replace("T", " "))),
        (c.view || c.sheet) ? h("div", { class: "pp-ctx" }, h("button", { class: "linkish", title: "Open the view this was written about", onclick: () => openCtx(c) }, c.sheet ? `sheet ${c.sheet}` : c.viewName || c.view),
          c.selection ? ` · ${c.selection.length} selected` : "") : null,
        e.text ? h("div", { class: "pp-text" }, e.text) : null,
        e.images ? h("div", { class: "pp-thumbs" }, e.images.map(im => thumb(im))) : null,
        h("div", { class: "pp-row" },
          h("button", { class: "linkish", onclick: () => { st.replyTo = e.id; render(); ta.focus(); } }, "Reply"),
          e.status !== "done" ? h("button", { class: "linkish", onclick: () => { setPromptStatus(app.doc, e.id, "done"); save(); render(); } }, "Mark done")
            : h("button", { class: "linkish", onclick: () => { setPromptStatus(app.doc, e.id, "open"); save(); render(); } }, "Reopen"),
          h("button", { class: "linkish", onclick: () => { if (confirm(`Delete ${e.id}${n.replies.length ? " and its replies" : ""}?`)) { removePrompt(app.doc, e.id); save(); render(); } } }, "Delete")),
        n.replies.length && !folded ? h("div", { class: "pp-kids" }, n.replies.map(node)) : null); };
    const shown = tree.filter(keep);
    list.append(...(shown.length ? shown.map(node) : [h("div", { class: "pp-ctx" }, tree.length ? "Nothing here with that status." : "No prompts yet. They are saved in the project file, so the next session with Claude carries on from them.")]));
    panel.append(grip, header, compose, h("div", { style: { display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 } }, filters, list));
  }
  function openCtx(c) {
    const d = app.doc; let id = c.view;
    if (c.sheet) { const sh = d.elements().find(f => d.typeOf(f) === "Sheet" && String(d.argValue(f, "number")) === c.sheet); if (sh) id = d.idOf(sh); }
    if (id && d.element(id)) { app.openView(id); if (c.selection) app.select(c.selection.filter(x => d.element(x))); } else app.say("that view is no longer in the project", "note");
  }
  async function copyBrief(all) {
    const text = promptBrief(app.doc, { all });
    try { await navigator.clipboard.writeText(text); app.say("the open prompts are on the clipboard", "ok"); }
    catch (e) { const t = h("textarea", { style: { width: "100%", height: "50vh" } }); t.value = text; const back = h("div", { style: { position: "fixed", inset: "10vh 20vw", zIndex: 90, background: "var(--panel)", padding: "10px", boxShadow: "var(--shadow)" } }, t, h("button", { class: "btn", onclick: () => back.remove() }, "Close")); document.body.append(back); t.select(); }
  }
  // images dropped anywhere on the window go to the panel
  let over = null;
  window.addEventListener("dragover", e => { if (![...(e.dataTransfer && e.dataTransfer.items || [])].some(i => i.kind === "file" && i.type.startsWith("image/"))) return; e.preventDefault();
    if (!over) { over = h("div", { class: "pp-dropall" }, "Drop images to attach them to a prompt"); document.body.append(over); } });
  const end = () => { if (over) { over.remove(); over = null; } };
  window.addEventListener("dragleave", e => { if (!e.relatedTarget) end(); });
  window.addEventListener("drop", e => { const fs = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => f.type.startsWith("image/")); end(); if (!fs.length) return; e.preventDefault(); attach(fs); });
  app.promptPanel = { render, toggle, attach };
  render();
  return app.promptPanel;
}
