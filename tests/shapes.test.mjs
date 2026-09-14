import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../js/shapes.js', import.meta.url), 'utf8');
const {resolveShape, shapePositions} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('optional and unsupported emojis use sphere fallback', () => {
    for (const value of [undefined, null, '', ' ', '🌌', '<script>']) assert.equal(resolveShape(value), null);
    assert.equal(resolveShape(' ✈️ '), '✈');
    assert.equal(resolveShape('🏙️'), '🏙');
});

test('all layouts preserve photo count with finite distinct bounded positions', () => {
    for (const emoji of ['⭐', '🌳', '🐕', '✈️', '🏙️', '🍎']) {
        for (const count of [0, 1, 2, 25, 80]) {
            const positions = shapePositions(emoji, count, 50);
            assert.equal(positions.length, count);
            assert.equal(new Set(positions.map(p => JSON.stringify(p))).size, count);
            assert.ok(positions.flat().every(n => Number.isFinite(n) && Math.abs(n) <= 50.001));
            assert.deepEqual(positions, shapePositions(emoji, count, 50));
        }
    }
});
