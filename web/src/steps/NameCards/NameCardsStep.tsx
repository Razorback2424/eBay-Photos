import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { StepNavigation } from '../../components/StepNavigation';
import {
  DetectionAdjustment,
  NamingPreset,
  Pairing,
  WorkingImageInfo,
  useSessionStore
} from '../../state/session';
import type { DetectedCard } from '../../types/detections';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import { Button } from '../../ui/Button';
import { generateUniqueFolderNames } from '../../utils/folders/sanitize';

const PREVIEW_MAX_EDGE = 520;

type NameField = 'cardName' | 'setName';

type TouchedState = Record<string, { cardName: boolean; setName: boolean }>;

const createDefaultRecord = (pairId: string): NamingPreset => ({
  id: `naming-${pairId}`,
  pairId,
  cardName: '',
  setName: '',
  setFolder: '',
  cardFolder: '',
  folderPath: ''
});

const recordsEqual = (a: NamingPreset[], b: NamingPreset[]) => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((record, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      record.id === other.id &&
      record.pairId === other.pairId &&
      record.cardName === other.cardName &&
      record.setName === other.setName &&
      record.setFolder === other.setFolder &&
      record.cardFolder === other.cardFolder &&
      record.folderPath === other.folderPath
    );
  });
};

const normalizeRecords = (pairs: Pairing[], map: Map<string, NamingPreset>): NamingPreset[] => {
  return pairs.map((pair) => {
    const existing = map.get(pair.id);
    if (existing) {
      return {
        ...createDefaultRecord(pair.id),
        ...existing
      };
    }
    return createDefaultRecord(pair.id);
  });
};

const applySanitizedFolders = (records: NamingPreset[]): NamingPreset[] => {
  const folderData = generateUniqueFolderNames(
    records.map((record) => ({
      id: record.pairId,
      cardName: record.cardName,
      setName: record.setName
    }))
  );
  const folderMap = new Map(folderData.map((entry) => [entry.id, entry]));
  return records.map((record) => {
    const folders = folderMap.get(record.pairId);
    return {
      ...record,
      setFolder: folders?.setFolder ?? '',
      cardFolder: folders?.cardFolder ?? '',
      folderPath: folders?.fullPath ?? ''
    };
  });
};

const resolveDetectedCard = (
  fileId: string | undefined,
  detectionId: string | undefined,
  detectedCards: Record<string, DetectedCard[] | undefined>,
  adjustments: Record<string, DetectionAdjustment | undefined>
): DetectedCard | null => {
  if (!fileId || !detectionId) {
    return null;
  }
  const autoPrefix = `${fileId}-card-`;
  if (detectionId.startsWith(autoPrefix)) {
    const index = Number.parseInt(detectionId.slice(autoPrefix.length), 10);
    const cards = detectedCards[fileId] ?? [];
    return Number.isFinite(index) ? cards[index] ?? null : null;
  }
  const manualPrefix = `${fileId}-manual-`;
  if (detectionId.startsWith(manualPrefix)) {
    const manualId = detectionId.slice(manualPrefix.length);
    const manualEntries = adjustments[fileId]?.manual ?? [];
    const match = manualEntries.find((entry) => entry.id === manualId);
    return match?.card ?? null;
  }
  return null;
};

interface CardPreviewProps {
  working?: WorkingImageInfo;
  card: DetectedCard | null;
  label: string;
}

const CardPreview = ({ working, card, label }: CardPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (!working || !card) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let cancelled = false;
    let bitmap: ImageBitmap | null = null;

    const render = async () => {
      bitmap = await createImageBitmap(working.blob);
      if (cancelled) {
        bitmap.close();
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return;
      }
      const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(card.bbox.width, card.bbox.height));
      const targetWidth = Math.max(1, Math.round(card.bbox.width * scale));
      const targetHeight = Math.max(1, Math.round(card.bbox.height * scale));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(
        bitmap,
        card.bbox.x,
        card.bbox.y,
        card.bbox.width,
        card.bbox.height,
        0,
        0,
        targetWidth,
        targetHeight
      );
      bitmap.close();
    };

    render().catch(() => {
      /* ignore render failures */
    });

    return () => {
      cancelled = true;
      if (bitmap) {
        bitmap.close();
      }
    };
  }, [working, card]);

  return (
    <div className="name-step__previewCanvasWrapper">
      {working && card ? (
        <canvas ref={canvasRef} className="name-step__previewCanvas" role="img" aria-label={label} />
      ) : (
        <div className="name-step__previewPlaceholder" role="status" aria-live="polite">
          <Text variant="muted">No preview available for this side.</Text>
        </div>
      )}
    </div>
  );
};

export const NameCardsStep = () => {
  const {
    pairs,
    naming,
    setNaming,
    workingImages,
    detectedCards,
    detectionAdjustments
  } = useSessionStore((state) => ({
    pairs: state.pairs,
    naming: state.naming,
    setNaming: state.setNaming,
    workingImages: state.workingImages,
    detectedCards: state.detectedCards,
    detectionAdjustments: state.detectionAdjustments
  }));

  const [activeIndex, setActiveIndex] = useState(0);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [touched, setTouched] = useState<TouchedState>({});
  const cardInputRef = useRef<HTMLInputElement | null>(null);
  const setInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedRecords = useMemo(() => {
    const map = new Map<string, NamingPreset>();
    naming.forEach((record) => {
      map.set(record.pairId, record);
    });
    const normalized = applySanitizedFolders(normalizeRecords(pairs, map));
    return normalized;
  }, [naming, pairs]);

  useEffect(() => {
    if (!recordsEqual(normalizedRecords, naming)) {
      setNaming(normalizedRecords);
    }
  }, [normalizedRecords, naming, setNaming]);

  useEffect(() => {
    if (activeIndex >= pairs.length) {
      setActiveIndex(Math.max(0, pairs.length - 1));
    }
  }, [activeIndex, pairs.length]);

  useEffect(() => {
    cardInputRef.current?.focus({ preventScroll: true });
  }, [activeIndex]);

  const updateRecord = useCallback(
    (pairId: string, updates: Partial<NamingPreset>) => {
      const map = new Map<string, NamingPreset>();
      naming.forEach((record) => {
        map.set(record.pairId, record);
      });
      const current = map.get(pairId) ?? createDefaultRecord(pairId);
      map.set(pairId, { ...current, ...updates });
      const nextRecords = applySanitizedFolders(normalizeRecords(pairs, map));
      if (!recordsEqual(nextRecords, naming)) {
        setNaming(nextRecords);
      }
    },
    [naming, pairs, setNaming]
  );

  const applySetNameToRemaining = useCallback(() => {
    const record = normalizedRecords[activeIndex];
    if (!record) {
      return;
    }
    const value = record.setName;
    if (!value.trim()) {
      setTouched((current) => ({
        ...current,
        [record.pairId]: {
          cardName: current[record.pairId]?.cardName ?? false,
          setName: true
        }
      }));
      setInputRef.current?.focus();
      return;
    }
    const map = new Map<string, NamingPreset>();
    naming.forEach((entry) => {
      map.set(entry.pairId, entry);
    });
    for (let index = activeIndex; index < pairs.length; index += 1) {
      const pair = pairs[index];
      const existing = map.get(pair.id) ?? createDefaultRecord(pair.id);
      map.set(pair.id, { ...existing, setName: value });
    }
    const nextRecords = applySanitizedFolders(normalizeRecords(pairs, map));
    if (!recordsEqual(nextRecords, naming)) {
      setNaming(nextRecords);
    }
  }, [activeIndex, naming, normalizedRecords, pairs, setNaming]);

  const activePair = pairs[activeIndex];
  const activeRecord = normalizedRecords[activeIndex];

  const frontCard = useMemo(
    () =>
      activePair
        ? resolveDetectedCard(
            activePair.primaryFileId,
            activePair.primaryDetectionId,
            detectedCards,
            detectionAdjustments
          )
        : null,
    [activePair, detectedCards, detectionAdjustments]
  );

  const backCard = useMemo(
    () =>
      activePair
        ? resolveDetectedCard(
            activePair.secondaryFileId,
            activePair.secondaryDetectionId,
            detectedCards,
            detectionAdjustments
          )
        : null,
    [activePair, detectedCards, detectionAdjustments]
  );

  const frontWorking = activePair ? workingImages[activePair.primaryFileId] : undefined;
  const backWorking = activePair ? workingImages[activePair.secondaryFileId ?? ''] : undefined;

  const handleTouched = useCallback((pairId: string, field: NameField) => {
    setTouched((current) => ({
      ...current,
      [pairId]: {
        cardName: current[pairId]?.cardName ?? false,
        setName: current[pairId]?.setName ?? false,
        [field]: true
      }
    }));
  }, []);

  const attemptAdvance = useCallback(
    (direction: 1 | -1) => {
      if (!activeRecord) {
        return;
      }
      if (direction === 1) {
        const cardValid = activeRecord.cardName.trim().length > 0;
        const setValid = activeRecord.setName.trim().length > 0;
        if (!cardValid || !setValid) {
          setTouched((current) => ({
            ...current,
            [activeRecord.pairId]: {
              cardName: true,
              setName: true
            }
          }));
          if (!cardValid) {
            cardInputRef.current?.focus();
          } else if (!setValid) {
            setInputRef.current?.focus();
          }
          return;
        }
      }
      const nextIndex = activeIndex + direction;
      if (nextIndex >= 0 && nextIndex < pairs.length) {
        setActiveIndex(nextIndex);
      }
    },
    [activeIndex, activeRecord, pairs.length]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        attemptAdvance(-1);
      } else {
        attemptAdvance(1);
      }
    },
    [attemptAdvance]
  );

  const allValid = normalizedRecords.every(
    (record) => record.cardName.trim().length > 0 && record.setName.trim().length > 0
  );

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Name each card
        </Text>
        <Text variant="body">
          Provide a clear card name and its set. We will keep folders consistent and safe for your filesystem.
        </Text>
      </Stack>
      {pairs.length === 0 ? (
        <Text variant="muted">Create at least one pair to begin naming.</Text>
      ) : (
        <div className="name-step" role="region" aria-label="Card naming workspace">
          <aside className="name-step__aside">
            <Text as="span" variant="label">
              Progress
            </Text>
            <ol className="name-step__list">
              {normalizedRecords.map((record, index) => {
                const isActive = index === activeIndex;
                const isComplete =
                  record.cardName.trim().length > 0 && record.setName.trim().length > 0;
                return (
                  <li key={record.pairId} className="name-step__listItem">
                    <button
                      type="button"
                      className={
                        'name-step__listButton' +
                        (isActive ? ' name-step__listButton--active' : '') +
                        (isComplete ? ' name-step__listButton--complete' : '')
                      }
                      onClick={() => {
                        setActiveIndex(index);
                        setPreviewSide('front');
                      }}
                      aria-current={isActive ? 'step' : undefined}
                    >
                      <span className="name-step__listIndex">{index + 1}</span>
                      <span className="name-step__listLabel">
                        {record.cardName.trim() || 'Card'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
          <div className="name-step__content">
            <Stack gap={24}>
              <Stack gap={12}>
                <Stack direction="row" justify="between" align="center">
                  <Text as="span" variant="label" aria-live="polite">
                    Card {activeIndex + 1} of {pairs.length}
                  </Text>
                  <Stack direction="row" gap={8}>
                    <Button
                      type="button"
                      variant={previewSide === 'front' ? 'primary' : 'secondary'}
                      onClick={() => setPreviewSide('front')}
                    >
                      Front
                    </Button>
                    <Button
                      type="button"
                      variant={previewSide === 'back' ? 'primary' : 'secondary'}
                      onClick={() => setPreviewSide('back')}
                      disabled={!backCard || !backWorking}
                    >
                      Back
                    </Button>
                  </Stack>
                </Stack>
                <CardPreview
                  working={previewSide === 'front' ? frontWorking : backWorking}
                  card={previewSide === 'front' ? frontCard : backCard}
                  label={previewSide === 'front' ? 'Front card preview' : 'Back card preview'}
                />
              </Stack>
              {activeRecord && (
                <form
                  className="name-step__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    attemptAdvance(1);
                  }}
                >
                  <label className="name-step__field">
                    <Text as="span" variant="muted">
                      Card name
                    </Text>
                    <input
                      ref={cardInputRef}
                      type="text"
                      value={activeRecord.cardName}
                      onChange={(event) =>
                        updateRecord(activeRecord.pairId, { cardName: event.target.value })
                      }
                      onBlur={() => handleTouched(activeRecord.pairId, 'cardName')}
                      onKeyDown={handleKeyDown}
                      aria-invalid={
                        !activeRecord.cardName.trim() &&
                        touched[activeRecord.pairId]?.cardName
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={`card-${activeRecord.pairId}-error`}
                      placeholder="e.g. Charizard VSTAR"
                    />
                    {!activeRecord.cardName.trim() && touched[activeRecord.pairId]?.cardName && (
                      <span className="name-step__error" id={`card-${activeRecord.pairId}-error`}>
                        Card name is required.
                      </span>
                    )}
                  </label>
                  <label className="name-step__field">
                    <Text as="span" variant="muted">
                      Set name
                    </Text>
                    <input
                      ref={setInputRef}
                      type="text"
                      value={activeRecord.setName}
                      onChange={(event) =>
                        updateRecord(activeRecord.pairId, { setName: event.target.value })
                      }
                      onBlur={() => handleTouched(activeRecord.pairId, 'setName')}
                      onKeyDown={handleKeyDown}
                      aria-invalid={
                        !activeRecord.setName.trim() && touched[activeRecord.pairId]?.setName
                          ? 'true'
                          : undefined
                      }
                      aria-describedby={`set-${activeRecord.pairId}-error`}
                      placeholder="e.g. Crown Zenith"
                    />
                    {!activeRecord.setName.trim() && touched[activeRecord.pairId]?.setName && (
                      <span className="name-step__error" id={`set-${activeRecord.pairId}-error`}>
                        Set name is required.
                      </span>
                    )}
                  </label>
                  <div className="name-step__actions">
                    <Button type="button" variant="secondary" onClick={applySetNameToRemaining}>
                      Apply this set name to all remaining
                    </Button>
                  </div>
                  <Stack gap={4} className="name-step__folders" aria-live="polite">
                    <Text as="span" variant="muted">
                      Set folder: <code>{activeRecord.setFolder || '—'}</code>
                    </Text>
                    <Text as="span" variant="muted">
                      Card folder: <code>{activeRecord.cardFolder || '—'}</code>
                    </Text>
                    <Text as="span" variant="muted">
                      Full path: <code>{activeRecord.folderPath || '—'}</code>
                    </Text>
                  </Stack>
                  <div className="name-step__keyboardHelp">
                    <Text as="span" variant="muted">
                      Press Enter for next card, Shift+Enter for previous.
                    </Text>
                  </div>
                </form>
              )}
            </Stack>
          </div>
        </div>
      )}
      <StepNavigation step="naming" nextLabel="Output" nextDisabled={!allValid || pairs.length === 0} />
    </Stack>
  );
};
