const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('force-worker.bundle.js', 'utf8');
function simulate(fileStrength, callStrength) {
    let latest;
    const context = { Float32Array, Map, Set, Math, setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {}, postMessage: (data) => { latest = data; } };
    vm.runInNewContext(source, context);
    context.onmessage({ data: { type: 'init', fileStrength, callStrength, nodes: [
        { x: 0, y: 0, anchorX: 0, anchorY: 0, treePath: ['src', 'one.ts'] },
        { x: 100, y: 0, anchorX: 100, anchorY: 0, treePath: ['src', 'one.ts'] },
    ], edges: [[0, 1, 'inferred', '']] } });
    const before = Array.from(latest.coords);
    assert.ok(!('trial' in latest) && !('optimizing' in latest));
    return { before, change(file, call) {
        context.onmessage({ data: { type: 'strengths', fileStrength: file, callStrength: call } });
        return Array.from(latest.coords);
    } };
}
const noForces = simulate(0, 0).before;
const file = simulate(2, 0).before;
const calls = simulate(0, 2).before;
assert.ok(file[2] - file[0] < noForces[2] - noForces[0], 'file attraction must move same-file nodes together');
assert.ok(calls[2] - calls[0] < noForces[2] - noForces[0], 'call springs must move connected nodes together');
const changed = simulate(0, 0);
const after = changed.change(2, 2);
assert.ok(after[2] - after[0] < changed.before[2] - changed.before[0], 'slider updates must affect the live simulation');
console.log('Force behavior passed');
