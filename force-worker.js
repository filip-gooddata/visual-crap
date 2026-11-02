// Bundled with d3-force for a self-contained offline canvas. See README for rebuild.
import { fileTreeForce } from './filetree-force.mjs';
import { createMotionTracker, movementThreshold, coolingFactor } from './adaptive-motion.mjs';
import { forceSimulation, forceLink, forceManyBody, forceX, forceY } from 'd3-force';

let simulation, nodes, treeForce, linkForce, chargeForce, anchorX, anchorY, timer, tracker, linkWeights, movement = 0, threshold = 1, damping = 0.85;
const coolingRate = 0.01;
function publish() {
    const coords = new Float32Array(nodes.length * 2);
    nodes.forEach((node, i) => { coords[i * 2] = node.x; coords[i * 2 + 1] = node.y; });
    postMessage({ type: 'positions', coords, alpha: simulation.alpha(), movement, threshold, damping, coolingPaused: movement > threshold }, [coords.buffer]);
}
function run() {
    clearTimeout(timer);
    function step() {
        for (let i = 0; i < 3 && simulation.alpha() > 0.003; i++) {
            const alpha = simulation.alpha();
            tracker.capture();
            simulation.tick();
            const motion = tracker.measure(alpha, damping);
            movement = motion.movement; threshold = movementThreshold(alpha);
            // When a moving outlier holds cooling, increase damping gradually;
            // ease it back only after motion is under the threshold.
            damping = movement > threshold * 0.5
                ? Math.min(0.99, Math.max(motion.damping, damping + 0.005))
                : Math.max(motion.damping, damping - 0.005);
            simulation.velocityDecay(damping);
            simulation.alpha(alpha * (1 - coolingRate * coolingFactor(movement, threshold)));
        }
        publish();
        if (simulation.alpha() > 0.003) timer = setTimeout(step, 0);
    }
    step();
}
function setForces({fileStrength: file, callStrength: calls, repulsion = 100, springLength = 38}) {
    treeForce.strength(0.02 * file);
    anchorX.strength(0.005 * file);
    anchorY.strength(0.005 * file);
    linkForce.strength(edge => 0.3 * calls * linkWeights[edge.index]).distance(springLength);
    chargeForce.strength(-16 * repulsion / 100);
}
onmessage = ({ data }) => {
    if (data.type === 'init') {
        nodes = data.nodes; tracker = createMotionTracker(nodes); damping = 0.85;
        treeForce = fileTreeForce();
        const weights = {call: 1, construct: 1, render: 1, inferred: 0.35, passed: 0.15, prop: 0.15, configured: 0.15, returned: 0.15, default: 0.15, entry: 0.04};
        const neighbors = nodes.map(() => new Set());
        for (const [a, b] of data.edges) if (a !== b) { neighbors[a].add(b); neighbors[b].add(a); }
        linkWeights = data.edges.map(([a, b, kind]) => (weights[kind] ?? 0.15) / Math.sqrt(Math.max(1, Math.max(neighbors[a].size, neighbors[b].size) / 4)));
        linkForce = forceLink(data.edges.map(([source, target]) => ({ source, target })));
        chargeForce = forceManyBody().distanceMax(220).theta(0.9);
        anchorX = forceX(d => d.anchorX);
        anchorY = forceY(d => d.anchorY);
        setForces(data);
        simulation = forceSimulation(nodes).stop()
            .force('filetree', treeForce)
            .force('links', linkForce)
            .force('charge', chargeForce)
            .force('communityX', forceX(d => d.communityX ?? d.anchorX).strength(0.02))
            .force('communityY', forceY(d => d.communityY ?? d.anchorY).strength(0.02))
            .force('x', anchorX)
            .force('y', anchorY)
            .velocityDecay(0.85)
            .alphaDecay(0);
        run();
    } else if (data.type === 'strengths' && simulation) {
        setForces(data); tracker.reset();
        simulation.alpha(Math.max(simulation.alpha(), 0.3)); run();
    } else if (data.type === 'pin' && nodes?.[data.id]) {
        tracker.reset();
        nodes[data.id].fx = data.x; nodes[data.id].fy = data.y; nodes[data.id].x = data.x; nodes[data.id].y = data.y;
        simulation.alpha(Math.max(simulation.alpha(), 0.2)); run();
    } else if (data.type === 'release' && nodes?.[data.id]) {
        tracker.reset();
        nodes[data.id].fx = null; nodes[data.id].fy = null;
        simulation.alpha(Math.max(simulation.alpha(), 0.15)); run();
    }
};
