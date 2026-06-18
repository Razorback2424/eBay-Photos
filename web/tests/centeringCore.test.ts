import assert from 'node:assert/strict';

import {
  buildCenteringMeasurement,
  buildEdgesFromPositions,
  cropForZoom,
  detectAxisAlignedCenteringEdges,
  normalizeRotationDegrees,
  rotationIsStale
} from '../src/utils/centering/centeringCore';

const syntheticCardWithDistractors = () => {
  const width = 260;
  const height = 360;
  const data = new Uint8ClampedArray(width * height * 4);

  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    const offset = (y * width + x) * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  };

  const fillRect = (left: number, top: number, right: number, bottom: number, color: [number, number, number]) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        setPixel(x, y, color[0], color[1], color[2]);
      }
    }
  };

  fillRect(0, 0, width - 1, height - 1, [245, 245, 245]);
  fillRect(20, 18, 240, 340, [230, 230, 210]);
  fillRect(48, 50, 212, 306, [130, 170, 210]);

  fillRect(20, 0, 21, height - 1, [40, 40, 40]);
  fillRect(240, 0, 241, height - 1, [40, 40, 40]);
  fillRect(0, 18, width - 1, 19, [40, 40, 40]);
  fillRect(0, 340, width - 1, 341, [40, 40, 40]);

  fillRect(48, 0, 49, height - 1, [95, 120, 150]);
  fillRect(212, 0, 213, height - 1, [95, 120, 150]);
  fillRect(0, 50, width - 1, 51, [95, 120, 150]);
  fillRect(0, 306, width - 1, 307, [95, 120, 150]);

  fillRect(103, 70, 105, 286, [0, 0, 0]);
  fillRect(154, 70, 157, 286, [0, 0, 0]);
  for (const y of [258, 270, 282]) {
    fillRect(60, y, 200, y + 1, [0, 0, 0]);
  }

  return { width, height, data };
};

const near = (actual: number, expected: number, tolerance: number, label: string) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${actual} to be within ${tolerance}px of ${expected}`);
};

{
  const image = syntheticCardWithDistractors();
  const { outer, inner } = detectAxisAlignedCenteringEdges(image);

  near(outer.left.position, 20, 8, 'outer left');
  near(outer.right.position, 240, 8, 'outer right');
  near(outer.top.position, 18, 8, 'outer top');
  near(outer.bottom.position, 340, 8, 'outer bottom');
  near(inner.left.position, 48, 8, 'inner left');
  near(inner.right.position, 212, 8, 'inner right');
  near(inner.top.position, 50, 8, 'inner top');
  near(inner.bottom.position, 306, 8, 'inner bottom');
}

{
  const image = syntheticCardWithDistractors();
  const outer = buildEdgesFromPositions('outer', { left: 20, top: 18, right: 240, bottom: 340 });
  const inner = buildEdgesFromPositions('inner', { left: 48, top: 50, right: 212, bottom: 308 });
  const measurement = buildCenteringMeasurement(image, outer, inner, 1.234);

  assert.equal(measurement.centering.left_right, '50.0/50.0');
  assert.equal(measurement.centering.top_bottom, '50.0/50.0');
  assert.equal(measurement.rotation_degrees, 1.23);
  assert.deepEqual(measurement.warnings, []);
}

{
  const image = syntheticCardWithDistractors();
  const { outer, inner } = detectAxisAlignedCenteringEdges(image);
  const measurement = buildCenteringMeasurement(
    image,
    outer,
    {
      ...inner,
      left: { ...inner.left, position: outer.left.position - 2 }
    },
    0
  );

  assert.ok(measurement.warnings.some((warning) => warning.includes('Horizontal edge order is suspicious')));
  assert.ok(measurement.warnings.some((warning) => warning.includes('left border measured as -2px')));
}

{
  assert.equal(normalizeRotationDegrees(1.236), 1.24);
  assert.equal(rotationIsStale(0.01, 0), true);
  assert.equal(rotationIsStale(0.004, 0), false);
}

{
  assert.deepEqual(cropForZoom({ width: 100, height: 80 }, 1, 0, 0), { x: 0, y: 0, width: 100, height: 80 });
  assert.deepEqual(cropForZoom({ width: 100, height: 80 }, 2, 100, 50), { x: 50, y: 20, width: 50, height: 40 });
}

console.log('centering core tests passed');
