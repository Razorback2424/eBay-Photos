export type CardCenteringSide = 'left' | 'top' | 'right' | 'bottom';

export type CardCenteringEdges = Record<CardCenteringSide, CardCenteringEdgeResult>;

export type CardCenteringWarning = string;

export interface CardCenteringEdgeResult {
  name: string;
  position: number;
  samples: number[];
  sample_strengths: number[];
  median_strength: number;
  baseline: number;
  confidence_ratio: number;
  consistency_px: number;
  method: string;
}

export interface CardCenteringMeasurement {
  image_width_px: number;
  image_height_px: number;
  outer_edges: Record<CardCenteringSide, number>;
  inner_edges: Record<CardCenteringSide, number>;
  borders_px: Record<CardCenteringSide, number>;
  centering: {
    left_right: string;
    top_bottom: string;
  };
  edge_diagnostics: Record<string, CardCenteringEdgeResult>;
  warnings: CardCenteringWarning[];
  rotation_degrees: number;
}

export interface CardCenteringImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface CardCenteringDetectionResult {
  outer: CardCenteringEdges;
  inner: CardCenteringEdges;
  measurement: CardCenteringMeasurement;
}
