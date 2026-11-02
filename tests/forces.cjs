const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('force-worker.bundle.js', 'utf8');
function simulate(fileStrength, callStrength, options = {}) {
    let latest, scheduled;
    const context = { Float32Array, Map, Set, Math, setTimeout: fn => { scheduled = fn; return 1; }, clearTimeout: () => { scheduled = undefined; }, setInterval: () => 1, clearInterval: () => {}, postMessage: (data) => { latest = data; } };
    vm.runInNewContext(source, context);
    context.onmessage({ data: { type: 'init', fileStrength, callStrength, ...options, nodes: [
        { x: 0, y: 0, anchorX: 0, anchorY: 0, treePath: ['src', 'one.ts'] },
        { x: 100, y: 0, anchorX: 100, anchorY: 0, treePath: ['src', 'one.ts'] },
    ], edges: [[0, 1, 'inferred', '']] } });
    const before = Array.from(latest.coords);
    assert.ok(!('trial' in latest) && !('optimizing' in latest));
    return { before, get state() { return latest; }, next() {
        const callback = scheduled; scheduled = undefined;
        if (callback) callback();
        return latest;
    }, change(file, call, options = {}) {
        context.onmessage({ data: { type: 'strengths', fileStrength: file, callStrength: call, ...options } });
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
const gap = coords => coords[2] - coords[0];
assert.ok(gap(simulate(0, 0, { repulsion: 300 }).before) > gap(simulate(0, 0, { repulsion: 0 }).before), 'repulsion must separate nodes');
assert.ok(gap(simulate(0, 1, { repulsion: 0, springLength: 10 }).before) < gap(simulate(0, 1, { repulsion: 0, springLength: 120 }).before), 'spring length must change the target spacing');
const adjustRepulsion = simulate(0, 0, { repulsion: 0 });
assert.ok(gap(adjustRepulsion.change(0, 0, { repulsion: 300 })) > gap(adjustRepulsion.before), 'repulsion update must reheat the current layout');
const cool = simulate(0, 0, { repulsion: 0, coolingRate: 0.1 });
const slow = simulate(0, 0, { repulsion: 0, coolingRate: 0.005 });
assert.ok(slow.state.alpha > cool.state.alpha, 'slower cooling must retain more energy when calm');
const moving = simulate(0, 2, { repulsion: 0, springLength: 10 });
assert.equal(moving.state.coolingPaused, true, 'large movement must pause cooling');
const initialAlpha = moving.state.alpha;
let resumed = false, settled = false;
for (let i = 0; i < 3000; i++) {
    const previous = moving.state;
    const next = moving.next();
    if (previous.coolingPaused && next.coolingPaused) assert.equal(next.alpha, previous.alpha, 'energy must remain constant while movement stays high');
    if (next.alpha < initialAlpha) resumed = true;
    if (next.alpha <= 0.003) { settled = true; break; }
}
assert.ok(resumed, 'cooling must resume after motion subsides');
assert.ok(settled, 'a simple layout must eventually settle');
console.log('Force and adaptive cooling behavior passed');
