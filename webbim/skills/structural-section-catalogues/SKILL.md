---
name: structural-section-catalogues
description: How to add standard structural steel section catalogues (AISC W/HP/M/S/HSS/Pipe, European HE/IPE/UPN/RHS/SHS/CHS, British UB/UC/PFC, Australian/NZ UB/UC/WB/WC/PFC/RHS/CHS) to a BIM or CAD application as generated data, with correct designations, units and profile geometry including hollow sections. Use this whenever a user asks for steel sections, beam or column profiles, a section picker, "the whole wide flange catalogue", hollow sections, or when section names, dimensions or holes in a profile look wrong.
---

# Steel section catalogues

Nobody should type 2000 rows of section dimensions, and nobody should trust
typed ones. Generate the catalogue from published open data using a script
that lives in the repo. Emit a data module. Say where each family came from,
and flag anything that could not be cross-checked.

Reference: `webbim/tools/gensec.py` → `src/sections.js` (generated),
`sectionlib.js` (lookup), `sectionui.js` (picker), `bim.js` `profileLoops`.

## Sources (open licences)

| Standard | Source |
|---|---|
| AISC (W, HP, M, S, HSS rect/square/round, Pipe) | `steelpy` shape CSVs (Apache-2.0), in inches, converted |
| EN (HE A/B/M, IPE, RHS, CHS) and BS (UB, UC) | FreeCAD `BIM/Presets/profiles.csv` |
| EN SHS, plus a cross-check of HE/IPE | `eurocodepy` JSON (MIT) |
| AS/NZS | no clean open dataset: typed tables marked `check`. **Ask the user** for the manufacturer's catalogue (e.g. InfraBuild) rather than inventing values |

Record the licence and the exact fetch step in the generator's docstring, so
the file can be regenerated a year later.

## Designations are the user's vocabulary

Engineers search by the printed name, so get it exactly right:

- AISC: `W44x408`, `HSS10x3-1/2x3/16` (fractions, mixed numbers with a
  hyphen), `HSS28.000x1.000` for round HSS (decimals). The source CSV writes
  both styles as `_`. A single blanket `_ → .` replacement turns `5_8` into
  `5.8`, a wrong and unsearchable section. Parse each family by its own rule.
- EN: `HE 300 B`, `IPE 360`, `RHS 200x100x8`, `CHS 168.3x6.3`.
- Keep original units as a note, and store millimetres rounded to 0.1.

## Geometry: loops, holes, round slicing

A profile is a list of closed loops: outer counter-clockwise, holes clockwise.

- I shapes: the 12 corners of the flanges and web (root radii omitted; add
  them as arcs if the kernel keeps analytic curves).
- RHS/SHS: outer rectangle plus an inner rectangle, inset by the wall
  thickness, as a **hole**. Drop the hole when 2t exceeds the section, so a
  bad row can't produce an inside-out loop.
- CHS/Pipe: two circles. The plan and section path keep true arcs. The
  footprint polygon uses 32 segments, and a horizontal CHS beam is built from
  12 horizontal slices (`roundSlices`, which gives each slice's half width
  and bore).
- Beams and columns carry the loops to the solid builder, and the hole must
  survive into the 3D mesh, hidden-line output and IFC export. Test that a
  hollow section's area = outer − inner.

## Picker UX

Standard → family → a searchable list (`sectionPicker`). Remember the last
standard picked. The search box takes the printed name (`W14`, `310UC`,
`200x100`) and filters as you type. A small to-scale drawing of the selected
section would be the next improvement.

The chosen designation goes onto the *type*, not the instance, so changing the
type updates every beam that uses it.
