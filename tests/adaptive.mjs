import assert from 'node:assert/strict';
import { createMotionTracker, movementThreshold, coolingFactor } from '../adaptive-motion.mjs';
assert.equal(coolingFactor(0, 1), 1);
assert.equal(coolingFactor(0.5, 1), 0.25);
assert.equal(coolingFactor(1, 1), 0);
assert.equal(coolingFactor(2, 1), 0);
assert.equal(movementThreshold(1), 1);
assert.ok(movementThreshold(0.01) < movementThreshold(1));
assert.ok(movementThreshold(0.000001) >= 0.01);
function scenario(oscillating) {
    const node = {x: 0, y: 0, vx: 0, vy: 0};
    const tracker = createMotionTracker([node]);
    let stats;
    for (let i = 0; i < 30; i++) {
        node.vx = node.vy = 0;
        tracker.capture();
        const force = oscillating && i % 2 ? -100 : 100;
        node.vx = force * 0.15;
        stats = tracker.measure(1, 0.85);
    }
    return { ...stats, speed: Math.abs(node.vx) };
}
const steady = scenario(false), oscillating = scenario(true);
assert.ok(oscillating.swinging > steady.swinging, 'reversing forces must register as swinging');
assert.ok(oscillating.traction < steady.traction, 'aligned forces must have more traction');
assert.ok(oscillating.damping > steady.damping, 'oscillation must increase damping');
assert.ok(oscillating.speed < steady.speed, 'oscillation must reduce local next-step speed');
const crowd = Array.from({length: 1000}, () => ({x: 0, y: 0, vx: 0, vy: 0}));
const tracker = createMotionTracker(crowd);
tracker.capture();
crowd[0].x = 2;
assert.equal(tracker.measure(1, 0.85).movement, 2, 'one moving node must not be diluted by a stationary crowd');
console.log('Adaptive motion behavior passed');
