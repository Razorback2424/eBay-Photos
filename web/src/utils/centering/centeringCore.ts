import type {
  CardCenteringEdgeResult,
  CardCenteringEdges,
  CardCenteringImageDataLike,
  CardCenteringMeasurement,
  CardCenteringSide
} from '../../types/centering';

export const SMALLEST_ROTATION_STEP = 0.01;
export const ROTATION_EPSILON = SMALLEST_ROTATION_STEP / 2;

type Matrix = Float32Array[];
type Candidate = [number, number];

const SIDES: CardCenteringSide[] = ['left', 'top', 'right', 'bottom'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

const smooth1d = (values: number[], radius = 2) => {
  if (radius <= 0) return values;
  return values.map((_, index) => {
    const lo = Math.max(0, index - radius);
    const hi = Math.min(values.length, index + radius + 1);
    let sum = 0;
    for (let i = lo; i < hi; i += 1) sum += values[i];
    return sum / (hi - lo);
  });
};

const localPeaks = (scores: number[]) => {
  if (scores.length < 3) return scores.map((_, index) => index);
  const peaks: number[] = [];
  if (scores[0] >= scores[1]) peaks.push(0);
  for (let i = 1; i < scores.length - 1; i += 1) {
    if (scores[i] >= scores[i - 1] && scores[i] >= scores[i + 1]) {
      peaks.push(i);
    }
  }
  if (scores[scores.length - 1] >= scores[scores.length - 2]) peaks.push(scores.length - 1);
  return peaks;
};

const scoreBaseline = (scores: number[]) => {
  const med = median(scores);
  const mad = median(scores.map((value) => Math.abs(value - med)));
  const mx = Math.max(...scores, 0);
  return { med, mad, mx };
};

const pivotRgb = (value: number) => {
  const normalized = value / 255;
  return normalized > 0.04045 ? ((normalized + 0.055) / 1.055) ** 2.4 : normalized / 12.92;
};

const pivotXyz = (value: number) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);

const rgbToLab = (r: number, g: number, b: number): [number, number, number] => {
  const rr = pivotRgb(r);
  const gg = pivotRgb(g);
  const bb = pivotRgb(b);
  const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  const y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.0;
  const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
  const fx = pivotXyz(x);
  const fy = pivotXyz(y);
  const fz = pivotXyz(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const labDistance = (a: [number, number, number], b: [number, number, number]) => {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

const labGradients = (image: CardCenteringImageDataLike) => {
  const labs: [number, number, number][] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      labs.push(rgbToLab(image.data[offset], image.data[offset + 1], image.data[offset + 2]));
    }
  }

  const gx: Matrix = Array.from({ length: image.height }, () => new Float32Array(Math.max(1, image.width - 1)));
  const gy: Matrix = Array.from({ length: Math.max(1, image.height - 1) }, () => new Float32Array(image.width));

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width - 1; x += 1) {
      gx[y][x] = labDistance(labs[y * image.width + x], labs[y * image.width + x + 1]);
    }
  }
  for (let y = 0; y < image.height - 1; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      gy[y][x] = labDistance(labs[y * image.width + x], labs[(y + 1) * image.width + x]);
    }
  }

  return { gx, gy };
};

const axisScoresVertical = (gx: Matrix, x0Raw: number, x1Raw: number, y0Raw: number, y1Raw: number) => {
  const height = gx.length;
  const widthMinusOne = gx[0]?.length ?? 1;
  const x0 = clamp(Math.round(x0Raw), 0, Math.max(0, widthMinusOne - 1));
  const x1 = clamp(Math.round(x1Raw), x0 + 1, widthMinusOne);
  const y0 = clamp(Math.round(y0Raw), 0, Math.max(0, height - 1));
  const y1 = clamp(Math.round(y1Raw), y0 + 1, height);
  const scores: number[] = [];
  for (let x = x0; x < x1; x += 1) {
    let sum = 0;
    for (let y = y0; y < y1; y += 1) sum += gx[y][x];
    scores.push(sum / (y1 - y0));
  }
  return { scores, start: x0 };
};

const axisScoresHorizontal = (gy: Matrix, y0Raw: number, y1Raw: number, x0Raw: number, x1Raw: number) => {
  const heightMinusOne = gy.length;
  const width = gy[0]?.length ?? 1;
  const y0 = clamp(Math.round(y0Raw), 0, Math.max(0, heightMinusOne - 1));
  const y1 = clamp(Math.round(y1Raw), y0 + 1, heightMinusOne);
  const x0 = clamp(Math.round(x0Raw), 0, Math.max(0, width - 1));
  const x1 = clamp(Math.round(x1Raw), x0 + 1, width);
  const scores: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    let sum = 0;
    for (let x = x0; x < x1; x += 1) sum += gy[y][x];
    scores.push(sum / (x1 - x0));
  }
  return { scores, start: y0 };
};

const peakCandidates = (scores: number[], startIndex: number, minPeakFraction = 0.12, madMultiplier = 1.2) => {
  const smoothed = smooth1d(scores, 2);
  const peaks = localPeaks(smoothed);
  const { med, mad, mx } = scoreBaseline(smoothed);
  const threshold = Math.max(med + madMultiplier * Math.max(mad, 1e-6), minPeakFraction * mx);
  const refined = new Map<number, number>();

  for (const peak of peaks) {
    if (smoothed[peak] < threshold) continue;
    const lo = Math.max(0, peak - 2);
    const hi = Math.min(scores.length, peak + 3);
    let rawIndex = lo;
    for (let i = lo + 1; i < hi; i += 1) {
      if (scores[i] > scores[rawIndex]) rawIndex = i;
    }
    const pos = startIndex + rawIndex;
    const strength = scores[rawIndex];
    if (!refined.has(pos) || strength > refined.get(pos)!) {
      refined.set(pos, strength);
    }
  }

  if (refined.size === 0) {
    let maxIndex = 0;
    for (let i = 1; i < scores.length; i += 1) {
      if (scores[i] > scores[maxIndex]) maxIndex = i;
    }
    refined.set(startIndex + maxIndex, scores[maxIndex]);
  }

  return {
    candidates: Array.from(refined.entries()).sort((a, b) => a[0] - b[0]) as Candidate[],
    baseline: med
  };
};

const chooseCandidateByMode = (candidates: Candidate[], mode: 'first' | 'last' | 'strongest') => {
  if (mode === 'first') return candidates.reduce((best, item) => (item[0] < best[0] ? item : best), candidates[0]);
  if (mode === 'last') return candidates.reduce((best, item) => (item[0] > best[0] ? item : best), candidates[0]);
  return candidates.reduce((best, item) => (item[1] > best[1] ? item : best), candidates[0]);
};

const makeGlobalEdgeResult = (
  name: string,
  position: number,
  strength: number,
  candidates: Candidate[],
  baseline: number,
  method: string
): CardCenteringEdgeResult => {
  const sorted = [...candidates].sort((a, b) => a[0] - b[0]);
  return {
    name,
    position: Math.round(position),
    samples: sorted.map(([pos]) => Math.round(pos)),
    sample_strengths: sorted.map(([, sampleStrength]) => round3(sampleStrength)),
    median_strength: round3(strength),
    baseline: round3(baseline),
    confidence_ratio: round3(strength / Math.max(baseline, 1e-6)),
    consistency_px: 0,
    method
  };
};

const borderForCandidate = (side: CardCenteringSide, position: number, outer: Record<CardCenteringSide, number>) => {
  if (side === 'left') return position - outer.left;
  if (side === 'right') return outer.right - position;
  if (side === 'top') return position - outer.top;
  return outer.bottom - position;
};

const chooseInnerWithExpectedBorder = (
  side: CardCenteringSide,
  candidates: Candidate[],
  outer: Record<CardCenteringSide, number>,
  expectedBorder: number
) => {
  const maxStrength = Math.max(...candidates.map(([, strength]) => strength), 1e-6);
  const expected = Math.max(4, expectedBorder);
  let best: Candidate | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const [position, strength] = candidate;
    const border = borderForCandidate(side, position, outer);
    if (border <= 0) continue;
    const strengthPart = strength / maxStrength;
    const distancePart = Math.abs(border - expected) / expected;
    const score = strengthPart - 0.8 * distancePart;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best ?? chooseCandidateByMode(candidates, 'strongest');
};

export const normalizeRotationDegrees = (degrees: number) => Math.round(Number(degrees) * 100) / 100;

export const rotationIsStale = (visibleDegrees: number, appliedDegrees: number) => {
  return Math.abs(normalizeRotationDegrees(visibleDegrees) - normalizeRotationDegrees(appliedDegrees)) >= ROTATION_EPSILON;
};

export const cropForZoom = (
  size: { width: number; height: number },
  zoom: number,
  panXPercent: number,
  panYPercent: number
) => {
  if (zoom <= 1) {
    return { x: 0, y: 0, width: size.width, height: size.height };
  }
  const width = Math.max(1, Math.round(size.width / zoom));
  const height = Math.max(1, Math.round(size.height / zoom));
  const maxLeft = Math.max(0, size.width - width);
  const maxTop = Math.max(0, size.height - height);
  return {
    x: Math.round(maxLeft * clamp(panXPercent, 0, 100) / 100),
    y: Math.round(maxTop * clamp(panYPercent, 0, 100) / 100),
    width,
    height
  };
};

export const centeringString = (a: number, b: number) => {
  const total = a + b;
  if (total <= 0) return 'n/a';
  return `${(100 * a / total).toFixed(1)}/${(100 * b / total).toFixed(1)}`;
};

export const detectAxisAlignedCenteringEdges = (
  image: CardCenteringImageDataLike,
  options: { outerSearchFrac?: number; innerMinFrac?: number; innerMaxFrac?: number } = {}
) => {
  const outerSearchFrac = options.outerSearchFrac ?? 0.22;
  const innerMinFrac = options.innerMinFrac ?? 0.01;
  const innerMaxFrac = options.innerMaxFrac ?? 0.18;
  const { width, height } = image;
  const { gx, gy } = labGradients(image);

  const y0Global = Math.round(0.1 * height);
  const y1Global = Math.round(0.9 * height);
  const x0Global = Math.round(0.18 * width);
  const x1Global = Math.round(0.82 * width);
  const ox = Math.max(20, Math.round(width * outerSearchFrac));
  const oy = Math.max(20, Math.round(height * outerSearchFrac));

  const outer = {} as CardCenteringEdges;
  const inner = {} as CardCenteringEdges;

  let scored = axisScoresVertical(gx, 0, ox, y0Global, y1Global);
  let peaks = peakCandidates(scored.scores, scored.start);
  let chosen = chooseCandidateByMode(peaks.candidates, 'first');
  outer.left = makeGlobalEdgeResult('outer_left', chosen[0], chosen[1], peaks.candidates, peaks.baseline, 'global-vertical/first');

  scored = axisScoresVertical(gx, Math.max(0, width - ox - 1), width - 1, y0Global, y1Global);
  peaks = peakCandidates(scored.scores, scored.start);
  chosen = chooseCandidateByMode(peaks.candidates, 'last');
  outer.right = makeGlobalEdgeResult('outer_right', chosen[0], chosen[1], peaks.candidates, peaks.baseline, 'global-vertical/last');

  scored = axisScoresHorizontal(gy, 0, oy, x0Global, x1Global);
  peaks = peakCandidates(scored.scores, scored.start);
  chosen = chooseCandidateByMode(peaks.candidates, 'first');
  outer.top = makeGlobalEdgeResult('outer_top', chosen[0], chosen[1], peaks.candidates, peaks.baseline, 'global-horizontal/first');

  scored = axisScoresHorizontal(gy, Math.max(0, height - oy - 1), height - 1, x0Global, x1Global);
  peaks = peakCandidates(scored.scores, scored.start);
  chosen = chooseCandidateByMode(peaks.candidates, 'last');
  outer.bottom = makeGlobalEdgeResult('outer_bottom', chosen[0], chosen[1], peaks.candidates, peaks.baseline, 'global-horizontal/last');

  const outerPositions = Object.fromEntries(SIDES.map((side) => [side, outer[side].position])) as Record<CardCenteringSide, number>;
  const cardWidth = Math.max(1, outerPositions.right - outerPositions.left);
  const cardHeight = Math.max(1, outerPositions.bottom - outerPositions.top);
  const minX = Math.max(4, Math.round(cardWidth * innerMinFrac));
  const maxX = Math.max(minX + 8, Math.round(cardWidth * innerMaxFrac));
  const minY = Math.max(4, Math.round(cardHeight * innerMinFrac));
  const maxY = Math.max(minY + 8, Math.round(cardHeight * innerMaxFrac));

  const innerCandidates = {} as Record<CardCenteringSide, { candidates: Candidate[]; baseline: number; method: string }>;

  scored = axisScoresVertical(gx, outerPositions.left + minX, Math.min(width - 1, outerPositions.left + maxX), y0Global, y1Global);
  peaks = peakCandidates(scored.scores, scored.start, 0.12, 1.1);
  innerCandidates.left = { candidates: peaks.candidates, baseline: peaks.baseline, method: 'global-vertical/plausible' };

  scored = axisScoresVertical(gx, Math.max(0, outerPositions.right - maxX), Math.max(1, outerPositions.right - minX), y0Global, y1Global);
  peaks = peakCandidates(scored.scores, scored.start, 0.12, 1.1);
  innerCandidates.right = { candidates: peaks.candidates, baseline: peaks.baseline, method: 'global-vertical/plausible' };

  scored = axisScoresHorizontal(gy, outerPositions.top + minY, Math.min(height - 1, outerPositions.top + maxY), x0Global, x1Global);
  peaks = peakCandidates(scored.scores, scored.start, 0.12, 1.1);
  innerCandidates.top = { candidates: peaks.candidates, baseline: peaks.baseline, method: 'global-horizontal/plausible' };

  scored = axisScoresHorizontal(gy, Math.max(0, outerPositions.bottom - maxY), Math.max(1, outerPositions.bottom - minY), x0Global, x1Global);
  peaks = peakCandidates(scored.scores, scored.start, 0.12, 1.1);
  innerCandidates.bottom = { candidates: peaks.candidates, baseline: peaks.baseline, method: 'global-horizontal/plausible' };

  const firstPass = {
    left: chooseCandidateByMode(innerCandidates.left.candidates, 'first'),
    right: chooseCandidateByMode(innerCandidates.right.candidates, 'last'),
    top: chooseCandidateByMode(innerCandidates.top.candidates, 'first'),
    bottom: chooseCandidateByMode(innerCandidates.bottom.candidates, 'last')
  } as Record<CardCenteringSide, Candidate>;

  const firstBorders = Object.fromEntries(
    SIDES.map((side) => [side, borderForCandidate(side, firstPass[side][0], outerPositions)])
  ) as Record<CardCenteringSide, number>;
  const topConfidence = firstPass.top[1] / Math.max(innerCandidates.top.baseline, 1e-6);
  const topBorder = firstBorders.top;

  for (const side of SIDES) {
    const peerBorders = SIDES.filter((peer) => peer !== side).map((peer) => firstBorders[peer]).filter((value) => value > 0);
    const expected = side !== 'top' && topBorder > 0 && topConfidence >= 3
      ? topBorder
      : median(peerBorders.length > 0 ? peerBorders : SIDES.map((peer) => firstBorders[peer]).filter((value) => value > 0));
    const candidateInfo = innerCandidates[side];
    const [position, strength] = chooseInnerWithExpectedBorder(side, candidateInfo.candidates, outerPositions, expected);
    inner[side] = makeGlobalEdgeResult(`inner_${side}`, position, strength, candidateInfo.candidates, candidateInfo.baseline, candidateInfo.method);
  }

  return { outer, inner };
};

export const edgeResultFromPosition = (name: string, position: number): CardCenteringEdgeResult => ({
  name,
  position: Math.round(position),
  samples: [Math.round(position)],
  sample_strengths: [0],
  median_strength: 0,
  baseline: 0,
  confidence_ratio: 999,
  consistency_px: 0,
  method: 'manual-ui'
});

export const buildEdgesFromPositions = (prefix: 'outer' | 'inner', positions: Record<CardCenteringSide, number>): CardCenteringEdges => ({
  left: edgeResultFromPosition(`${prefix}_left`, positions.left),
  top: edgeResultFromPosition(`${prefix}_top`, positions.top),
  right: edgeResultFromPosition(`${prefix}_right`, positions.right),
  bottom: edgeResultFromPosition(`${prefix}_bottom`, positions.bottom)
});

export const buildCenteringMeasurement = (
  image: Pick<CardCenteringImageDataLike, 'width' | 'height'>,
  outer: CardCenteringEdges,
  inner: CardCenteringEdges,
  rotationDegrees: number
): CardCenteringMeasurement => {
  const outerPositions = Object.fromEntries(SIDES.map((side) => [side, Math.round(outer[side].position)])) as Record<CardCenteringSide, number>;
  const innerPositions = Object.fromEntries(SIDES.map((side) => [side, Math.round(inner[side].position)])) as Record<CardCenteringSide, number>;
  const borders = {
    left: innerPositions.left - outerPositions.left,
    right: outerPositions.right - innerPositions.right,
    top: innerPositions.top - outerPositions.top,
    bottom: outerPositions.bottom - innerPositions.bottom
  };
  const diagnostics: Record<string, CardCenteringEdgeResult> = {};
  for (const side of SIDES) {
    diagnostics[`outer_${side}`] = outer[side];
    diagnostics[`inner_${side}`] = inner[side];
  }

  const warnings: string[] = [];
  if (!(outerPositions.left < innerPositions.left && innerPositions.left < innerPositions.right && innerPositions.right < outerPositions.right)) {
    warnings.push('Horizontal edge order is suspicious. Check the annotated image or adjust the lines.');
  }
  if (!(outerPositions.top < innerPositions.top && innerPositions.top < innerPositions.bottom && innerPositions.bottom < outerPositions.bottom)) {
    warnings.push('Vertical edge order is suspicious. Check the annotated image or adjust the lines.');
  }
  for (const side of SIDES) {
    if (borders[side] <= 0) {
      warnings.push(`${side} border measured as ${borders[side]}px, which is invalid; adjust the lines.`);
    }
  }
  for (const key of Object.keys(diagnostics)) {
    const edge = diagnostics[key];
    if (edge.method !== 'manual-ui') {
      if (edge.confidence_ratio < 1.7) {
        warnings.push(`Low contrast/confidence on ${key}; inspect the annotation.`);
      }
      if (edge.consistency_px > 6) {
        warnings.push(`Detected ${key} varies across sample bands by about ${edge.consistency_px.toFixed(1)}px; inspect the annotation.`);
      }
    }
  }

  return {
    image_width_px: image.width,
    image_height_px: image.height,
    outer_edges: outerPositions,
    inner_edges: innerPositions,
    borders_px: borders,
    centering: {
      left_right: centeringString(borders.left, borders.right),
      top_bottom: centeringString(borders.top, borders.bottom)
    },
    edge_diagnostics: diagnostics,
    warnings,
    rotation_degrees: normalizeRotationDegrees(rotationDegrees)
  };
};
