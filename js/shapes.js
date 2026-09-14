// Deliberately designed outlines, sampled in world space with shallow depth.
// Emoji glyph rendering varies by OS; these layouts do not depend on fonts.
const outlines = {
    '🌳': [[-.2,-1],[-.2,-.35],[-.8,-.35],[-.5,.05],[-.85,.05],[-.45,.5],[-.6,.5],[0,1],[.6,.5],[.45,.5],[.85,.05],[.5,.05],[.8,-.35],[.2,-.35],[.2,-1]],
    '🐕': [[-.8,.1],[-1,.55],[-.7,.4],[-.55,.15],[.2,.15],[.3,.65],[.55,1],[.65,.65],[1,.5],[.95,.3],[.6,.25],[.5,-.3],[.5,-.9],[.25,-.9],[.2,-.35],[-.35,-.35],[-.45,-.9],[-.7,-.9],[-.65,-.25]],
    '✈': [[0,1],[.15,.35],[1,-.15],[1,-.35],[.15,-.05],[.12,-.65],[.45,-.85],[.45,-1],[0,-.85],[-.45,-1],[-.45,-.85],[-.12,-.65],[-.15,-.05],[-1,-.35],[-1,-.15],[-.15,.35]],
    '🏙': [[-1,-1],[-1,.2],[-.6,.2],[-.6,.65],[-.2,.65],[-.2,1],[.15,1],[.15,.1],[.5,.1],[.5,.6],[.85,.6],[.85,-1]],
    '🍎': [[0,.65],[.25,1],[.55,.95],[.25,.65],[.65,.65],[.95,.3],[.9,-.25],[.65,-.8],[.3,-1],[0,-.85],[-.3,-1],[-.65,-.8],[-.9,-.25],[-.95,.3],[-.65,.65],[-.25,.65]],
};
outlines['⭐'] = Array.from({length: 10}, (_, i) => {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .42 : 1;
    return [Math.cos(a) * r, Math.sin(a) * r];
});

export function resolveShape(emoji) {
    const key = typeof emoji === 'string' ? emoji.trim().replace(/[\uFE0E\uFE0F]/g, '') : '';
    return Object.hasOwn(outlines, key) ? key : null;
}

export function shapePositions(emoji, count, radius) {
    const points = outlines[resolveShape(emoji)];
    if (!points || count <= 0) return [];
    const lengths = points.map((p, i) => Math.hypot(p[0] - points[(i+1)%points.length][0], p[1] - points[(i+1)%points.length][1]));
    const perimeter = lengths.reduce((a,b) => a+b, 0);
    return Array.from({length: count}, (_, i) => {
        let d = i * perimeter / count, edge = 0;
        while (edge < lengths.length - 1 && d > lengths[edge]) d -= lengths[edge++];
        const p = points[edge], q = points[(edge+1)%points.length], t = d / lengths[edge];
        return [(p[0]+(q[0]-p[0])*t)*radius, (p[1]+(q[1]-p[1])*t)*radius,
            Math.sin(i * Math.PI * 4 / count) * radius * .12];
    });
}
