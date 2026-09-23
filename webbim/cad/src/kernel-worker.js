// The modelling, off the thread the interface is drawn on.
//
// Everything that makes geometry runs here. A boolean between two buildings is
// ten seconds of solid C++ compiled to WebAssembly, and for as long as that ran
// on the page's own thread nothing else could happen on it: not a scroll, not a
// hover, not the spinner that was there to say the program had not died. The
// one honest fix is the one every other program made years ago - put the work
// somewhere else and let the window keep drawing - and a worker is where else.
//
// WHAT MAKES IT POSSIBLE HERE is that the kernel was already written as if it
// were somewhere else. Every call into it returns a promise and every argument
// and answer is plain data, because the same interface has always had to work
// against a kernel over HTTP as well as the one in the page. So this file adds
// no new idea: it takes the calls off a message port instead of off a function
// table, and sends the answers back the same way.
//
//   main thread                     worker
//   ---------------------------------------------------------------
//   post {id, call, args}    ->     kernel[call](...args)
//                            <-     post {id, ok, value}
//                            <-     post {progress}   while it starts
//                            <-     post {build}      while it builds
//
// There is no shared memory and nothing is transferred but the WebAssembly
// itself. Answers are structured-cloned, which copies the triangles - about a
// megabyte for a batch of four hundred shapes, and measured at under ten
// milliseconds, which is the price of the page staying alive for the twelve
// seconds the build takes.

import replicadInit from "./occt-glue.js";
import { createWasmKernel } from "./wasm-kernel.js";
import { registerTypes, unregisterTypes } from "./ocaf.js";
import { CLIMATE } from "./climate-plugin.js";
import { CROWD } from "./crowd-plugin.js";
import { DRAWINGS } from "./drawings-plugin.js";
import { IFC } from "./ifc-plugin.js";
import { PACKING } from "./packing-plugin.js";

let kernel = null;

/* --------------------------------------------------- packages, on this side

   A PACKAGE THAT BRINGS NODES BRINGS DRIVERS, and a driver is a closure over
   the kernel: it reads its arguments off the labels and calls the factories.
   A closure cannot be sent down a message port, so a package whose nodes build
   geometry has to be switched on HERE, where the geometry is.

   The page still loads its own half - the mode, the panel, the file reader -
   and the two halves agree because they are the same declaration, read from
   the same file, on both sides. What crosses the port is the package's NAME.  */

//! Keyed by the package's OWN id rather than by a name written here. Written
//! here, one of them was wrong - the Flow package is declared as "flow" and
//! this said "crowd" - and what that looks like from the outside is a package
//! that will not load with no reason given.
const SHELF = {};
for (const plugin of [CLIMATE, CROWD, DRAWINGS, IFC, PACKING]) SHELF[plugin.id] = plugin;

//! What a driver builder is handed here: the factories and the document, and
//! nothing that belongs to a window. `kit.THREE` is undefined on purpose - a
//! package asks for it before making a view, so asking for one in here
//! answers "no" rather than throwing.
const workerKit = { toolkit: () => kernel.toolkit() };

function usePackage(id) {
  const plugin = SHELF[id];
  if (!plugin) throw new Error("there is no package called '" + id + "'");
  if (!plugin.nodes || !plugin.nodes.length) return { nodes: 0 };
  registerTypes(plugin.nodes, "the " + plugin.name + " package");
  kernel.installDrivers(plugin.nodes,
    typeof plugin.drivers === "function" ? plugin.drivers(workerKit) : {});
  return { nodes: plugin.nodes.length };
}

function dropPackage(id) {
  const plugin = SHELF[id];
  if (!plugin || !plugin.nodes || !plugin.nodes.length) return { nodes: 0 };
  kernel.removeDrivers(plugin.nodes);
  unregisterTypes(plugin.nodes);
  return { nodes: plugin.nodes.length };
}

const post = message => self.postMessage(message);

//! The kernel's own methods, asked of it rather than listed here - a method
//! added to the kernel is a method the page can call, with nothing to keep in
//! step. Properties travel with them, because `kind` and `description` are
//! part of the same interface and the page reads both.
function surface() {
  //! The two this file answers itself, so the page can call them like any
  //! other and nothing above has to know which side they land on.
  const calls = ["usePackage", "dropPackage"];
  const values = {};
  for (const key of Object.keys(kernel)) {
    if (typeof kernel[key] === "function") calls.push(key);
    else if (key !== "onBuild") values[key] = kernel[key];
  }
  return { calls, values };
}

async function start(options = {}) {
  if (kernel) return surface();
  kernel = await createWasmKernel({
    initModule: replicadInit,
    wasmBinary: options.wasmBinary,
    //! Named so the glue does not go looking - see the note where this is
    //! read. Nothing is ever fetched from it: the bytes came over the port.
    locateFile: name => name,
    onProgress: text => post({ progress: text }),
  });
  //! The build reports itself the same way it does in the page: the panel that
  //! says "4,234 of 6,010 features" is reading this, one message a slice.
  if ("onBuild" in kernel) kernel.onBuild = step => post({ build: step });
  return surface();
}

self.onmessage = async event => {
  const { id, call, args } = event.data || {};
  if (!call) return;
  try {
    if (call === "start") { post({ id, ok: true, value: await start(args && args[0]) }); return; }
    if (!kernel) throw new Error("the modeller has not started yet");
    if (call === "usePackage") { post({ id, ok: true, value: usePackage(args[0]) }); return; }
    if (call === "dropPackage") { post({ id, ok: true, value: dropPackage(args[0]) }); return; }
    const method = kernel[call];
    if (typeof method !== "function") throw new Error("no such call: " + call);
    post({ id, ok: true, value: await method.apply(kernel, args || []) });
  } catch (err) {
    //! AN ERROR IS AN ANSWER, not a silence. A call that throws in here and
    //! says nothing leaves a promise on the page that never settles, and what
    //! that looks like is the thing this whole file exists to prevent.
    post({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
