import type { CardCenteringMeasurement, CardCenteringSide } from '../../types/centering';

export const CENTERING_OVERLAY_FILE_NAME = 'FRONT_CENTERING.png';

export type CenteringReviewStatus = 'auto' | 'manual';

export interface FrontCenteringExportPayload {
  fileName: typeof CENTERING_OVERLAY_FILE_NAME;
  imageWidth: number;
  imageHeight: number;
  outerEdges: Record<CardCenteringSide, number>;
  innerEdges: Record<CardCenteringSide, number>;
  bordersPx: Record<CardCenteringSide, number>;
  centering: CardCenteringMeasurement['centering'];
  warnings: string[];
  reviewStatus: CenteringReviewStatus;
}

export const estimateCenteringOverlayFiles = (pairCount: number, includeCenteringOverlay: boolean) => {
  return includeCenteringOverlay ? Math.max(0, pairCount) : 0;
};

export const toFrontCenteringExportPayload = (
  measurement: CardCenteringMeasurement,
  reviewStatus: CenteringReviewStatus
): FrontCenteringExportPayload => ({
  fileName: CENTERING_OVERLAY_FILE_NAME,
  imageWidth: measurement.image_width_px,
  imageHeight: measurement.image_height_px,
  outerEdges: measurement.outer_edges,
  innerEdges: measurement.inner_edges,
  bordersPx: measurement.borders_px,
  centering: measurement.centering,
  warnings: measurement.warnings,
  reviewStatus
});

export const buildFrontCenteringManifest = (payload: FrontCenteringExportPayload) => ({
  file: payload.fileName,
  reviewStatus: payload.reviewStatus,
  image_width_px: payload.imageWidth,
  image_height_px: payload.imageHeight,
  outer_edges: payload.outerEdges,
  inner_edges: payload.innerEdges,
  borders_px: payload.bordersPx,
  centering: payload.centering,
  warnings: payload.warnings
});
