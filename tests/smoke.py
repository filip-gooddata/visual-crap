"""Exercise the packaged executable against an independent project."""
import base64
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

binary = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    src = root / 'src'
    src.mkdir()
    if os.environ.get('TYPESCRIPT_DIR'):
        (root / 'node_modules').mkdir()
        (root / 'node_modules' / 'typescript').symlink_to(os.environ['TYPESCRIPT_DIR'], target_is_directory=True)
    (root / 'package.json').write_text('{"name":"fixture","version":"1.0.0"}')
    code = src / 'main.ts'
    code.write_text('export function leaf(x: number) { return x > 2 ? x : 0; }\nexport function caller(x: number) { return leaf(x); }\n')
    (src / 'main.test.ts').write_text('export function testOnly() { return 99; }\n')
    def loc(line, start, end):
        return {'start': {'line': line, 'column': start}, 'end': {'line': line, 'column': end}}
    coverage = {str(code): {'path': str(code), 'statementMap': {'0': loc(1, 0, 56), '1': loc(2, 0, 51)}, 's': {'0': 0, '1': 1}, 'fnMap': {'0': {'name': 'leaf', 'decl': loc(1, 16, 20), 'loc': loc(1, 32, 56), 'line': 1}, '1': {'name': 'caller', 'decl': loc(2, 16, 22), 'loc': loc(2, 34, 51), 'line': 2}}, 'f': {'0': 0, '1': 1}, 'branchMap': {}, 'b': {}}}
    coverage_file = root / 'coverage.json'
    coverage_file.write_text(json.dumps(coverage))
    output = root / 'report.html'
    subprocess.run([str(binary), '--root', str(root), '--coverage', str(coverage_file), '--output', str(output)], check=True)
    match = re.search(r"atob\('([^']+)'\)", output.read_text())
    assert match, 'embedded report missing'
    data = json.loads(gzip.decompress(base64.b64decode(match.group(1))))
    actual = {n['name']: (n['coverage_source'], n['coverage_pct'], n['crap']) for n in data['nodes']}
    assert actual == {'leaf': ('istanbul', 0.0, 6.0), 'caller': ('istanbul', 100.0, 1.0)}, actual
    assert data['summary']['functions_analyzed'] == 2, data['summary']
    assert len(data['edges']) == 1 and data['edges'][0][2] == ('call' if os.environ.get('TYPESCRIPT_DIR') else 'inferred'), data['edges']
    assert data['tsAvailable'] == bool(os.environ.get('TYPESCRIPT_DIR'))
    print('Binary smoke test passed')
