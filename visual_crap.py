#!/usr/bin/env python3
"""Generate a self-contained visual report from Fallow and Graphify data."""
import argparse
import base64
from collections import Counter
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

TOOL = Path(__file__).resolve().parent
EXCLUDED = {'__tests__', '__mocks__', '__fixtures__', 'testUtils', 'test-utils', 'tests', 'fixtures'}

def excluded(path):
    return bool(set(Path(path).parts) & EXCLUDED) or bool(re.search(r'\.(?:test|spec)\.[cm]?[jt]sx?$', str(path))) or str(path).endswith('.d.ts')

def build(health, graph, output, root, source):
    findings = [f for f in health.get('findings', []) if (root / f['path']).resolve().is_relative_to(source) and not excluded(f['path']) and f.get('crap') is not None]
    if not findings:
        raise ValueError('No scored production functions found in the Fallow report')
    nodes = [{k: f.get(k) for k in ('path', 'line', 'col', 'name', 'cyclomatic', 'crap', 'coverage_source', 'coverage_tier', 'coverage_pct')} for f in findings]
    keys = Counter((n['path'], n['line'], n['name']) for n in nodes)
    lookup = {(n['path'], n['line'], n['name']): i for i, n in enumerate(nodes) if keys[(n['path'], n['line'], n['name'])] == 1}
    ids = {}
    counts = Counter(n.get('id') for n in graph.get('nodes', []))
    graph_keys = Counter((n.get('source_file'), n.get('source_location'), n.get('label')) for n in graph.get('nodes', []))
    for n in graph.get('nodes', []):
        path, loc, label = n.get('source_file', ''), n.get('source_location', ''), n.get('label', '')
        if excluded(path) or not loc.startswith('L') or not label.endswith('()') or counts[n.get('id')] != 1 or graph_keys[(path, loc, label)] != 1:
            continue
        try:
            key = (path, int(loc[1:].split('-')[0]), label[:-2])
        except ValueError:
            continue
        if key in lookup:
            ids[n['id']] = lookup[key]
    edges, seen = [], set()
    for edge in graph.get('edges', []):
        if edge.get('relation') != 'calls' or excluded(edge.get('source_file', '')) or edge.get('source') not in ids or edge.get('target') not in ids:
            continue
        a, b = ids[edge['source']], ids[edge['target']]
        if (a, b) not in seen:
            seen.add((a, b))
            edges.append([a, b, 'inferred', f"{edge.get('source_file', '')}:{edge.get('source_location', '')}"])
    incoming = {e[1] for e in edges}
    try:
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, stderr=subprocess.DEVNULL, text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        head = 'unavailable'
    data = {'nodes': nodes, 'edges': edges, 'unlinked': len(nodes)-len(incoming), 'entryOnly': 0, 'findingCount': len(nodes), 'boundaryCount': 0, 'matched': len(ids), 'head': head, 'summary': health.get('summary', {})}
    template = (TOOL / 'canvas.html').read_text()
    template = template.replace('/* HEAT */', (TOOL / 'heat.js').read_text())
    template = template.replace('/* WORKER */', 'const workerSource = ' + json.dumps((TOOL / 'force-worker.bundle.js').read_text()).replace('</', '<\\/') + ';')
    payload = base64.b64encode(gzip.compress(json.dumps(data, separators=(',', ':')).encode(), mtime=0)).decode()
    template = template.replace('/* DATA */', "(async () => { const bytes = Uint8Array.from(atob('" + payload + "'), c => c.charCodeAt(0)); const data = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());")
    template = template.replace('/* END DATA */', '})().catch(e => { document.querySelector("#details").textContent = String(e); });')
    output.write_text(template)
    print(f'{len(nodes)} functions, {len(ids)} matched, {len(edges)} inferred relationships; wrote {output}')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd(), help='Target repository root')
    parser.add_argument('--source', type=Path, default=Path('src'), help='Source directory relative to root')
    parser.add_argument('--coverage', type=Path, help='Istanbul coverage-final.json (optional)')
    parser.add_argument('--output', type=Path, default=Path('visual-crap.html'))
    parser.add_argument('--health', type=Path, help='Existing Fallow JSON instead of running Fallow')
    args = parser.parse_args()
    root = args.root.resolve()
    source = (root / args.source).resolve()
    if not source.is_dir() or not source.is_relative_to(root):
        parser.error('source must be a directory inside root')
    files = [p.relative_to(root) for p in source.rglob('*') if p.suffix in ('.ts', '.tsx', '.js', '.jsx') and not excluded(p.relative_to(root))]
    if not files:
        parser.error('no production source files found')
    try:
        from graphify.extract import extract
    except ImportError:
        parser.error('graphifyy is required: install graphifyy==0.9.97')
    previous_dir = Path.cwd()
    try:
        os.chdir(root)
        graph = extract(files, root=root, parallel=False)
    finally:
        os.chdir(previous_dir)
    if graph.get('failed_sources') or graph.get('skipped_sources'):
        raise RuntimeError(f"Graph extraction incomplete: {graph.get('failed_sources')} {graph.get('skipped_sources')}")
    if args.health:
        health = json.loads(args.health.resolve().read_text())
    else:
        cmd = ['npx', '--yes', 'fallow@3.35.0', 'health', str(source.relative_to(root)), '--production', '--format', 'json', '--max-cyclomatic', '65535', '--max-cognitive', '65535', '--max-crap', '0.1', '--report-only', '--complexity']
        if args.coverage:
            cmd += ['--coverage', str(args.coverage.resolve())]
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'fallow.json'
            patterns = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__mocks__/**', '**/__fixtures__/**', '**/testUtils/**', '**/test-utils/**', '**/tests/**', '**/fixtures/**']
            config.write_text(json.dumps({'ignorePatterns': patterns, 'health': {'ignore': patterns}}))
            cmd += ['--config', str(config)]
            health = json.loads(subprocess.check_output(cmd, cwd=root, text=True))
    build(health, graph, args.output.resolve(), root, source)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as e:
        print(f'visual-crap: {e}', file=sys.stderr)
        sys.exit(1)
