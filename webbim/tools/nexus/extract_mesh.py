"""The red dash-dot mesh of the Nexus plans (stroke red, 0.24 pt) as a planar graph: ../mesh_raw.json.
The PDFs draw every dash as its own path, so dashes are grouped into straight edges (mesh.group_edges),
snapped into nodes at corners and T-junctions (mesh.build_graph). Page points, y down.
Run pdftocairo -svg on a level PDF first (any tower level shows the whole mesh unobstructed; L5 is used)."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from mesh import frag_segments, group_edges, build_graph
WORK = os.environ.get('NEXUS_WORK', os.getcwd())
svg = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, 'svg', 'L5.svg')
segs = frag_segments(svg, lambda p: p['stroke'] == (255, 0, 0) and abs(p['w'] - 0.24) < 0.02)
nodes, edges = build_graph(group_edges(segs))
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(WORK, 'mesh_raw.json')
json.dump({'nodes': nodes, 'edges': edges}, open(out, 'w'))
print('dash segments', len(segs), 'nodes', len(nodes), 'edges', len(edges), '->', out)
