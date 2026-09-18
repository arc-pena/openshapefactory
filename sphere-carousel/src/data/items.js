/**
 * The carousel content. Each entry drives one panel on the inner surface of
 * the sphere; `palette` seeds the procedurally generated artwork so the build
 * ships with zero image assets.
 */
export const ITEMS = [
  {
    title: 'Tidal Drift',
    category: 'WebGL / Installation',
    year: '2026',
    body:
      'A shoreline simulated as 40.000 instanced cubes, each one displaced by a layered flow field. Visitors push the tide around with their shadow.',
    tags: ['Three.js', 'GPGPU', 'TouchDesigner'],
    palette: { base: '#0d2a33', mid: '#2f7d80', hot: '#c9f2e4', seed: 1337 },
    mood: 'waves',
  },
  {
    title: 'Iron Bloom',
    category: 'Generative / Print',
    year: '2025',
    body:
      'Corrosion as a growth algorithm. A reaction–diffusion system fed with scanned rust plates, output as a 96-page risograph series.',
    tags: ['GLSL', 'Reaction–Diffusion', 'Riso'],
    palette: { base: '#2a1410', mid: '#a4552a', hot: '#f7c98b', seed: 8080 },
    mood: 'blobs',
  },
  {
    title: 'Null Signal',
    category: 'Audio Reactive',
    year: '2025',
    body:
      'Live visuals for a modular set. FFT bands carve a voxel monolith in real time; silence lets the geometry collapse back into noise.',
    tags: ['Web Audio', 'Instancing', 'Live'],
    palette: { base: '#12121c', mid: '#5b5bd6', hot: '#e6e6ff', seed: 4242 },
    mood: 'bars',
  },
  {
    title: 'Sunken Atlas',
    category: 'Interactive Map',
    year: '2024',
    body:
      'Bathymetric data for twelve drowned settlements, rebuilt as a navigable sphere. Depth becomes typography, typography becomes terrain.',
    tags: ['Cartography', 'Shaders', 'Data'],
    palette: { base: '#0b1b26', mid: '#3c6e91', hot: '#ffd9a0', seed: 909 },
    mood: 'contours',
  },
  {
    title: 'Paper Engine',
    category: 'Product / Motion',
    year: '2024',
    body:
      'A folding system where every interface state is a crease pattern. Built as one animated mesh so the whole product breathes as a single sheet.',
    tags: ['Motion', 'Design System', 'Rive'],
    palette: { base: '#221d18', mid: '#8a7a63', hot: '#f3ece0', seed: 5150 },
    mood: 'folds',
  },
  {
    title: 'Halo Decay',
    category: 'Experiment',
    year: '2023',
    body:
      'Volumetric light traced through a decaying particle shell. An exercise in how little you can render and still feel weather.',
    tags: ['Raymarching', 'Post FX', 'WebGL2'],
    palette: { base: '#1a0f22', mid: '#7e3f8f', hot: '#ffc4e6', seed: 2718 },
    mood: 'halo',
  },
];
