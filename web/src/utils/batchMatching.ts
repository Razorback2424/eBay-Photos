import type { FileAsset, InferredSide, SourcePair } from '../state/session';

const FRONT_TOKENS = ['front', 'fronts', 'obverse', 'recto', 'primary'];
const BACK_TOKENS = ['back', 'backs', 'reverse', 'verso', 'secondary', 'rear'];

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const stripSideTokens = (tokens: string[]) =>
  tokens.filter((token) => !FRONT_TOKENS.includes(token) && !BACK_TOKENS.includes(token));

const inferSide = (name: string): InferredSide => {
  const tokens = tokenize(name);
  const hasFront = tokens.some((token) => FRONT_TOKENS.includes(token));
  const hasBack = tokens.some((token) => BACK_TOKENS.includes(token));
  if (hasFront && !hasBack) return 'front';
  if (hasBack && !hasFront) return 'back';
  return 'unknown';
};

const createComparableStem = (name: string) => stripSideTokens(tokenize(name)).join('-');

const extractNumber = (name: string) => {
  const match = name.toLowerCase().replace(/\.[^.]+$/, '').match(/(\d+)(?!.*\d)/);
  return match ? Number.parseInt(match[1], 10) : null;
};

const extractPrefix = (name: string) => {
  const normalized = name.toLowerCase().replace(/\.[^.]+$/, '');
  const match = normalized.match(/^(.*?)(\d+)(?!.*\d)/);
  return match ? match[1].replace(/[^a-z0-9]+$/g, '') : normalized;
};

const buildPairId = (primaryFileId: string, secondaryFileId: string) => `source-${primaryFileId}-${secondaryFileId}`;

const orderPair = (first: FileAsset, second: FileAsset) => {
  if (first.inferredSide === 'front' && second.inferredSide === 'back') {
    return { primary: first, secondary: second };
  }
  if (first.inferredSide === 'back' && second.inferredSide === 'front') {
    return { primary: second, secondary: first };
  }
  return { primary: first, secondary: second };
};

export interface BatchMatchResult {
  files: FileAsset[];
  sourcePairs: SourcePair[];
  unmatchedFileIds: string[];
}

export const prepareBatchFiles = (files: FileAsset[]): FileAsset[] =>
  files.map((file) => ({
    ...file,
    inferredSide: file.inferredSide ?? inferSide(file.relativePath || file.name)
  }));

export const autoMatchBatchFiles = (inputFiles: FileAsset[]): BatchMatchResult => {
  const files = prepareBatchFiles(inputFiles);
  const unmatched = new Set(files.map((file) => file.id));
  const sourcePairs: SourcePair[] = [];

  const groupedByStem = new Map<string, FileAsset[]>();
  for (const file of files) {
    const stem = createComparableStem(file.relativePath || file.name);
    const current = groupedByStem.get(stem) ?? [];
    current.push(file);
    groupedByStem.set(stem, current);
  }

  for (const candidates of groupedByStem.values()) {
    const fronts = candidates.filter((file) => file.inferredSide === 'front' && unmatched.has(file.id));
    const backs = candidates.filter((file) => file.inferredSide === 'back' && unmatched.has(file.id));
    const pairCount = Math.min(fronts.length, backs.length);
    for (let index = 0; index < pairCount; index += 1) {
      const primary = fronts[index];
      const secondary = backs[index];
      unmatched.delete(primary.id);
      unmatched.delete(secondary.id);
      sourcePairs.push({
        id: buildPairId(primary.id, secondary.id),
        primaryFileId: primary.id,
        secondaryFileId: secondary.id,
        status: 'draft',
        confidence: 0.98,
        reason: 'Matched by shared filename stem and front/back keywords.',
        matchType: 'auto'
      });
    }
  }

  const remaining = files
    .filter((file) => unmatched.has(file.id))
    .map((file) => ({
      file,
      prefix: extractPrefix(file.relativePath || file.name),
      number: extractNumber(file.relativePath || file.name)
    }))
    .filter((entry) => entry.number !== null)
    .sort((left, right) => {
      if (left.prefix !== right.prefix) {
        return left.prefix.localeCompare(right.prefix);
      }
      return (left.number ?? 0) - (right.number ?? 0);
    });

  for (let index = 0; index < remaining.length - 1; index += 1) {
    const current = remaining[index];
    const next = remaining[index + 1];
    if (!unmatched.has(current.file.id) || !unmatched.has(next.file.id)) {
      continue;
    }
    if (current.prefix !== next.prefix || current.number === null || next.number === null) {
      continue;
    }
    if (next.number - current.number !== 1) {
      continue;
    }
    const ordered = orderPair(current.file, next.file);
    unmatched.delete(ordered.primary.id);
    unmatched.delete(ordered.secondary.id);
    sourcePairs.push({
      id: buildPairId(ordered.primary.id, ordered.secondary.id),
      primaryFileId: ordered.primary.id,
      secondaryFileId: ordered.secondary.id,
      status: 'draft',
      confidence: 0.84,
      reason: 'Matched by adjacent sequential filenames.',
      matchType: 'auto'
    });
    index += 1;
  }

  return {
    files,
    sourcePairs,
    unmatchedFileIds: Array.from(unmatched)
  };
};
