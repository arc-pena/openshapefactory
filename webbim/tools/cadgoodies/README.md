# CAD goodies symbol library

`src/cadlib_data.js` is generated from `cad goodies.dxf` (not kept in the repository: 55 MB). To rebuild it, put
the DXF in this folder and run, in order:

1. `python3 extract.py` - every block as polylines in mm (nested blocks exploded, curves flattened, simplified).
2. `python3 classify.py` - a name, category and view for each block, from its coded name or (where the name says
   nothing) from how it looks; unit-sized trees and shrubs brought to typical sizes; fragments left out.
3. `python3 pack.py` - the index and geometry varint-coded, raw DEFLATE, base64, written to `src/cadlib_data.js`.

Needs `ezdxf`. `src/cadlib.js` decodes the data on first use; File/Insert/Annotate > Symbol Library browses it.
