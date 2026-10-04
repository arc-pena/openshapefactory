# Diagram Compositor (nukestyle_diagram_editor)

A node-graph image compositor fed by the Feature Modeller (the parametric CAD tool). The two are
meant to grow together.

## Every build starts from the latest Feature Modeller

1. Read the Feature Modeller artifact first: `Artifact` action `read`,
   url `https://claude.ai/artifact/6RwchubErKSRTXve59pDHL`. That saves its newest version as
   `tool-results/artifact-2bf933ac-<version>.html`. Compare the version with `MODELLER_VERSION`.
2. Build: `web/nukestyle_diagram_editor/build/build.sh [saved.html]` (no argument = newest saved
   snapshot). It
   - concatenates `src/` into `nukestyle_diagram_editor.html` and `index.html`,
   - extracts the modeller's kernel and worker into `kernel/` (`build/extract_payloads.py`),
   - re-inserts the modeller as `modeller.html` with the bridge and fixes (`build/inject_bridge.py`),
   - writes `MODELLER_VERSION`.
3. If a modeller patch in `inject_bridge.py` fails ("patch target not found"), the modeller changed
   that code: read the new code and update the patch, or drop it if the modeller now fixes it itself.
   Never ship with a patch skipped.
4. New modeller capabilities (render modes, feature types, materials) should reach the editor: check
   what changed and expose it (for example through the bridge in `inject_bridge.py`).

## Publishing

- GitHub Pages: `build/publish_pages.sh` (commits the built site onto the `gh-pages` branch;
  never touches `master`). Site: https://arc-pena.github.io/openshapefactory/
- claude.ai artifact `https://claude.ai/artifact/BLMDSQLAs2sYifyKHySAX6`: publish
  `nukestyle_diagram_editor.html` with `files: {"modeller.html": ...}` whenever modeller.html changed.
- Work on branch `claude/trusting-pasteur-lhjcm1`; the user does not want `master` touched.
