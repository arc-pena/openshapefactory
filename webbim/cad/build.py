#!/usr/bin/env python3
"""Build the page, both ways.

    docs/parametric-cad.html   ONE file, for publishing as an Artifact
    docs/index.html + app/     a folder of files, for serving from GitHub Pages

They exist for opposite reasons. An Artifact may load scripts from a handful of
CDNs but may not fetch anything at run time, and OpenCascade's WebAssembly
module is a runtime fetch - so for that build the kernel travels inside the
page, gzipped and base64'd, 22 MB of wasm becoming about 9 MB of text.

A web server has no such rule, and fetching is what a browser is good at. So
the site build leaves the kernel, the showroom engine and the package data as
files beside the page: streamed, compiled while they arrive, and cached by the
browser between visits instead of re-parsed out of the HTML on every load. The
source modules go across as they are, imported natively - nothing is
concatenated, so what is served is what is in src/.

One switch decides which, at run time, per resource: a payload element is in
the page or it is not. Nothing in src/ knows which build it is in.

    python3 docs/build.py [--wasm-dir DIR] [--only artifact|site]
"""
import argparse
import base64
import gzip
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "parametric-cad.html"

# The served site lives in docs/ - this folder - because that is one of the two
# places GitHub Pages will serve from when it serves straight from a branch, and
# the other is the repository root. So the page, the modules and the kernel sit
# beside the source they are built from.
#
# Only these are generated, and only these are wiped and rewritten. Everything
# else in docs/ is source and is never touched.
SITE = ROOT
SITE_INDEX = "index.html"
SITE_MODULES = "app"
SITE_BINARIES = "kernel"

# Pages will serve either of two folders and there is no way to ask which one
# somebody chose, so both are made to work. docs/ holds the site; the
# repository root gets a page that goes straight into it, and the file that
# stops Jekyll from rendering a README in place of a website.
TOP = ROOT.parent

# OpenCascade for the browser: a trimmed OCCT build, 22 MB of WebAssembly.
KERNEL_PACKAGE = "replicad-opencascadejs"

# The showroom renderer. Packed the same way and unpacked only when someone
# opens the showroom, so a session that never does never pays for it.
STAGE_PACKAGE = "playcanvas"
STAGE_FILE = "build/playcanvas.min.js"

# Concatenated in this order into one module script for the single-file build.
# The site build copies the same files and lets the browser resolve the imports,
# so this order is only the order they are stapled together in.
MODULES = ["payload.js", "sketch.js", "factory.js", "exchange.js", "dxf.js",
           # draft reads factory's vector arithmetic and nothing else; the
           # kernel reads draft.
           "draft.js",
           # sections is arithmetic over numbers - no kernel, no IFC - and both
           # the catalogue's Section node and the IFC reader stand on it.
           "sections.js",
           "ocaf.js", "polymesh.js", "subshape.js",
           # handle, gizmo and camera come before the kernel: the kernel's own
           # drivers read from them - a camera's frustum is the same arithmetic
           # the viewport looks through one with - and in the single file
           # everything shares one scope, so the order is the order.
           "handle.js", "gizmo.js", "camera.js", "gcc.js", "formula.js", "reuse.js",
           # generate reads reuse, and the kernel reads both.
           "generate.js",
           "wasm-kernel.js", "http-kernel.js", "mdl.js", "graph.js",
           "agent.js", "styles.js", "showroom.js", "plugin.js", "climate.js", "climate-plugin.js",
           "crowd.js", "crowd-plugin.js", "packing.js", "packing-plugin.js",
           # ifc reads sections and the model language and nothing else; its
           # package is the one hook that teaches the page an extension.
           "ifc.js", "ifc-plugin.js",
           "section.js",
           # drawings reads the section's pen tables and the sketch's layers,
           # so it comes after both; its package is where the projection is
           # asked for.
           "drawings.js", "drawings-plugin.js",
           "story.js", "pie.js", "meshedit.js",
           # The tour points at the interface and knows nothing else, so it
           # can go anywhere before the page that starts it.
           "tour.js",
           # The page's side of the worker: it has to be in the page, because
           # the page is what starts the worker and hands it the WebAssembly.
           "worker-kernel.js",
           "app.js"]

# The one module the page loads; everything else is reached through its imports.
ENTRY = "app.js"

# The worker's entry. NOT in MODULES and not in the page: it installs an
# onmessage handler the moment it is evaluated, and in a page `self` is the
# window - so concatenating it into the page script would quietly take over
# window.onmessage. It is copied into the site as a module of its own, and
# packed separately for the single file.
WORKER_ENTRY = "kernel-worker.js"

# The emscripten glue, copied beside the modules under this name. It is already
# a module - it ends in `export default Module` - so the site build needs to do
# nothing to it but put it where app.js says it is.
GLUE_MODULE = "occt-glue.js"
# Modules this script writes into the site rather than ones anybody wrote.
GENERATED = {GLUE_MODULE}

# A package's data rides the way the kernel and the showroom engine do: gzipped,
# base64'd, in a script element the HTML tokenizer scans straight past. Unpacked
# only when the package is loaded, so a session that never opens it never pays.
DATA = ROOT / "data"
PAYLOADS = [("climate-sites", "cities.json")]

# A sample kept as a model file rides the same way. These are models somebody
# BUILT in the program and saved, so they are data and not source: the folder
# is what GitHub Pages serves and what the single-file build packs, and the
# element id is "sample-" + the key SAMPLES gives it in src/ocaf.js. Keep the
# two in step - a sample listed there with no file here loads in the served
# build and not in the Artifact, which is the kind of difference that is only
# found by somebody else.
SAMPLES = [
    ("3dspline", "3dspline.json"),
    ("columns-on-a-curve", "Columns_on_a_curve.json"),
    ("fillsurface", "fillsurface.json"),
    ("fillsurface-extrude", "fillsurface_extrude.json"),
    ("fillsurface-draft", "fillsurface_draft.json"),
    ("wideflange", "wideflange.json"),
    ("polyline", "polyline.json"),
    ("parallelcurveseries", "parallelcurveseries.json"),
    ("sample-slab", "sample_slab_for_flow.json"),
    ("sample-cap", "Sample_Cap.json"),
    ("samplecap-one", "samplecap_onecaponly.json"),
]
PAYLOADS += [("sample-" + key, "samples/" + name) for key, name in SAMPLES]

# Listed and present, both ways round: a file in the folder that nobody lists
# never reaches the Artifact, and a listed file that is not there fails the
# build here rather than in somebody's browser.
_on_disk = {f.name for f in sorted((DATA / "samples").glob("*.json"))}
_listed = {name for _, name in SAMPLES}
if _on_disk != _listed:
    sys.exit("data/samples does not match SAMPLES in build.py: "
             + ", ".join(sorted(("unlisted " + n) for n in _on_disk - _listed)
                         + sorted(("missing " + n) for n in _listed - _on_disk)))

# An import may wrap across lines; nothing but the statement itself may
# contain a semicolon before its end.
IMPORT = re.compile(r"^\s*import\s[^;]*;\s*$", re.M)
EXPORT = re.compile(r"^export\s+(?=(?:const|let|var|class|function|async)\b)", re.M)
DECLARE = re.compile(r"^(?:export\s+)?(?:async\s+)?(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)", re.M)
# Where an import says it is coming from. Checked, because the single file
# STRIPS imports - so a path that is wrong is invisible in the artifact and a
# 404 before the first frame in the served build. That has happened once: a
# rename walked through `from "./section.js"` and made it `./cutter.js`, every
# test passed, and the served site was dead for three versions.
FROM = re.compile('from' + r'\s+["\']' + r'(\.[^"\']+)' + r'["\']')


def strip_modules(text):
    """Turn an ES module into plain statements for a shared scope."""
    return EXPORT.sub("", IMPORT.sub("", text))


def worker_modules():
    """The half of the program that can run without a window: everything the
    worker's entry reaches, in the order the single file staples things
    together. A subset of MODULES by construction - anything reached from here
    that the page does not carry would be a mistake on both sides - so the
    order is MODULES' order, filtered."""
    seen, stack = set(), [WORKER_ENTRY]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        source = SRC / name
        if not source.exists():
            continue
        for said in FROM.findall(source.read_text()):
            stack.append(pathlib.PurePosixPath(said).name)
    missing = seen - set(MODULES) - {WORKER_ENTRY} - GENERATED
    if missing:
        sys.exit("%s reaches %s, which the page does not carry - add it to MODULES"
                 % (WORKER_ENTRY, ", ".join(sorted(missing))))
    return [name for name in MODULES if name in seen]


def check_imports():
    """Every relative import must name a file that is really there, and one the
    single-file build carries. The artifact cannot catch this - it throws the
    imports away - so it is caught here or it is caught by somebody opening the
    site and finding nothing at all."""
    known = set(MODULES)
    for name in sorted(p.name for p in SRC.glob('*.js')):
        for said in FROM.findall((SRC / name).read_text()):
            target = pathlib.PurePosixPath(said).name
            if target in GENERATED:
                continue        # written into the site by this script, not in src/
            if not (SRC / target).exists():
                sys.exit('%s imports %s, which is not in src/' % (name, said))
            if name in known and target not in known:
                sys.exit('%s imports %s, which the single file does not carry - '
                         'add it to MODULES' % (name, said))


def fetch_npm(package, cache_name, member_prefix, marker):
    """Pulls one package from npm and unpacks the files we need. Cached."""
    cache = ROOT / cache_name
    if (cache / marker).exists():
        return cache / pathlib.PurePosixPath(member_prefix).parent

    cache.mkdir(exist_ok=True)
    print("fetching %s from npm…" % package)
    subprocess.run(["npm", "pack", package], cwd=cache, check=True, stdout=subprocess.DEVNULL)
    tarballs = sorted(cache.glob("%s-*.tgz" % package))
    if not tarballs:
        sys.exit("npm pack produced no tarball for %s" % package)
    with tarfile.open(tarballs[-1]) as archive:
        wanted = [m for m in archive.getmembers() if m.name.startswith(member_prefix)]
        if not wanted:
            sys.exit("%s does not contain %s" % (package, member_prefix))
        archive.extractall(cache, members=wanted)
    return cache / pathlib.PurePosixPath(member_prefix).parent


def fetch_kernel():
    """OpenCascade for the browser, from npm. Cached in docs/.kernel."""
    return fetch_npm(KERNEL_PACKAGE, ".kernel", "package/dist/replicad_single.",
                     "package/dist/replicad_single.wasm")


def fetch_stage():
    """PlayCanvas, for the showroom. Cached in docs/.stage."""
    return fetch_npm(STAGE_PACKAGE, ".stage", "package/" + STAGE_FILE,
                     "package/" + STAGE_FILE)


def build_site(shell, glue_path, wasm_path, stage_path):
    """The served build: the page, the modules, and the big pieces as files.

    Nothing is bundled and nothing is inlined. The browser resolves the imports
    itself, which means the file it fetches is the file in src/ - so what is
    served can be read, and a stack trace from it points at a real line."""
    # The two generated folders go completely, so a module that has been
    # deleted from src/ stops being served. Nothing else here is touched:
    # src/, test/, data/ and the READMEs are source, and data/ is served as it
    # stands - a package's table is already a file in the right place.
    for folder in (SITE_MODULES, SITE_BINARIES):
        if (SITE / folder).exists():
            shutil.rmtree(SITE / folder)
    (SITE / SITE_MODULES).mkdir(parents=True)
    (SITE / SITE_BINARIES).mkdir()

    for name in MODULES + [WORKER_ENTRY]:
        shutil.copyfile(SRC / name, SITE / SITE_MODULES / name)
    shutil.copyfile(glue_path, SITE / SITE_MODULES / GLUE_MODULE)
    shutil.copyfile(wasm_path, SITE / SITE_BINARIES / wasm_path.name)
    shutil.copyfile(stage_path, SITE / SITE_BINARIES / stage_path.name)
    for _, name in PAYLOADS:
        if not (DATA / name).exists():
            sys.exit("missing %s" % (DATA / name))

    # The shell is written as a fragment because an Artifact supplies the
    # document around it. A served page has no such wrapper, and a page with no
    # doctype is a page in quirks mode - so this build supplies one. The icon
    # is drawn here rather than fetched: a favicon request that 404s is the
    # only broken link a site like this would otherwise have.
    (SITE / SITE_INDEX).write_text("\n".join([
        "<!doctype html>",
        '<html lang="en">',
        '<link rel="icon" href="data:image/svg+xml,'
        "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E"
        "%3Cpath d='M8 1.6l5.6 3v6.8L8 14.4l-5.6-3V4.6z' fill='none' stroke='%232f6feb' "
        "stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E\">",
        shell.rstrip(),
        "",
        # One script element, and it is the entry module. Everything else
        # arrives because something imported it.
        '<script type="module" src="app/%s"></script>' % ENTRY,
        "</html>",
        "",
    ]))

    # Pages runs Jekyll over what it serves unless told not to, and Jekyll
    # eats folders beginning with an underscore and rewrites what it feels
    # like - and, with no index.html to hand, renders the README as the site.
    # This file is how it is told not to. One per folder Pages might serve.
    (SITE / ".nojekyll").write_text("")
    (TOP / ".nojekyll").write_text("")

    # And the way in, for a site served from the repository root: the app is a
    # folder further down, so this is the only thing at the root that has to
    # exist. Served from /docs instead, nothing ever asks for it.
    (TOP / "index.html").write_text("""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>OCAF Feature Modeller</title>
<meta http-equiv="refresh" content="0; url=docs/">
<link rel="canonical" href="docs/">
<style>
  html { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #e9edf1; color: #1b2733;
    font: 14px/1.6 "IBM Plex Sans", system-ui, -apple-system, sans-serif;
  }
  @media (prefers-color-scheme: dark) { body { background: #12181f; color: #dde5ee; } }
  p { text-align: center; padding: 0 24px; }
  a { color: #2f6feb; }
</style>
<p>The modeller is one folder down.<br><a href="docs/">Open it</a>.</p>
<script>location.replace("docs/");</script>
</html>
""")

    served = [TOP / "index.html", SITE / SITE_INDEX, *(SITE / SITE_MODULES).rglob("*"),
              *(SITE / SITE_BINARIES).rglob("*"), *(DATA).rglob("*")]
    total = sum(f.stat().st_size for f in served if f.is_file())
    print("wrote the site into %s/  %.1f MB  (%d modules, kernel served as a file)" % (
        SITE.name, total / 1048576, len(MODULES) + 1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wasm-dir", default=None,
                        help="directory holding replicad_single.js and .wasm "
                             "(default: fetch replicad-opencascadejs from npm into docs/.kernel)")
    parser.add_argument("--only", choices=["artifact", "site"], default=None,
                        help="build just one of the two (default: both)")
    args = parser.parse_args()

    wasm_dir = pathlib.Path(args.wasm_dir) if args.wasm_dir else fetch_kernel()
    glue_path = wasm_dir / "replicad_single.js"
    wasm_path = wasm_dir / "replicad_single.wasm"
    for path in (glue_path, wasm_path):
        if not path.exists():
            sys.exit("missing %s" % path)

    shell = (SRC / "index.html").read_text()
    stage_path = fetch_stage() / pathlib.PurePosixPath(STAGE_FILE).name
    if not stage_path.exists():
        sys.exit("missing %s" % stage_path)

    if args.only != "artifact":
        build_site(shell, glue_path, wasm_path, stage_path)
    if args.only == "site":
        return

    # The emscripten glue is a module whose default export is the factory.
    glue = glue_path.read_text()
    if "export default Module;" not in glue:
        sys.exit("the glue no longer ends in `export default Module;` - check the package version")
    glue = glue.replace("export default Module;", "const replicadInit = Module;")

    packed = base64.b64encode(gzip.compress(wasm_path.read_bytes(), 9)).decode("ascii")

    stage_packed = base64.b64encode(
        gzip.compress(stage_path.read_bytes(), 9)).decode("ascii")

    check_imports()

    # The worker's own script, for the single file: the same glue and the same
    # modules, minus everything that needs a window, with the worker's entry on
    # the end. Packed like every other big piece, unpacked at run time and
    # handed to the worker as a blob - because inside one file there is nothing
    # beside the page for a worker to be loaded from.
    worker_bodies = [glue] + [
        "/* ---- src/%s ---- */\n%s" % (name, strip_modules((SRC / name).read_text()))
        for name in worker_modules() + [WORKER_ENTRY]]
    worker_packed = base64.b64encode(
        gzip.compress("\n".join(worker_bodies).encode("utf-8"), 9)).decode("ascii")

    bodies, seen = [], {}
    for name in MODULES:
        text = strip_modules((SRC / name).read_text())
        for declared in DECLARE.findall(text):
            if declared in seen:
                sys.exit("%s redeclares `%s`, already declared in %s" % (name, declared, seen[declared]))
            seen[declared] = name
        bodies.append("/* ---- src/%s ---- */\n%s" % (name, text))

    # The payload rides in a non-JavaScript <script> element on purpose. As a
    # string literal inside the module it costs the browser ~13 s to parse; as
    # opaque element text the HTML tokenizer just scans past it, and the module
    # reads it at run time.
    parts = ["<script type=\"application/octet-stream\" id=\"kernel-payload\">"
             + packed + "</script>",
             "<script type=\"application/octet-stream\" id=\"showroom-payload\">"
             + stage_packed + "</script>",
             "<script type=\"application/octet-stream\" id=\"worker-payload\">"
             + worker_packed + "</script>"]
    for element_id, name in PAYLOADS:
        source = DATA / name
        if not source.exists():
            sys.exit("missing %s" % source)
        # Minified first: a package's table is JSON written to be read, and the
        # whitespace that makes it readable is not what should travel.
        compact = json.dumps(json.loads(source.read_text()), separators=(",", ":"))
        rolled = base64.b64encode(gzip.compress(compact.encode("utf-8"), 9)).decode("ascii")
        parts.append("<script type=\"application/octet-stream\" id=\"%s\">%s</script>"
                     % (element_id, rolled))
        print("packed %s  %.1f -> %.1f kB" % (name, source.stat().st_size / 1024, len(rolled) / 1024))
    payload = "\n".join(parts)

    script = "\n".join([
        "<script type=\"module\">",
        "/* OpenCascade, compiled to WebAssembly (replicad-opencascadejs). */",
        glue,
        *bodies,
        "</script>",
    ])

    OUT.write_text(shell.rstrip() + "\n\n" + payload + "\n\n" + script + "\n")
    size = OUT.stat().st_size
    print("  worker %d modules -> %.0f kB packed" % (len(worker_bodies), len(worker_packed) / 1024))
    print("wrote %s  %.1f MB  (kernel %.1f -> %.1f MB, showroom %.1f -> %.1f MB)" % (
        OUT.relative_to(ROOT.parent), size / 1048576,
        wasm_path.stat().st_size / 1048576, len(packed) / 1048576,
        stage_path.stat().st_size / 1048576, len(stage_packed) / 1048576))
    if size > 16 * 1048576:
        sys.exit("over the 16 MB artifact limit")


if __name__ == "__main__":
    main()
