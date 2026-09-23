# Sample World

`index.html` is a white, foggy take on the Sphere World carousel. Each
parametric sample is a wall of animated cubes made from its own rendered
thumbnail. Entering one fades into its scroll-told narrative; "← Samples"
fades back to the world with that sample in front.

| Folder | Sample |
| --- | --- |
| `sketcher-narrative/` | Sketcher: 13-feature machined bracket (`sketcher.json`) |
| `towerc/` | Tower C: 1,426-feature tower structure (`tower.model.json`), built in bands of levels |
| `kernel/` | The Feature Modeller's OpenCascade worker kernel, shared by both narratives |
| `thumbs/` | Monochrome thumbnails the selector turns into cube walls |

To add a sample, add a row to `ITEMS` in `index.html`, a narrative folder and
a 512×352 thumbnail. Serve this folder over HTTP (for example
`python3 -m http.server`); the pages can't fetch the kernel from `file://`.
