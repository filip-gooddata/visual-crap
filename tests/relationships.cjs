const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-crap-relations-'));
try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({exports: {'.': {source:'./src/main.tsx'}}}));
    fs.symlinkSync(process.env.TYPESCRIPT_DIR, path.join(dir, 'node_modules/typescript'), 'dir');
    fs.writeFileSync(path.join(dir, 'src/main.tsx'), [
        'export function leaf() { return 1; }',
        'export function Component() { return null; }',
        'export function caller() { leaf(); return <Component onClick={leaf} />; }',
        'export function pass() { register(leaf); }',
        'leaf();',
        'export function Holder() { return null; }',
        'Holder.Child = Component;',
        'export function view() { return <Holder.Child />; }',
        'export function factory() { return ({ callback: leaf } as any); }',
        'export class Factory { constructor() {} }',
        'export function create() { return new Factory(); }',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'src/main.test.ts'), 'function testCaller() { leaf(); }');
    const findings = ['leaf','Component','caller','pass','Holder','view','factory'].map((name,i) => ({path:'src/main.tsx',line:[1,2,3,4,6,8,9][i],col:7,name}));
    findings.push({path:'src/main.tsx',line:10,col:'export class Factory { constructor() {} }'.indexOf('('),name:'constructor'});
    findings.push({path:'src/main.tsx',line:11,col:7,name:'create'});
    const result = cp.spawnSync('node', [path.resolve('ts-relations.cjs')], {input:JSON.stringify({root:dir,source:path.join(dir,'src'),findings,files:['src/main.tsx','src/main.test.ts']}),encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.matched, 9);
    assert.ok(data.edges.some(([a,b,kind]) => a?.boundary === 'module' && b === 0 && kind === 'call'), 'module initialization call is a boundary');
    assert.ok(data.edges.some(([a,b,kind]) => a?.boundary === 'entry' && b === 0 && kind === 'entry'), 'package entry export must be identified');
    const kinds = data.edges.map(([a,b,kind]) => `${a}-${b}-${kind}`);
    for (const edge of ['2-0-call','2-1-render','2-0-prop','3-0-passed','5-1-render','6-0-returned','8-7-construct']) assert.ok(kinds.includes(edge), `${edge}: ${kinds}`);
    assert.ok(!kinds.includes('3-0-call'), 'passing a function is not a call');
    assert.ok(data.edges.every(e => !e[3].includes('test')), 'test sites must be excluded');
    console.log('TypeScript relationships passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
