// Blend measured scores in log-score space, weighting high risk more heavily.
function buildHeat(nodes, positions, ox, oy, scale, width, height, cellSize = 3, radius = 18) {
    const cols = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize), count = cols * rows;
    const scores = new Float32Array(count).fill(-1);
    const density = new Float32Array(count), weightedRisk = new Float32Array(count), influence = new Float32Array(count);
    const unknownDensity = new Float32Array(count);
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].boundary) continue;
        const x = positions[i].x * scale + ox, y = positions[i].y * scale + oy;
        const left = Math.max(0, Math.floor((x - radius) / cellSize));
        const right = Math.min(cols - 1, Math.floor((x + radius) / cellSize));
        const top = Math.max(0, Math.floor((y - radius) / cellSize));
        const bottom = Math.min(rows - 1, Math.floor((y + radius) / cellSize));
        const n = nodes[i], measured = (n.coverage_source === 'istanbul' || n.coverage_source === 'measured') && Number.isFinite(n.crap) && n.crap >= 0;
        const risk = measured ? Math.min(1, Math.log1p(n.crap) / Math.log(101)) : 0;
        const bias = 1 + 100 * risk * risk;
        for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) {
            const distance = Math.hypot((cx + .5) * cellSize - x, (cy + .5) * cellSize - y);
            if (distance > radius) continue;
            const index = cy * cols + cx, kernel = (1 - (distance / radius) ** 2) ** 2;
            if (!measured) unknownDensity[index] += kernel;
            else {
                density[index] += kernel;
                influence[index] += kernel * bias;
                weightedRisk[index] += kernel * bias * risk;
            }
        }
    }
    for (let i = 0; i < count; i++) {
        if (influence[i] > 0) scores[i] = Math.expm1(weightedRisk[i] / influence[i] * Math.log(101));
    }
    return { cols, rows, scores, density, unknownDensity };
}
if (typeof module !== 'undefined') module.exports = { buildHeat };
