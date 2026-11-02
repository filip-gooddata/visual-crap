// A function is one level below its file. Pair attraction is 2 / tree distance.
export function fileTreeWeight(pathA, pathB) {
    let common = 0;
    while (common < pathA.length && common < pathB.length && pathA[common] === pathB[common]) common++;
    return 2 / (pathA.length + pathB.length + 2 - 2 * common);
}

// Aggregate exactly by common ancestor and leaf depth: no quadratic pair list.
// A single global factor scales every pair equally; it does not change their ratios.
export function fileTreeForce(strength = 0.08) {
    let nodes = [], groups = [], chains = [], maxDepth = 0;
    function makeGroup(depth) {
        const group = { depth, children: new Map(), depths: new Set() };
        groups.push(group);
        return group;
    }
    function initialize(input) {
        nodes = input; groups = []; chains = []; maxDepth = Math.max(0, ...nodes.map(n => n.treePath.length + 1));
        const root = makeGroup(0);
        nodes.forEach(n => {
            const chain = [root]; let group = root;
            for (const part of n.treePath) {
                if (!group.children.has(part)) group.children.set(part, makeGroup(group.depth + 1));
                group = group.children.get(part); chain.push(group);
            }
            const leafDepth = n.treePath.length + 1;
            for (const ancestor of chain) ancestor.depths.add(leafDepth);
            chains.push(chain);
        });
        for (const group of groups) {
            group.count = new Uint32Array(maxDepth + 1);
            group.x = new Float64Array(maxDepth + 1); group.y = new Float64Array(maxDepth + 1); group.sq = new Float64Array(maxDepth + 1);
        }
        nodes.forEach((n, i) => { const d = n.treePath.length + 1; for (const group of chains[i]) group.count[d]++; });
    }
    function accumulate() {
        for (const g of groups) { g.x.fill(0); g.y.fill(0); g.sq.fill(0); }
        nodes.forEach((n, i) => { const d = n.treePath.length + 1, sq = n.x*n.x + n.y*n.y; for (const g of chains[i]) { g.x[d] += n.x; g.y[d] += n.y; g.sq[d] += sq; } });
    }
    function apply(alpha, potential) {
        if (!nodes.length) return 0;
        accumulate(); let total = 0;
        nodes.forEach((n, i) => {
            const chain = chains[i], leaf = n.treePath.length + 1; let fx = 0, fy = 0;
            for (let level = 0; level < chain.length; level++) {
                const group = chain[level], child = chain[level + 1];
                for (const otherDepth of group.depths) {
                    const self = !child && otherDepth === leaf ? 1 : 0;
                    const count = group.count[otherDepth] - (child?.count[otherDepth] || 0) - self;
                    if (!count) continue;
                    const sx = group.x[otherDepth] - (child?.x[otherDepth] || 0) - self*n.x;
                    const sy = group.y[otherDepth] - (child?.y[otherDepth] || 0) - self*n.y;
                    const weight = 2 / (leaf + otherDepth - 2*group.depth);
                    fx += weight*(sx-count*n.x); fy += weight*(sy-count*n.y);
                    if (potential) {
                        const sq = group.sq[otherDepth] - (child?.sq[otherDepth] || 0) - self*(n.x*n.x+n.y*n.y);
                        total += weight*(sq-2*n.x*sx-2*n.y*sy+count*(n.x*n.x+n.y*n.y));
                    }
                }
            }
            if (!potential) { n.vx += alpha*strength/nodes.length*fx; n.vy += alpha*strength/nodes.length*fy; }
        });
        return strength/(4*nodes.length)*total;
    }
    function force(alpha) { apply(alpha, false); }
    force.initialize = initialize;
    force.strength = value => { strength = value; return force; };
    force.energy = () => apply(0, true);
    return force;
}
