import type { CardCenteringMeasurement } from '../../types/centering';

export const getRotatedSize = (width: number, height: number, rotationDegrees: number) => {
  const radians = (rotationDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  return {
    width: Math.max(1, Math.ceil(width * cos + height * sin)),
    height: Math.max(1, Math.ceil(width * sin + height * cos))
  };
};

export const drawCenteringGuideLines = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  measurement: CardCenteringMeasurement,
  renderWidth: number,
  renderHeight: number
) => {
  const scaleX = renderWidth / Math.max(1, measurement.image_width_px);
  const scaleY = renderHeight / Math.max(1, measurement.image_height_px);
  const outer = measurement.outer_edges;
  const inner = measurement.inner_edges;

  ctx.lineWidth = Math.max(2, Math.round(Math.min(renderWidth, renderHeight) * 0.004));
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.95)';
  ctx.beginPath();
  ctx.moveTo(outer.left * scaleX, 0);
  ctx.lineTo(outer.left * scaleX, renderHeight);
  ctx.moveTo(outer.right * scaleX, 0);
  ctx.lineTo(outer.right * scaleX, renderHeight);
  ctx.moveTo(0, outer.top * scaleY);
  ctx.lineTo(renderWidth, outer.top * scaleY);
  ctx.moveTo(0, outer.bottom * scaleY);
  ctx.lineTo(renderWidth, outer.bottom * scaleY);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(6, 182, 212, 0.95)';
  ctx.beginPath();
  ctx.moveTo(inner.left * scaleX, 0);
  ctx.lineTo(inner.left * scaleX, renderHeight);
  ctx.moveTo(inner.right * scaleX, 0);
  ctx.lineTo(inner.right * scaleX, renderHeight);
  ctx.moveTo(0, inner.top * scaleY);
  ctx.lineTo(renderWidth, inner.top * scaleY);
  ctx.moveTo(0, inner.bottom * scaleY);
  ctx.lineTo(renderWidth, inner.bottom * scaleY);
  ctx.stroke();
};
