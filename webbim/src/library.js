//! The default library a new document starts with (spec §7, §8, §5): pens,
//! patterns, materials, families, types, text types, symbols and the two view
//! styles that must ship together. It is data — the same shape the file stores.

export const PEN_ISO = {
  name: "ISO 128",
  pens: {
    gossamer: { weight: 0.09 }, hairline: { weight: 0.13 }, thin: { weight: 0.18 }, light: { weight: 0.25 },
    medium: { weight: 0.35 }, heavy: { weight: 0.50 }, bold: { weight: 0.70 }, extra: { weight: 1.00 }, primary: { weight: 1.40 },
  },
  perScale: { "1:20": { thin: 0.25, medium: 0.50 } },
};

/** Patterns in a .pat-compatible form: each line family is
 *  {angle (deg), origin [x,y], delta [along, across], dashes [...]} in pattern units.
 *  `kind: "model"` scales with the model (bricks are bricks); `"drafting"`
 *  scales with the paper (insulation squiggles are the same size at every scale). */
export const PATTERNS = {
  "P-BRICK":   { name: "Brick (model)", kind: "model", lines: [
    { angle: 0, origin: [0, 0], delta: [0, 75] },
    { angle: 90, origin: [0, 0], delta: [75, 112.5], dashes: [75, -75] } ] },
  "P-BLOCK":   { name: "Blockwork (model)", kind: "model", lines: [
    { angle: 0, origin: [0, 0], delta: [0, 225] },
    { angle: 90, origin: [0, 0], delta: [225, 220], dashes: [225, -225] } ] },
  "P-CONC":    { name: "Concrete", kind: "drafting", lines: [
    { angle: 45, origin: [0, 0], delta: [0, 3.5], dashes: [0.6, -1.2, 0.2, -1.6] },
    { angle: 135, origin: [0.8, 0], delta: [0, 4.1], dashes: [0.3, -2.4] } ] },
  "P-INSUL":   { name: "Batt insulation", kind: "drafting", batt: true, lines: [] },
  "P-RIGID":   { name: "Rigid insulation", kind: "drafting", lines: [
    { angle: 45, origin: [0, 0], delta: [0, 1.6] }, { angle: 135, origin: [0, 0], delta: [0, 1.6] } ] },
  "P-PLASTER": { name: "Plaster", kind: "drafting", lines: [
    { angle: 45, origin: [0, 0], delta: [0.9, 0.9], dashes: [0.05, -0.9] } ] },
  "P-TIMBER":  { name: "Timber grain", kind: "drafting", lines: [
    { angle: 0, origin: [0, 0], delta: [0.4, 1.1], dashes: [3, -0.8] } ] },
  "P-ENDGRAIN":{ name: "Timber end grain", kind: "drafting", lines: [
    { angle: 45, origin: [0, 0], delta: [0, 2.2] }, { angle: 135, origin: [0, 0], delta: [0, 2.2] } ] },
  "P-SCREED":  { name: "Screed", kind: "drafting", lines: [
    { angle: 0, origin: [0, 0], delta: [0.7, 0.7], dashes: [0.05, -1.3] } ] },
  "P-STONE":   { name: "Cast stone", kind: "drafting", lines: [
    { angle: 60, origin: [0, 0], delta: [0, 2.4], dashes: [1.4, -1] }, { angle: 150, origin: [0, 0], delta: [0, 2.4], dashes: [0.8, -1.6] } ] },
  "P-EARTH":   { name: "Earth", kind: "drafting", lines: [
    { angle: 45, origin: [0, 0], delta: [0, 2.4], dashes: [2, -0.6] }, { angle: 135, origin: [0, 0], delta: [0, 4.8], dashes: [1, -1.6] } ] },
  "P-GRAVEL":  { name: "Gravel", kind: "drafting", lines: [
    { angle: 30, origin: [0, 0], delta: [1.1, 1.9], dashes: [0.35, -1.5] }, { angle: 100, origin: [0.4, 0.3], delta: [1.3, 2.1], dashes: [0.3, -1.8] } ] },
  "P-DIAG":    { name: "Diagonal", kind: "drafting", lines: [{ angle: 45, origin: [0, 0], delta: [0, 1.5] }] },
};

export const MATERIALS = {
  "M-BRICK":  { name: "Brick, facing", mark: "BR-01", description: "Facing brick, 102.5 mm, stretcher bond", cut: { pattern: "P-BRICK", pen: "heavy", lineColour: "#1b1f24", background: "#f3dcd0" }, projection: { pen: "thin", lineColour: "#1b1f24", pattern: "P-BRICK" }, shading: { colour: "#a4604a" } },
  "M-BLOCK":  { name: "Blockwork", mark: "BL-01", description: "Dense concrete blockwork", cut: { pattern: "P-BLOCK", pen: "heavy", lineColour: "#1b1f24", background: "#e3e5e8" }, projection: { pen: "thin", lineColour: "#1b1f24" }, shading: { colour: "#b9bcc0" } },
  "M-INSUL":  { name: "Insulation, batt", mark: "IN-01", description: "Mineral wool batt insulation", cut: { pattern: "P-INSUL", pen: "thin", lineColour: "#3a3f47", background: "#fbf6dc" }, projection: { pen: "hairline" }, shading: { colour: "#e9d77a" } },
  "M-RIGID":  { name: "Insulation, rigid", mark: "IN-02", description: "Rigid PIR insulation board", cut: { pattern: "P-RIGID", pen: "thin", lineColour: "#3a3f47", background: "#eef3e6" }, projection: { pen: "hairline" }, shading: { colour: "#d8e6b8" } },
  "M-PLAS":   { name: "Plaster", mark: "PL-01", description: "Gypsum plaster skim", cut: { pattern: "P-PLASTER", pen: "thin", lineColour: "#1b1f24", background: "#ffffff" }, projection: { pen: "hairline" }, shading: { colour: "#f1ede6" } },
  "M-PB":     { name: "Plasterboard", mark: "PB-01", description: "Gypsum plasterboard 12.5 mm", cut: { pattern: "P-PLASTER", pen: "thin", lineColour: "#1b1f24", background: "#ffffff" }, projection: { pen: "hairline" }, shading: { colour: "#f4f2ee" } },
  "M-STUD":   { name: "Metal stud zone", mark: "ST-01", description: "Metal stud zone", cut: { pattern: "P-DIAG", pen: "medium", lineColour: "#1b1f24", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#c9ced6" } },
  "M-CONC":   { name: "Concrete, cast in situ", mark: "CN-01", description: "In-situ concrete C32/40", cut: { pattern: "P-CONC", pen: "heavy", lineColour: "#1b1f24", background: "#e9eaec" }, projection: { pen: "thin" }, shading: { colour: "#a9adb2" } },
  "M-TIMBER": { name: "Timber", mark: "TM-01", description: "Softwood timber C24", cut: { pattern: "P-TIMBER", pen: "medium", lineColour: "#3b2a1a", background: "#f6ead8" }, projection: { pen: "thin" }, shading: { colour: "#c7995f" } },
  "M-GLASS":  { name: "Glass", mark: "GL-01", description: "Clear float glass", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#dff0f7" }, projection: { pen: "hairline" }, shading: { colour: "#9fd0e6" } },
  "M-STEEL":  { name: "Steel", mark: "SS-01", description: "Structural steel S355", cut: { pattern: null, pen: "heavy", lineColour: "#1b1f24", background: "#2d3239" }, projection: { pen: "thin" }, shading: { colour: "#71777f" } },
  "M-CARPET": { name: "Carpet tile", mark: "FF-01", description: "Carpet tile on raised access floor", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#8f8ea3" }, projection: { pen: "hairline" }, shading: { colour: "#8f8ea3" } },
  "M-TILE":   { name: "Ceramic tile", mark: "FF-02", description: "Porcelain floor tile, 10 mm, adhesive fixed", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#f2eee4" }, projection: { pen: "hairline" }, shading: { colour: "#e8e1d2" } },
  "M-SCREED": { name: "Screed", mark: "SC-01", description: "Sand/cement screed", cut: { pattern: "P-CONC", pen: "thin", lineColour: "#1b1f24", background: "#f0efe9" }, projection: { pen: "hairline" }, shading: { colour: "#cfcac0" } },
  "M-STONE":  { name: "Cast stone", mark: "SN-01", description: "Cast stone", cut: { pattern: "P-STONE", pen: "heavy", lineColour: "#1b1f24", background: "#efe9dd" }, projection: { pen: "thin" }, shading: { colour: "#d6cdbb" } },
};

/** Parameter specs: the typed property sets (§4.3). Kinds are the closed set. */
export const PARAM_SPECS = {
  Phase:      { guid: "a3f1-0001", kind: "Enum", values: ["Existing", "Demolished", "New", "Temporary"], binding: "instance", categories: ["*"], default: "New", group: "Phasing" },
  Mark:       { guid: "a3f1-0002", kind: "Text", binding: "instance", categories: ["*"], group: "Identity Data" },
  Comments:   { guid: "a3f1-0003", kind: "Text", binding: "instance", categories: ["*"], group: "Identity Data" },
  FireRating: { guid: "77b2-0001", kind: "Enum", values: ["-", "30", "60", "90", "120"], binding: "type", categories: ["IfcWall", "IfcDoor"], default: "-", group: "Identity Data" },
  AcousticRw: { guid: "91c4-0001", kind: "Number", unit: "dB", binding: "type", categories: ["IfcWall"], group: "Identity Data" },
  Function:   { guid: "91c4-0002", kind: "Enum", values: ["Exterior", "Interior", "Retaining", "Core"], binding: "type", categories: ["IfcWall"], default: "Interior", group: "Construction" },
  Department: { guid: "5d10-0001", kind: "Text", binding: "instance", categories: ["IfcSpace"], group: "Identity Data" },
  Number:     { guid: "5d10-0002", kind: "Text", binding: "instance", categories: ["IfcSpace"], group: "Identity Data" },
  Occupancy:  { guid: "5d10-0003", kind: "Integer", binding: "instance", categories: ["IfcSpace"], group: "Identity Data" },
  FinishFloor:{ guid: "5d10-0004", kind: "Material", binding: "instance", categories: ["IfcSpace"], group: "Finishes" },
  // what a space graph built, and which of its nodes (rooms) each element belongs to
  SpaceGraph: { guid: "5d10-0010", kind: "Text", binding: "instance", categories: ["*"], group: "Space Graph" },
  ProgramId:  { guid: "5d10-0011", kind: "Text", binding: "instance", categories: ["*"], group: "Space Graph" },
};

/** Categories are IFC classes (§2.2). Subcategories are the unit of pen assignment (§7.1). */
export const CATEGORIES = {
  IfcWall:           { name: "Walls", subcategories: { Cut: { cut: "heavy", projection: "thin" }, Layer: { cut: "hairline" }, Common: { cut: "heavy", projection: "thin", beyond: "hairline" } } },
  IfcColumn:         { name: "Columns", subcategories: { Common: { cut: "heavy", projection: "thin" } } },
  IfcDoor:           { name: "Doors", subcategories: { Panel: { cut: "heavy", projection: "thin" }, Frame: { cut: "medium", projection: "thin" }, Swing: { projection: "hairline" }, Opening: { cut: "medium" } } },
  IfcWindow:         { name: "Windows", subcategories: { Frame: { cut: "medium", projection: "thin" }, Glass: { cut: "thin", projection: "hairline" }, Sill: { projection: "thin" } } },
  IfcOpeningElement: { name: "Openings", subcategories: { Common: { cut: "medium", projection: "thin" } } },
  IfcSpace:          { name: "Spaces", subcategories: { Common: { projection: "hairline" } } },
  IfcGrid:           { name: "Grids", subcategories: { Common: { projection: "thin" } } },
  IfcBuildingStorey: { name: "Levels", subcategories: { Common: { projection: "thin" } } },
  Annotation:        { name: "Annotation", subcategories: { Common: { symbolic: "thin" }, Dimension: { symbolic: "hairline" }, Text: { symbolic: "thin" }, Leader: { symbolic: "hairline" }, Marker: { symbolic: "medium" }, Constraint: { symbolic: "hairline" } } },
  Site:              { name: "Site", subcategories: { Common: { projection: "heavy" } } },
  Mass:              { name: "Mass", subcategories: { Common: { projection: "thin", cut: "medium" } } },
  Detail:            { name: "Detail items", subcategories: { Common: { projection: "thin" } } },
  IfcSlab:           { name: "Floors", subcategories: { Common: { cut: "heavy", projection: "thin", beyond: "hairline" } } },
  IfcBeam:           { name: "Structural Framing", subcategories: { Common: { cut: "heavy", projection: "thin", beyond: "hairline" } } },
  IfcBuildingElementProxy: { name: "Generic Models", subcategories: { Common: { cut: "heavy", projection: "thin", beyond: "hairline" } } },
  Furniture:         { name: "Furniture", subcategories: { Common: { projection: "thin" } } },
};

export const FAMILIES = {
  "F-WALL":      { name: "Wall", category: "IfcWall", system: "Wall", sealed: true },
  "F-BASICWALL": { name: "Basic Wall", extends: "F-WALL", paramDefaults: { Function: "Interior" } },
  "F-EXTCAV":    { name: "Ext Cavity", extends: "F-BASICWALL", paramSpecs: { CavityWidth: { kind: "Length", binding: "type" } }, paramDefaults: { FireRating: "60", Function: "Exterior" } },
  "F-PARTITION": { name: "Partition", extends: "F-BASICWALL", paramDefaults: { FireRating: "30", Function: "Interior" } },
  "F-DOOR":      { name: "Door", category: "IfcDoor", system: "Door", sealed: true },
  "F-SINGLEDOOR":{ name: "Single Flush", extends: "F-DOOR", paramDefaults: { FireRating: "-" } },
  "F-WINDOW":    { name: "Window", category: "IfcWindow", system: "Window", sealed: true },
  "F-CASEMENT":  { name: "Casement", extends: "F-WINDOW" },
  "F-COLUMN":    { name: "Column", category: "IfcColumn", system: "Column", sealed: true },
  "F-RCCOLUMN":  { name: "RC Column", extends: "F-COLUMN" },
  "F-FLOOR":     { name: "Floor", category: "IfcSlab", system: "Floor", sealed: true },
  "F-BEAM":      { name: "Beam", category: "IfcBeam", system: "Beam", sealed: true },
  "F-STEELBEAM": { name: "Steel I-section", extends: "F-BEAM" },
  "F-RCBEAM":    { name: "RC Beam", extends: "F-BEAM" },
};

export const TYPES = {
  "T-EXTCAV300": { family: "F-EXTCAV", name: "Ext Cavity 300", mark: "EW1",
    layers: [ { function: "Finish 2", thickness: 102.5, material: "M-BRICK" }, { function: "Thermal", thickness: 75, material: "M-INSUL" },
              { function: "Structure", thickness: 100, material: "M-BLOCK" }, { function: "Finish 1", thickness: 13, material: "M-PLAS" } ],
    coreStart: 2, coreEnd: 3, params: { FireRating: "60", AcousticRw: 52, CavityWidth: 75 } },
  "T-EXTCAV350": { family: "F-EXTCAV", name: "Ext Cavity 350", mark: "EW2",
    layers: [ { function: "Finish 2", thickness: 102.5, material: "M-BRICK" }, { function: "Thermal", thickness: 100, material: "M-INSUL" },
              { function: "Structure", thickness: 140, material: "M-BLOCK" }, { function: "Finish 1", thickness: 13, material: "M-PLAS" } ],
    coreStart: 2, coreEnd: 3, params: { FireRating: "90", AcousticRw: 55, CavityWidth: 100 } },
  "T-PART100":   { family: "F-PARTITION", name: "Partition 100", mark: "IW1",
    layers: [ { function: "Finish 1", thickness: 12.5, material: "M-PB" }, { function: "Structure", thickness: 75, material: "M-STUD" }, { function: "Finish 1", thickness: 12.5, material: "M-PB" } ],
    coreStart: 1, coreEnd: 2, params: { AcousticRw: 38 } },
  "T-BLOCK215":  { family: "F-BASICWALL", name: "Block 215 plastered", mark: "IW2",
    layers: [ { function: "Finish 1", thickness: 13, material: "M-PLAS" }, { function: "Structure", thickness: 190, material: "M-BLOCK" }, { function: "Finish 1", thickness: 13, material: "M-PLAS" } ],
    coreStart: 1, coreEnd: 2, params: { FireRating: "120", AcousticRw: 45, Function: "Core" } },
  "T-DOOR915":   { family: "F-SINGLEDOOR", name: "Single 915×2100", mark: "D1", width: 915, height: 2100, leafThickness: 44, frame: 40 },
  "T-DOOR915G":  { family: "F-SINGLEDOOR", name: "Single 915×2100 glazed", mark: "D2", width: 915, height: 2100, leafThickness: 44, frame: 40, glazed: true },
  "T-DOOR1015":  { family: "F-SINGLEDOOR", name: "Single 1015×2100", mark: "D3", width: 1015, height: 2100, leafThickness: 54, frame: 40, params: { FireRating: "30" } },
  "T-WIN1215":   { family: "F-CASEMENT", name: "Casement 1200×1500", mark: "W1", width: 1200, height: 1500, frame: 60, mullions: 1 },
  "T-WIN2415":   { family: "F-CASEMENT", name: "Casement 2400×1500", mark: "W2", width: 2400, height: 1500, frame: 60, mullions: 3 },
  "T-COL400":    { family: "F-RCCOLUMN", name: "RC 400×400", mark: "C1", width: 400, depth: 400, material: "M-CONC" },
  "T-COL300R":   { family: "F-RCCOLUMN", name: "RC Ø300", mark: "C2", width: 300, depth: 300, round: true, material: "M-CONC" },
  // floors: layers from the top surface down, like a wall's from its exterior face
  "T-FLOOR250":  { family: "F-FLOOR", name: "Concrete 200 + screed 50", mark: "FL1",
    layers: [ { function: "Finish 1", thickness: 50, material: "M-PLAS" }, { function: "Structure", thickness: 200, material: "M-CONC" } ], coreStart: 1, coreEnd: 2 },
  // system slab types, as Revit ships Generic floors: one concrete layer, and one built-up finish (top first)
  "T-SLAB100":   { family: "F-FLOOR", name: "Generic - 100mm", mark: "SL1", layers: [ { function: "Structure", thickness: 100, material: "M-CONC" } ], coreStart: 0, coreEnd: 1 },
  "T-SLAB200":   { family: "F-FLOOR", name: "Generic - 200mm", mark: "SL2", layers: [ { function: "Structure", thickness: 200, material: "M-CONC" } ], coreStart: 0, coreEnd: 1 },
  "T-SLAB300":   { family: "F-FLOOR", name: "Generic - 300mm", mark: "SL3", layers: [ { function: "Structure", thickness: 300, material: "M-CONC" } ], coreStart: 0, coreEnd: 1 },
  "T-SLAB230T":  { family: "F-FLOOR", name: "200mm + 20mm screed + 10mm ceramic tile", mark: "SL4",
    layers: [ { function: "Finish 1", thickness: 10, material: "M-TILE" }, { function: "Finish 2", thickness: 20, material: "M-SCREED" }, { function: "Structure", thickness: 200, material: "M-CONC" } ], coreStart: 2, coreEnd: 3 },
  "T-FLOOR240T":  { family: "F-FLOOR", name: "Tile 10 + screed 30 + concrete 200", mark: "FL3",
    layers: [ { function: "Finish 1", thickness: 10, material: "M-TILE" }, { function: "Finish 2", thickness: 30, material: "M-SCREED" }, { function: "Structure", thickness: 200, material: "M-CONC" } ], coreStart: 2, coreEnd: 3 },
  "T-FLOOR150T": { family: "F-FLOOR", name: "Timber deck 150", mark: "FL2",
    layers: [ { function: "Finish 1", thickness: 22, material: "M-TIMBER" }, { function: "Structure", thickness: 128, material: "M-TIMBER" } ], coreStart: 1, coreEnd: 2 },
  // beams: a profile swept along the beam's axis
  "T-BEAMRC300": { family: "F-RCBEAM", name: "RC 300×600", mark: "B1", shape: "rect", width: 300, depth: 600, material: "M-CONC" },
  "T-UB406":     { family: "F-STEELBEAM", name: "UB 406×178×60", mark: "B2", shape: "I", width: 178, depth: 406, flange: 12.8, web: 7.9, material: "M-STEEL" },
};

export const TEXT_TYPES = {
  "TT-20": { name: "2.0mm", height: 2.0, font: "Sans", widthFactor: 1, colour: "#000000", pen: "thin" },
  "TT-25": { name: "2.5mm", height: 2.5, font: "Sans", widthFactor: 1, colour: "#000000", pen: "thin" },
  "TT-35": { name: "3.5mm", height: 3.5, font: "Sans", widthFactor: 1, colour: "#000000", pen: "medium" },
  "TT-50": { name: "5.0mm", height: 5.0, font: "Sans", widthFactor: 1, colour: "#000000", pen: "medium" },
};

/** A north arrow, stored the way it arrives: as a DXF drawn 100×100, asked to be
 *  300×300 on paper-space terms (§8.2). The loader measures and scales it. */
export const NORTH_DXF = [
  "0","SECTION","2","HEADER","9","$INSUNITS","70","4","0","ENDSEC",
  "0","SECTION","2","ENTITIES",
  "0","CIRCLE","8","SYMBOL","10","50","20","50","30","0","40","50",
  "0","LWPOLYLINE","8","ARROW","90","4","70","1","10","50","20","100","10","70","20","20","10","50","20","35","10","30","20","20",
  "0","SOLID","8","ARROW","10","50","20","100","10","50","20","35","11","70","21","20","12","70","22","20",
  "0","TEXT","8","TEXT","10","50","20","70","40","14","1","N",
  "0","REGION","8","JUNK",
  "0","ENDSEC","0","EOF"].join("\n");

export const SYMBOLS = {
  "SY-NORTH": { name: "North arrow", source: { dxf: "inline:NORTH_DXF" }, sourceBBox: null, nominalSize: { w: 18, h: 18 }, scaleMode: "uniform", anchor: "centre", space: "paper" },
  "SY-TB-A1": { name: "Title block", generated: "titleBlock", space: "paper" },
};

// ---------------------------------------------------------------- the two styles (§7.2)
export const VS_PRESENTATION = {
  name: "Presentation", paper: { background: "#FFFFFF" }, detailLevel: "Coarse",
  byCategory: {
    IfcWall: { materialPriority: "view", cut: { fill: "#2C3440", pattern: "solid", pen: "none", detailLevel: "Coarse" },
               projection: { pen: "hairline", colour: "#B4BCC8" }, beyond: { pen: "gossamer", colour: "#CBD2DC", lineType: "dashed2" } },
    IfcColumn: { materialPriority: "view", cut: { fill: "#2C3440", pattern: "solid", pen: "none" } },
    IfcDoor: { cut: { pen: "hairline", colour: "#8A94A6" }, projection: { pen: "hairline", colour: "#8A94A6" }, swing: { pen: "gossamer", colour: "#B4BCC8" } },
    IfcWindow: { cut: { pen: "hairline", colour: "#8A94A6" }, projection: { pen: "gossamer", colour: "#8A94A6" } },
    IfcOpeningElement: { cut: { pen: "hairline", colour: "#8A94A6" } },
    IfcSpace: { fill: "#FFFFFF", label: { height: 2.0, colour: "#7B8598", align: "centre", content: "{Name}\n{Area}" } },
    Furniture: { projection: { pen: "gossamer", colour: "#A8B2C1", fill: "none" } },
    IfcGrid: { visible: false }, Annotation: { visible: false }, Detail: { visible: true },
    IfcBuildingStorey: { visible: true },
  },
  byFamily: {},
  rules: [
    { id: "FL-PARTITION", when: { param: "Function", is: "Interior" }, then: { cut: { fill: "#E8EBEF", pen: "hairline", colour: "#5A6474" } } },
    { id: "FL-CIRCULATION", when: { param: "Department", is: "Circulation" }, then: { fill: "#F2F4F7" } },
  ],
};

export const VS_CONSTRUCTION = {
  name: "Construction", paper: { background: "#FFFFFF" }, detailLevel: "Fine",
  byCategory: {
    IfcWall: { cut: { detailLevel: "Fine" }, projection: { pen: "thin" }, beyond: { pen: "hairline", lineType: "dashed2" } },
    IfcColumn: { cut: { pen: "heavy" } },
    IfcDoor: { cut: { pen: "medium" }, swing: { pen: "hairline" } },
    IfcWindow: { cut: { pen: "thin" } },
    IfcSpace: { fill: "none", label: { height: 2.5, colour: "#000000", align: "centre", content: "{Name}\n{Number} · {Area}" } },
    IfcGrid: { visible: true }, Annotation: { visible: true },
  },
  byFamily: { "F-PARTITION": { cut: { pen: "medium" } } },
  rules: [
    { id: "FL-DEMO", when: { param: "Phase", is: "Demolished" },
      then: { cut: { lineType: "dashed1", colour: "#888888", fill: "none", pattern: "none" }, projection: { lineType: "dashed1", colour: "#888888" }, halftone: true }, stop: true },
    { id: "FL-NEWWORK", when: { param: "Phase", is: "New" }, then: { cut: { colour: "#000000" } } },
  ],
};
