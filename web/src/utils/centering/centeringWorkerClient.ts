import { releaseProxy, wrap } from 'comlink';
import type { Endpoint } from 'comlink';

import type { CardCenteringDetectionResult, CardCenteringMeasurement, CardCenteringSide } from '../../types/centering';

const workerUrl = new URL('../../workers/centering.worker.ts', import.meta.url);

export type CenteringWorker = {
  measureImage: (blob: Blob, rotationDegrees?: number) => Promise<CardCenteringDetectionResult>;
  buildManualMeasurement: (
    width: number,
    height: number,
    outerPositions: Record<CardCenteringSide, number>,
    innerPositions: Record<CardCenteringSide, number>,
    rotationDegrees?: number
  ) => Promise<CardCenteringMeasurement>;
  [releaseProxy]?: () => void;
};

export const createCenteringWorker = () => {
  const instance = new Worker(workerUrl, { type: 'module' });
  return {
    instance,
    worker: wrap<CenteringWorker>(instance as unknown as Endpoint)
  };
};

export const disposeCenteringWorker = (current: ReturnType<typeof createCenteringWorker> | null) => {
  if (current?.worker[releaseProxy]) {
    current.worker[releaseProxy]!();
  }
  current?.instance.terminate();
};
