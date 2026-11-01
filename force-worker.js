// Bundled with d3-force for a self-contained offline canvas. See README for rebuild.
import { fileTreeForce } from './filetree-force.mjs';
import { forceSimulation, forceLink, forceManyBody, forceX, forceY } from 'd3-force';

let simulation, nodes, links, treeForce, timer, trial = 0, best = null, bestEnergy = Infinity, optimizing = false;
const trials = 3;
function energy() {
    // Explicit proxy: spring extension, directory-anchor attraction and local repulsion.
    // D3's integration is not an exact optimizer of this objective.
    let value = 0;
    for (const edge of links) value += .15 * (Math.hypot(edge.source.x - edge.target.x, edge.source.y - edge.target.y) - 38) ** 2;
    const cells = new Map(), size = 220;
    for (const n of nodes) {
        value += .0175 * ((n.x - n.anchorX) ** 2 + (n.y - n.anchorY) ** 2);
        const x = Math.floor(n.x / size), y = Math.floor(n.y / size);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const other of cells.get(`${x + dx},${y + dy}`) || []) {
                const d = Math.hypot(n.x - other.x, n.y - other.y);
                if (d < size) value += 16 * Math.log(size / Math.max(1, d));
            }
        }
        const key = `${x},${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(n);
    }
    return value + treeForce.energy();
}
function publish() {
    const coords = new Float32Array(nodes.length * 2);
    nodes.forEach((node, i) => { coords[i * 2] = node.x; coords[i * 2 + 1] = node.y; });
    postMessage({ type: 'positions', coords, alpha: simulation.alpha(), trial, trials, optimizing, energy: bestEnergy }, [coords.buffer]);
}
function run() {
    clearTimeout(timer);
    function step() {
        for (let i = 0; i < 3 && simulation.alpha() > 0.003; i++) simulation.tick();
        if (simulation.alpha() <= 0.003 && optimizing) {
            const candidate = energy();
            if (candidate < bestEnergy) { bestEnergy = candidate; best = nodes.map(n => [n.x, n.y]); }
            trial++;
            if (trial < trials) {
                // Deterministic perturbations explore different basins around the best layout.
                nodes.forEach((n, i) => { const a = i * 2.399963 + trial * 1.7, r = 20 + (i * 37 % 100); n.x = best[i][0] + r * Math.cos(a); n.y = best[i][1] + r * Math.sin(a); n.vx = 0; n.vy = 0; });
                simulation.alpha(1);
            } else {
                optimizing = false;
                nodes.forEach((n, i) => { n.x = best[i][0]; n.y = best[i][1]; n.vx = 0; n.vy = 0; });
            }
        }
        publish();
        if (simulation.alpha() > 0.003) timer = setTimeout(step, 0);
    }
    step();
}
onmessage = ({ data }) => {
    if (data.type === 'init') {
        nodes = data.nodes; treeForce = fileTreeForce(); links = data.edges.map(([source, target]) => ({ source, target })); trial = 0; best = null; bestEnergy = Infinity; optimizing = true;
        simulation = forceSimulation(nodes).stop()
            .force('filetree', treeForce)
            .force('links', forceLink(links).distance(38).strength(0.3))
            .force('charge', forceManyBody().strength(-16).distanceMax(220).theta(0.9))
            .force('x', forceX(d => d.anchorX).strength(0.035))
            .force('y', forceY(d => d.anchorY).strength(0.035))
            .alphaDecay(0.025);
        run();
    } else if (data.type === 'pin' && nodes?.[data.id]) {
        optimizing = false;
        nodes[data.id].fx = data.x; nodes[data.id].fy = data.y; nodes[data.id].x = data.x; nodes[data.id].y = data.y;
        simulation.alpha(Math.max(simulation.alpha(), 0.2)); run();
    } else if (data.type === 'release' && nodes?.[data.id]) {
        nodes[data.id].fx = null; nodes[data.id].fy = null;
        simulation.alpha(Math.max(simulation.alpha(), 0.15)); run();
    }
};
