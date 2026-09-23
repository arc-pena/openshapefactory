// The same kernel, over a message port.
//
// This is the page's side of kernel-worker.js: an object with the kernel's own
// methods on it, each of which posts a message and returns a promise. Nothing
// above it can tell the difference - which is the whole point, and is only
// true because the interface already had to work against a kernel over HTTP.
//
// WHAT IT BUYS is the one thing an interface cannot do without: the page keeps
// its thread. A boolean that takes ten seconds takes ten seconds either way,
// but with the work over here the spinner turns, the tree scrolls, the model
// you already have can be looked at from another angle, and the cancel button
// is a button rather than a picture of one.
//
// WHAT IT COSTS is a copy of every answer. Structured clone is a copy, and a
// batch of four hundred meshed shapes is about a megabyte of it - under ten
// milliseconds, against the three or four hundred the meshing itself takes.
// The WebAssembly is handed over rather than copied, because 22 MB is worth
// the one line it takes to transfer it.

import { resource } from "./payload.js";

//! Where the worker's own code comes from, which is the one place the two
//! builds differ. Served, it is a module beside the page and the browser
//! resolves its imports itself. Inside the single file there is nothing beside
//! the page, so the whole kernel half of the program travels packed in the
//! document and is handed to the worker as a blob.
async function workerSource(url, elementId) {
  const packed = elementId ? document.getElementById(elementId) : null;
  if (!packed) return url;
  const text = await (await resource(elementId, null, "the modeller's worker")).text();
  return URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
}

//! Starts the worker and hands back something shaped like a kernel.
//!
//! \p onProgress hears the boot messages, \p wasmBinary is the WebAssembly the
//! page has already unpacked - handed over rather than fetched twice.
export async function createWorkerKernel({ url, elementId, wasmBinary, onProgress }) {
  if (typeof Worker !== "function") throw new Error("this browser has no workers");
  //! A MODULE WORKER EITHER WAY, blob or file. The packed bundle has had its
  //! imports stripped and has nothing left to import - but `import.meta` is
  //! still in it, because that is how emscripten's glue finds itself, and
  //! `import.meta` outside a module is a syntax error rather than a warning.
  //! Started as a classic worker the whole thing failed to parse, the page
  //! quietly fell back to modelling on its own thread, and the only sign of it
  //! was one line in the console.
  const worker = new Worker(await workerSource(url, elementId), { type: "module" });

  const waiting = new Map();
  let nextId = 1;
  //! Set by the page, called from here. Not a method the worker can see: a
  //! function does not survive a postMessage, so the progress comes back as
  //! messages and is turned into a call on this side.
  const link = { onBuild: null };

  worker.onmessage = event => {
    const { id, ok, value, error, progress, build } = event.data || {};
    if (progress !== undefined) { if (onProgress) onProgress(progress); return; }
    if (build !== undefined) { if (link.onBuild) link.onBuild(build); return; }
    const answer = waiting.get(id);
    if (!answer) return;
    waiting.delete(id);
    if (ok) answer.resolve(value); else answer.reject(new Error(error || "it failed"));
  };
  //! A WORKER THAT DIES TAKES EVERY CALL WITH IT. Left alone, each of those
  //! promises hangs for the life of the page and every one of them is a piece
  //! of interface that never comes back - so they are all told, once.
  worker.onerror = event => {
    const why = new Error((event && event.message) || "the modeller stopped");
    for (const [, answer] of waiting) answer.reject(why);
    waiting.clear();
    link.broken = why;
  };

  const call = (name, args) => new Promise((resolve, reject) => {
    if (link.broken) { reject(link.broken); return; }
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, call: name, args });
  });

  const started = await new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    //! Transferred, not copied: the page has already spent the memory on
    //! twenty-two megabytes of WebAssembly and there is no reason to spend it
    //! twice. The page's own copy is emptied by this, which is why nothing on
    //! that side may touch it afterwards.
    worker.postMessage({ id, call: "start", args: [{ wasmBinary }] },
                       wasmBinary ? [wasmBinary] : []);
  });

  const kernel = { ...started.values, worker, get onBuild() { return link.onBuild; },
                   set onBuild(fn) { link.onBuild = fn; },
                   //! So a page that has to fall back knows what it is losing.
                   inWorker: true,
                   stop() { worker.terminate(); } };
  for (const name of started.calls) kernel[name] = (...args) => call(name, args);
  return kernel;
}
