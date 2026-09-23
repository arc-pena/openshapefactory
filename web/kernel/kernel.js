// The Feature Modeller's kernel, started headless.
//
// kernel/replicad_single.wasm.gz and kernel/kernel-worker.js.gz are the two
// payloads the Feature Modeller artifact carries (its "kernel-payload" and
// "worker-payload" elements), copied out byte for byte. The worker is the same
// OCAF document + OpenCascade build the modeller runs; this file is its page
// side with none of the modeller's interface: start it, hand it a model, ask
// it for triangles.
(function (global) {
  "use strict";

  // Some hosts serve a .gz with Content-Encoding: gzip and the browser has
  // already unpacked it by the time it arrives, so look at the bytes rather
  // than trusting the file name.
  async function inflate(url, type) {
    const answer = await fetch(url);
    if (!answer.ok) throw new Error("could not load " + url + " (" + answer.status + ")");
    const bytes = new Uint8Array(await answer.arrayBuffer());
    const headers = type ? { headers: { "Content-Type": type } } : undefined;
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new Response(bytes, headers);
    if (typeof DecompressionStream !== "function")
      throw new Error("this browser cannot unpack the modeller (no DecompressionStream)");
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")), headers);
  }

  // Resolves to an object with the kernel's own calls on it (loadModel,
  // setParameter, mesh, ...), each returning a promise.
  async function startKernel({ base = "kernel/", onProgress, onBuild } = {}) {
    if (typeof Worker !== "function") throw new Error("this browser has no workers");
    const [wasm, source] = await Promise.all([
      inflate(base + "replicad_single.wasm.gz", "application/wasm").then(r => r.arrayBuffer()),
      inflate(base + "kernel-worker.js.gz", "text/javascript").then(r => r.text()),
    ]);
    // A module worker: the bundle keeps emscripten's `import.meta`, which is a
    // syntax error in a classic worker.
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
                              { type: "module" });
    const waiting = new Map();
    let nextId = 1, broken = null;
    worker.onmessage = event => {
      const { id, ok, value, error, progress, build } = event.data || {};
      if (progress !== undefined) { if (onProgress) onProgress(progress); return; }
      if (build !== undefined) { if (onBuild) onBuild(build); return; }
      const answer = waiting.get(id);
      if (!answer) return;
      waiting.delete(id);
      if (ok) answer.resolve(value); else answer.reject(new Error(error || "the modeller refused"));
    };
    worker.onerror = event => {
      broken = new Error((event && event.message) || "the modeller stopped");
      for (const [, answer] of waiting) answer.reject(broken);
      waiting.clear();
    };
    const call = (name, args, transfer) => new Promise((resolve, reject) => {
      if (broken) { reject(broken); return; }
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, call: name, args }, transfer || []);
    });
    const started = await call("start", [{ wasmBinary: wasm }], [wasm]);
    const kernel = { ...started.values, stop: () => worker.terminate() };
    for (const name of started.calls) kernel[name] = (...args) => call(name, args);
    return kernel;
  }

  global.startKernel = startKernel;
})(window);
