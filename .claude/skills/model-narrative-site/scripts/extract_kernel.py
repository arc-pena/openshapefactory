#!/usr/bin/env python3
"""Copy the OpenCascade kernel out of a Feature Modeller single-file build.

The modeller carries two gzip+base64 payloads in <script type="application/octet-stream">
elements: "kernel-payload" (replicad_single.wasm, ~22 MB raw / ~7 MB gz) and
"worker-payload" (the OCAF document, drivers and emscripten glue as one module
worker, ~1.7 MB raw). They are written out byte for byte, still gzipped, which
is what kernel.js expects.

    python3 extract_kernel.py <feature-modeller.html> <out-dir>

Get the HTML with the Artifact tool: action "read" on the modeller's URL saves
the full page to a local file and prints its path.
"""
import base64
import re
import sys
from pathlib import Path

PAYLOADS = {
    "kernel-payload": "replicad_single.wasm.gz",
    "worker-payload": "kernel-worker.js.gz",
}


def main(src: str, out: str) -> None:
    html = Path(src).read_text(encoding="utf-8", errors="replace")
    target = Path(out)
    target.mkdir(parents=True, exist_ok=True)
    for element, name in PAYLOADS.items():
        m = re.search(r'id="%s">([^<]*)<' % re.escape(element), html)
        if not m:
            sys.exit(f"no {element} element in {src} - is this the single-file Feature Modeller build?")
        data = base64.b64decode(m.group(1).strip())
        if data[:2] != b"\x1f\x8b":
            sys.exit(f"{element} is not gzip - the payload format has changed; inspect it before trusting it")
        (target / name).write_bytes(data)
        print(f"{name}: {len(data):,} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
