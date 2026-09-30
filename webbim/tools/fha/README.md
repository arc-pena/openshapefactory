# Frank Harmon sets: lifting a drawing set's annotation and title blocks from its PDF

The four FHA samples are rebuilt sheet by sheet from the PDFs they came as (overlay-checked, as Casa Mazatlan).
These scripts read the PDFs; `fhapack.py` writes what they read into `src/fha_pdf.js` (deflated, per set).

- `fhax.py <pdf> <out.json> [pages]` - every page's notes (text blocks with baseline, cap height, font, alignment,
  line spacing), their leaders (start, elbows, tip, arrowhead or dot), dimension strings with their dimension line
  (through its arrowheads), and bubbles (text in a circle).
- `tbx.py <pdf> <pages> <region> <config.json> <out.json>` - a set's title block as a title block family: the
  strip's lines and words; words that change sheet to sheet become labels (Sheet Number, Sheet Name lines, Scale,
  Date), words equal to a project value become that field's label. Also each page's own values.
- `mkaia.py` - joins one set's pages and title blocks into `fhaset_<set>.json`; `fhapack.py` packs every set.
- Measuring the model off the drawings: `p2m.py` (lines in model feet), `p2f.py` (filled regions, poché),
  `wallfind.py` (walls from pairs of heavy lines, concrete where poché fills them), `stipimg.py` (stippled
  areas - sunscreens - found in the rendered page).
