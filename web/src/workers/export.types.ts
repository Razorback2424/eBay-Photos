import type { DetectionQuadPoint } from '../types/detections';

export interface ExportWorkerBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportWorkerSidePayload {
  side: 'front' | 'back';
  blob: Blob;
  width: number;
  height: number;
  bbox: ExportWorkerBoundingBox;
  quad: DetectionQuadPoint[];
  warpSize: { width: number; height: number };
}

export interface ExportWorkerPairRequest {
  format: string;
  fileExtension: string;
  quality: number;
  includeWarped: boolean;
  front?: ExportWorkerSidePayload;
  back?: ExportWorkerSidePayload;
}

export interface ExportedImagePayload {
  name: string;
  blob: Blob;
}

export interface ExportWorkerPairResult {
  images: ExportedImagePayload[];
}
