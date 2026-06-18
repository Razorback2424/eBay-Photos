import assert from 'node:assert/strict';

import {
  CENTERING_OVERLAY_FILE_NAME,
  buildFrontCenteringManifest,
  estimateCenteringOverlayFiles,
  toFrontCenteringExportPayload
} from '../src/utils/centering/exportLinkage';
import { buildCenteringMeasurement, buildEdgesFromPositions } from '../src/utils/centering/centeringCore';

const measurement = buildCenteringMeasurement(
  { width: 300, height: 420 },
  buildEdgesFromPositions('outer', { left: 12, top: 18, right: 288, bottom: 400 }),
  buildEdgesFromPositions('inner', { left: 42, top: 58, right: 250, bottom: 360 }),
  0
);

{
  assert.equal(CENTERING_OVERLAY_FILE_NAME, 'FRONT_CENTERING.png');
  assert.equal(estimateCenteringOverlayFiles(3, false), 0);
  assert.equal(estimateCenteringOverlayFiles(3, true), 3);
}

{
  const payload = toFrontCenteringExportPayload(measurement, 'manual');
  assert.equal(payload.fileName, 'FRONT_CENTERING.png');
  assert.equal(payload.reviewStatus, 'manual');
  assert.deepEqual(payload.outerEdges, measurement.outer_edges);
  assert.deepEqual(payload.innerEdges, measurement.inner_edges);
}

{
  const manifest = buildFrontCenteringManifest(toFrontCenteringExportPayload(measurement, 'auto'));
  assert.equal(manifest.file, 'FRONT_CENTERING.png');
  assert.equal(manifest.reviewStatus, 'auto');
  assert.equal(manifest.centering.left_right, measurement.centering.left_right);
  assert.deepEqual(manifest.borders_px, measurement.borders_px);
}

console.log('centering export linkage tests passed');
