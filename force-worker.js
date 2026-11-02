// Bundled with d3-force for a self-contained offline canvas. See README for rebuild.
import { fileTreeForce } from './filetree-force.mjs';
import { forceSimulation, forceLink, forceManyBody, forceX, forceY } from 'd3-force';

let simulation, nodes, treeForce, linkForce, chargeForce, anchorX, anchorY, timer;
function publish() {
    const coords = new Float32Array(nodes.length * 2);
    nodes.forEach((node, i) => { coords[i * 2] = node.x; coords[i * 2 + 1] = node.y; });
    postMessage({ type: 'positions', coords, alpha: simulation.alpha() }, [coords.buffer]);
}
function run() {
    clearTimeout(timer);
    function step() {
        for (let i = 0; i < 3 && simulation.alpha() > 0.003; i++) simulation.tick();
        publish();
        if (simulation.alpha() > 0.003) timer = setTimeout(step, 0);
    }
    step();
}
function setForces({fileStrength: file, callStrength: calls, repulsion = 100, springLength = 38}) {
    treeForce.strength(0.08 * file);
    anchorX.strength(0.035 * file);
    anchorY.strength(0.035 * file);
    linkForce.strength(0.3 * calls).distance(springLength);
    chargeForce.strength(-16 * repulsion / 100);
}
onmessage = ({ data }) => {
    if (data.type === 'init') {
        nodes = data.nodes;
        treeForce = fileTreeForce();
        linkForce = forceLink(data.edges.map(([source, target]) => ({ source, target })));
        chargeForce = forceManyBody().distanceMax(220).theta(0.9);
        anchorX = forceX(d => d.anchorX);
        anchorY = forceY(d => d.anchorY);
        setForces(data);
        simulation = forceSimulation(nodes).stop()
            .force('filetree', treeForce)
            .force('links', linkForce)
            .force('charge', chargeForce)
            .force('x', anchorX)
            .force('y', anchorY)
            .alphaDecay(data.coolingRate ?? 0.025);
        run();
    } else if (data.type === 'strengths' && simulation) {
        setForces(data);
        simulation.alphaDecay(data.coolingRate ?? 0.025).alpha(Math.max(simulation.alpha(), 0.3)); run();
    } else if (data.type === 'pin' && nodes?.[data.id]) {
        nodes[data.id].fx = data.x; nodes[data.id].fy = data.y; nodes[data.id].x = data.x; nodes[data.id].y = data.y;
        simulation.alpha(Math.max(simulation.alpha(), 0.2)); run();
    } else if (data.type === 'release' && nodes?.[data.id]) {
        nodes[data.id].fx = null; nodes[data.id].fy = null;
        simulation.alpha(Math.max(simulation.alpha(), 0.15)); run();
    }
};
