# The modeller's kernel, its worker and its path tracer travel inside the Feature Modeller page as
# base64 gzip blocks. The editor runs the same kernel headless, so it takes them from the same page:
# the editor and the modeller can never disagree about what a feature builds.
import base64, re, sys
src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()
for pid, name in (('kernel-payload', 'replicad_single.wasm.gz'), ('worker-payload', 'kernel-worker.js.gz')):
    m = re.search(r'<script type="application/octet-stream" id="%s">(.*?)</script>' % pid, html, re.S)
    assert m, 'the Feature Modeller page has no ' + pid + ' - its packing changed; update extract_payloads.py'
    data = base64.b64decode(m.group(1).strip())
    assert data[:2] == b'\x1f\x8b', pid + ' is not gzip any more'
    open(out + '/' + name, 'wb').write(data)
    print(name, len(data), 'bytes')
