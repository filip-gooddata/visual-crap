// ForceAtlas2-inspired measures: changes in force indicate swinging; aligned
// forces indicate traction. This adapts D3 damping, not the ForceAtlas2 layout.
export function movementThreshold(alpha) {
    return Math.max(0.01, Math.sqrt(Math.max(0, alpha)));
}

export function createMotionTracker(nodes) {
    const previousX = new Float64Array(nodes.length), previousY = new Float64Array(nodes.length);
    const velocityX = new Float64Array(nodes.length), velocityY = new Float64Array(nodes.length);
    let initialized = false, smoothedRatio = 0, damping = 0.85;
    return {
        capture() {
            for (let i = 0; i < nodes.length; i++) {
                velocityX[i] = nodes[i].vx; velocityY[i] = nodes[i].vy;
            }
        },
        measure(alpha, previousDamping) {
            let movementSquared = 0, swinging = 0, traction = 0, count = 0;
            const retention = 1 - previousDamping;
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (n.fx != null || n.fy != null) { previousX[i] = previousY[i] = 0; continue; }
                const x = (n.vx / retention - velocityX[i]) / alpha;
                const y = (n.vy / retention - velocityY[i]) / alpha;
                movementSquared += n.vx * n.vx + n.vy * n.vy; count++;
                if (initialized) {
                    const swing = Math.hypot(x - previousX[i], y - previousY[i]);
                    swinging += swing;
                    traction += Math.hypot(x + previousX[i], y + previousY[i]) / 2;
                    // Limit only the next step of nodes whose force direction changes abruptly.
                    const local = Math.max(0.5, 1 / (1 + 0.05 * Math.sqrt(swing)));
                    n.vx *= local; n.vy *= local;
                }
                previousX[i] = x; previousY[i] = y;
            }
            initialized = true;
            const ratio = Math.min(4, swinging / Math.max(traction, 1e-9));
            smoothedRatio = 0.9 * smoothedRatio + 0.1 * ratio;
            // Adapt slowly to avoid abrupt layout changes; higher swinging adds friction.
            const target = 0.75 + 0.20 * Math.min(1, smoothedRatio);
            damping += Math.max(-0.01, Math.min(0.01, target - damping));
            return { movement: count ? Math.sqrt(movementSquared / count) : 0, swinging, traction, damping };
        },
        reset() { initialized = false; smoothedRatio = 0; },
    };
}
