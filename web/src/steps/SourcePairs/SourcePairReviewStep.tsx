import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StepNavigation } from '../../components/StepNavigation';
import { FileAsset, SourcePair, useSessionStore } from '../../state/session';
import { Button } from '../../ui/Button';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';

const orderManualPair = (first: FileAsset, second: FileAsset) => {
  if (first.inferredSide === 'front' && second.inferredSide === 'back') {
    return { primary: first, secondary: second };
  }
  if (first.inferredSide === 'back' && second.inferredSide === 'front') {
    return { primary: second, secondary: first };
  }
  return { primary: first, secondary: second };
};

interface SourceFilePreviewProps {
  file: FileAsset;
  objectUrl?: string;
  selected?: boolean;
  onClick?: () => void;
  action?: ReactNode;
}

const SourceFilePreview = ({ file, objectUrl, selected, onClick, action }: SourceFilePreviewProps) => (
  <article className={`source-fileCard${selected ? ' source-fileCard--selected' : ''}`}>
    <button type="button" className="source-fileCard__button" onClick={onClick}>
      <div className="source-fileCard__imageFrame">
        {objectUrl ? <img src={objectUrl} alt="" className="source-fileCard__image" /> : <div className="source-fileCard__placeholder" />}
      </div>
      <Stack gap={4}>
        {file.inferredSide && file.inferredSide !== 'unknown' && (
          <Text as="span" variant="label">
            {file.inferredSide}
          </Text>
        )}
        <Text as="span" variant="body" className="source-fileCard__name">
          {file.relativePath || file.name}
        </Text>
      </Stack>
    </button>
    {action}
  </article>
);

export const SourcePairReviewStep = () => {
  const {
    files,
    sourcePairs,
    skippedFileIds,
    workingImages,
    setSourcePairs,
    setSkippedFileIds,
    confirmSourcePairs
  } = useSessionStore((state) => ({
    files: state.files,
    sourcePairs: state.sourcePairs,
    skippedFileIds: state.skippedFileIds,
    workingImages: state.workingImages,
    setSourcePairs: state.setSourcePairs,
    setSkippedFileIds: state.setSkippedFileIds,
    confirmSourcePairs: state.confirmSourcePairs
  }));

  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const objectUrlMapRef = useRef<Record<string, string>>({});

  const fileMap = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let changed = false;
    const nextMap = { ...objectUrlMapRef.current };
    const activeFileIds = new Set<string>();

    files.forEach((file) => {
      const blob = workingImages[file.id]?.blob;
      if (!blob) {
        return;
      }
      activeFileIds.add(file.id);
      if (!nextMap[file.id]) {
        nextMap[file.id] = URL.createObjectURL(blob);
        changed = true;
      }
    });

    Object.keys(nextMap).forEach((fileId) => {
      if (activeFileIds.has(fileId)) {
        return;
      }
      URL.revokeObjectURL(nextMap[fileId]);
      delete nextMap[fileId];
      changed = true;
    });

    if (changed) {
      objectUrlMapRef.current = nextMap;
      setObjectUrls(nextMap);
    }
  }, [files, workingImages]);

  useEffect(() => {
    return () => {
      Object.values(objectUrlMapRef.current).forEach((url) => URL.revokeObjectURL(url));
      objectUrlMapRef.current = {};
    };
  }, []);

  const pairedFileIds = useMemo(() => {
    const paired = new Set<string>();
    sourcePairs.forEach((pair) => {
      paired.add(pair.primaryFileId);
      paired.add(pair.secondaryFileId);
    });
    return paired;
  }, [sourcePairs]);

  const skippedSet = useMemo(() => new Set(skippedFileIds), [skippedFileIds]);

  const unmatchedFiles = useMemo(
    () => files.filter((file) => !pairedFileIds.has(file.id) && !skippedSet.has(file.id)),
    [files, pairedFileIds, skippedSet]
  );

  const handleUnpair = useCallback(
    (pairId: string) => {
      const pair = sourcePairs.find((item) => item.id === pairId);
      if (!pair) return;
      setSourcePairs(sourcePairs.filter((item) => item.id !== pairId));
      setSelectedFileIds((current) =>
        current.filter((fileId) => fileId !== pair.primaryFileId && fileId !== pair.secondaryFileId)
      );
    },
    [setSourcePairs, sourcePairs]
  );

  const toggleSkip = useCallback(
    (fileId: string) => {
      const next = new Set(skippedFileIds);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
        setSelectedFileIds((current) => current.filter((id) => id !== fileId));
      }
      setSkippedFileIds(Array.from(next));
    },
    [setSkippedFileIds, skippedFileIds]
  );

  const handleSelectFile = useCallback(
    (fileId: string) => {
      setSelectedFileIds((current) => {
        if (current.includes(fileId)) {
          return current.filter((id) => id !== fileId);
        }
        if (current.length === 1) {
          const first = fileMap.get(current[0]);
          const second = fileMap.get(fileId);
          if (!first || !second) {
            return current;
          }
          const ordered = orderManualPair(first, second);
          const nextPair: SourcePair = {
            id: `source-${ordered.primary.id}-${ordered.secondary.id}`,
            primaryFileId: ordered.primary.id,
            secondaryFileId: ordered.secondary.id,
            status: 'draft',
            matchType: 'manual',
            reason: 'Paired manually during batch review.'
          };
          setSourcePairs([...sourcePairs, nextPair]);
          return [];
        }
        return [fileId];
      });
    },
    [fileMap, setSourcePairs, sourcePairs]
  );

  const unresolvedCount = unmatchedFiles.length;

  const handleNext = useCallback(() => {
    if (unresolvedCount > 0) {
      return false;
    }
    confirmSourcePairs();
  }, [confirmSourcePairs, unresolvedCount]);

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Check the pairings
        </Text>
        <Text variant="body">Keep the matches that look right. Unmatched files can be paired or skipped as needed.</Text>
      </Stack>

      <Stack gap={12}>
        <Text as="h3" variant="label">
          Suggested pairs ({sourcePairs.length})
        </Text>
        {sourcePairs.length === 0 ? (
          <Text variant="muted">No automatic matches yet. Select two unmatched files below to create a pair.</Text>
        ) : (
          <div className="source-pairList">
            {sourcePairs.map((pair) => {
              const primary = fileMap.get(pair.primaryFileId);
              const secondary = fileMap.get(pair.secondaryFileId);
              if (!primary || !secondary) {
                return null;
              }
              return (
                <article key={pair.id} className="source-pairCard">
                  <div className="source-pairCard__grid">
                    <SourceFilePreview file={primary} objectUrl={objectUrls[primary.id]} />
                    <SourceFilePreview file={secondary} objectUrl={objectUrls[secondary.id]} />
                  </div>
                  <Stack direction="row" justify="between" align="center">
                    <Text variant="muted">{pair.reason ?? 'Ready for review.'}</Text>
                    <Button type="button" variant="ghost" onClick={() => handleUnpair(pair.id)}>
                      Unpair
                    </Button>
                  </Stack>
                </article>
              );
            })}
          </div>
        )}
      </Stack>

      {unmatchedFiles.length > 0 && (
        <details className="source-reviewSection" open>
          <summary className="source-reviewSection__summary">
            Unmatched files ({unmatchedFiles.length})
          </summary>
          <Stack gap={12}>
            <Text variant="muted">
              Select one file, then select its match. Skip anything you do not want to process.
            </Text>
            <div className="source-fileGrid">
              {unmatchedFiles.map((file) => (
                <SourceFilePreview
                  key={file.id}
                  file={file}
                  objectUrl={objectUrls[file.id]}
                  selected={selectedFileIds.includes(file.id)}
                  onClick={() => handleSelectFile(file.id)}
                  action={
                    <Button type="button" variant="ghost" onClick={() => toggleSkip(file.id)}>
                      Skip
                    </Button>
                  }
                />
              ))}
            </div>
          </Stack>
        </details>
      )}

      {skippedFileIds.length > 0 && (
        <details className="source-reviewSection">
          <summary className="source-reviewSection__summary">
            Skipped files ({skippedFileIds.length})
          </summary>
          <div className="source-fileGrid">
            {skippedFileIds.map((fileId) => {
              const file = fileMap.get(fileId);
              if (!file) return null;
              return (
                <SourceFilePreview
                  key={fileId}
                  file={file}
                  objectUrl={objectUrls[fileId]}
                  action={
                    <Button type="button" variant="ghost" onClick={() => toggleSkip(fileId)}>
                      Restore
                    </Button>
                  }
                />
              );
            })}
          </div>
        </details>
      )}

      <div className="source-reviewFooter">
        <Text variant="muted">
          {selectedFileIds.length === 1
            ? 'Select one more file to make a pair.'
            : unresolvedCount > 0
              ? `${unresolvedCount} file${unresolvedCount === 1 ? '' : 's'} still need a decision.`
              : 'All files are resolved.'}
        </Text>
      </div>

      <StepNavigation step="sourcePairs" nextLabel="Review detections" nextDisabled={unresolvedCount > 0} onNext={handleNext} />
    </Stack>
  );
};
