export interface DetectionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DetectionQuadPoint = [number, number];

export interface DetectedCard {
  bbox: DetectionBoundingBox;
  quad: DetectionQuadPoint[];
  centerNorm: [number, number];
  warpSize: {
    width: number;
    height: number;
  };
}
