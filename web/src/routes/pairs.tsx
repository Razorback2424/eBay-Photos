import { createRoute, redirect } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

import { StepNavigation } from '../components/StepNavigation';
import { getStepPath, useSessionStore } from '../state/session';
import type { DetectionAdjustment } from '../state/session';
import type { DetectedCard } from '../types/detections';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { rootRoute } from './__root';

interface AdjustedCardEntry {
  id: string;
  card: DetectedCard;
  order: number;
  source: 'auto' | 'manual';
}

const createAdjustedCards = (
  fileId: string | undefined,
  allDetected: Record<string, DetectedCard[] | undefined>,
  adjustments: Record<string, DetectionAdjustment | undefined>
): AdjustedCardEntry[] => {
  if (!fileId) {
    return [];
  }

  const cards = allDetected[fileId] ?? [];
  const adjustment = adjustments[fileId];
  const disabled = new Set(adjustment?.disabledAuto ?? []);
  const entries: AdjustedCardEntry[] = [];

  cards.forEach((card, index) => {
    if (disabled.has(index)) {
      return;
    }
    entries.push({
      id: `${fileId}-card-${index}`,
      card,
      order: 0,
      source: 'auto'
    });
  });

  adjustment?.manual.forEach((manual) => {
    entries.push({
      id: `${fileId}-manual-${manual.id}`,
      card: manual.card,
      order: 0,
      source: 'manual'
    });
  });

  entries.sort((a, b) => a.card.centerNorm[0] - b.card.centerNorm[0]);
  return entries.map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
};

const computeTotalDistance = (front: AdjustedCardEntry[], back: AdjustedCardEntry[]) => {
  return front.reduce((total, item, index) => {
    const partner = back[index];
    if (!partner) {
      return total;
    }
    const dx = item.card.centerNorm[0] - partner.card.centerNorm[0];
    const dy = item.card.centerNorm[1] - partner.card.centerNorm[1];
    return total + Math.sqrt(dx * dx + dy * dy);
  }, 0);
};

const PairsStep = () => {
  const { files, detectedCards, detectionAdjustments, setPairs } = useSessionStore((state) => ({
    files: state.files,
    detectedCards: state.detectedCards,
    detectionAdjustments: state.detectionAdjustments,
    setPairs: state.setPairs
  }));

  const frontFile = files[0];
  const backFile = files[1];

  const frontCards = useMemo(
    () => createAdjustedCards(frontFile?.id, detectedCards, detectionAdjustments),
    [frontFile?.id, detectedCards, detectionAdjustments]
  );
  const backCards = useMemo(
    () => createAdjustedCards(backFile?.id, detectedCards, detectionAdjustments),
    [backFile?.id, detectedCards, detectionAdjustments]
  );

  useEffect(() => {
    if (frontCards.length === 0) {
      setPairs([]);
    }
  }, [frontCards.length, setPairs]);

  const { forwardDistance, reversedDistance } = useMemo(() => {
    if (frontCards.length === 0 || frontCards.length !== backCards.length) {
      return { forwardDistance: Number.POSITIVE_INFINITY, reversedDistance: Number.POSITIVE_INFINITY };
    }
    const forward = computeTotalDistance(frontCards, backCards);
    const reversed = computeTotalDistance(frontCards, [...backCards].reverse());
    return { forwardDistance: forward, reversedDistance: reversed };
  }, [frontCards, backCards]);

  const reverseRecommended = reversedDistance < forwardDistance;
  const [reverseBacks, setReverseBacks] = useState(reverseRecommended);
  const previousCounts = useRef<{ front: number; back: number }>({ front: 0, back: 0 });

  useEffect(() => {
    const countsChanged =
      previousCounts.current.front !== frontCards.length || previousCounts.current.back !== backCards.length;
    if (countsChanged) {
      previousCounts.current = { front: frontCards.length, back: backCards.length };
      if (frontCards.length === backCards.length && frontCards.length > 0) {
        setReverseBacks(reverseRecommended);
      } else {
        setReverseBacks(false);
      }
    }
  }, [frontCards.length, backCards.length, reverseRecommended]);

  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [skippedBacks, setSkippedBacks] = useState<string[]>([]);

  useEffect(() => {
    const validBackIds = new Set(backCards.map((card) => card.id));
    setAssignments((current) => {
      const next: Record<string, string | null> = {};
      frontCards.forEach((front) => {
        const assigned = current[front.id];
        next[front.id] = assigned && validBackIds.has(assigned) ? assigned : null;
      });
      return next;
    });
  }, [frontCards, backCards]);

  useEffect(() => {
    const validBackIds = new Set(backCards.map((card) => card.id));
    setSkippedBacks((current) => current.filter((id) => validBackIds.has(id)));
  }, [backCards]);

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, backId: string) => {
    event.dataTransfer?.setData('text/plain', backId);
    event.dataTransfer?.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  }, []);

  const assignBackToFront = useCallback((frontId: string, backId: string) => {
    setAssignments((current) => {
      const next: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(current)) {
        next[key] = value === backId ? null : value ?? null;
      }
      next[frontId] = backId;
      return next;
    });
    setSkippedBacks((current) => current.filter((id) => id !== backId));
  }, []);

  const handleDropOnFront = useCallback(
    (event: DragEvent<HTMLDivElement>, frontId: string) => {
      event.preventDefault();
      const backId = event.dataTransfer?.getData('text/plain');
      if (!backId) {
        return;
      }
      assignBackToFront(frontId, backId);
    },
    [assignBackToFront]
  );

  const handleDropSkip = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const backId = event.dataTransfer?.getData('text/plain');
    if (!backId) {
      return;
    }
    setAssignments((current) => {
      const next: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(current)) {
        next[key] = value === backId ? null : value ?? null;
      }
      return next;
    });
    setSkippedBacks((current) => (current.includes(backId) ? current : [...current, backId]));
  }, []);

  const handleClearAssignment = useCallback((frontId: string) => {
    setAssignments((current) => ({ ...current, [frontId]: null }));
  }, []);

  const handleRestoreBack = useCallback((backId: string) => {
    setSkippedBacks((current) => current.filter((id) => id !== backId));
  }, []);

  const handleReverseToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setReverseBacks(event.target.checked);
  }, []);

  const backMap = useMemo(() => {
    const map = new Map<string, AdjustedCardEntry>();
    backCards.forEach((card) => {
      map.set(card.id, card);
    });
    return map;
  }, [backCards]);

  const assignedBackIds = useMemo(
    () => new Set(Object.values(assignments).filter((value): value is string => Boolean(value))),
    [assignments]
  );
  const skippedBackSet = useMemo(() => new Set(skippedBacks), [skippedBacks]);

  const availableBacks = useMemo(
    () => backCards.filter((card) => !assignedBackIds.has(card.id) && !skippedBackSet.has(card.id)),
    [assignedBackIds, backCards, skippedBackSet]
  );
  const skippedBackEntries = useMemo(
    () => backCards.filter((card) => skippedBackSet.has(card.id)),
    [backCards, skippedBackSet]
  );

  const orderedBacks = useMemo(() => (reverseBacks ? [...backCards].reverse() : backCards), [backCards, reverseBacks]);

  const handleSavePairs = useCallback(() => {
    if (!frontFile || frontCards.length === 0) {
      setPairs([]);
      return;
    }

    if (!backFile || frontCards.length !== backCards.length) {
      const nextPairs = frontCards.map((front) => {
        const assignedId = assignments[front.id];
        const matched = assignedId ? backMap.get(assignedId) : undefined;
        return {
          id: `pair-${front.id}`,
          primaryFileId: frontFile.id,
          primaryDetectionId: front.id,
          secondaryFileId: matched ? backFile?.id : undefined,
          secondaryDetectionId: matched?.id,
          status: matched ? 'matched' : 'pending'
        };
      });
      setPairs(nextPairs);
      return;
    }

    const order = reverseBacks ? [...backCards].reverse() : backCards;
    const nextPairs = frontCards.map((front, index) => {
      const matched = order[index];
      return {
        id: `pair-${front.id}`,
        primaryFileId: frontFile.id,
        primaryDetectionId: front.id,
        secondaryFileId: matched ? backFile.id : undefined,
        secondaryDetectionId: matched?.id,
        status: matched ? 'matched' : 'pending'
      };
    });
    setPairs(nextPairs);
  }, [assignments, backCards, backFile, backMap, frontCards, frontFile, reverseBacks, setPairs]);

  const autoPairing = frontCards.length > 0 && frontCards.length === backCards.length;

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Pair related imagery
        </Text>
        <Text variant="body">
          Match fronts and backs so naming and export settings stay aligned.
        </Text>
      </Stack>
      {frontCards.length === 0 ? (
        <Text variant="muted">Confirm or add primary detections before pairing.</Text>
      ) : autoPairing ? (
        <Stack gap={16} aria-live="polite">
          <Text variant="muted">
            We matched {frontCards.length} front card{frontCards.length === 1 ? '' : 's'} with {backCards.length} back
            card{backCards.length === 1 ? '' : 's'} based on card positions.
          </Text>
          {reverseRecommended && (
            <label className="pair-auto__toggle">
              <input type="checkbox" checked={reverseBacks} onChange={handleReverseToggle} /> Reverse backs order
            </label>
          )}
          <div className="pair-auto">
            {frontCards.map((front, index) => {
              const matched = orderedBacks[index];
              return (
                <div key={front.id} className="pair-auto__row">
                  <div className="pair-auto__column">
                    <span className="pair-auto__label">Front {front.order}</span>
                    {front.source === 'manual' && <span className="pair-tag">Manual</span>}
                  </div>
                  <div className="pair-auto__column">
                    {matched ? (
                      <>
                        <span className="pair-auto__label">Back {matched.order}</span>
                        {matched.source === 'manual' && <span className="pair-tag">Manual</span>}
                      </>
                    ) : (
                      <Text variant="muted">No matching back</Text>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Stack>
      ) : (
        <Stack gap={16} aria-live="polite">
          <Text variant="muted">
            Drag backs to fronts to create pairs. Drop a back into “Skip back” to leave it unmatched.
          </Text>
          <div className="pair-grid">
            <div className="pair-grid__column">
              <Text as="h3" variant="label">
                Front detections ({frontCards.length})
              </Text>
              <div className="pair-grid__list">
                {frontCards.map((front) => {
                  const assignedId = assignments[front.id];
                  const assigned = assignedId ? backMap.get(assignedId) : undefined;
                  return (
                    <div key={front.id} className="pair-grid__frontCard">
                      <div className="pair-grid__cardHeader">
                        <span>Front {front.order}</span>
                        {front.source === 'manual' && <span className="pair-tag">Manual</span>}
                      </div>
                      <div
                        className={`pair-grid__drop${assigned ? ' pair-grid__drop--filled' : ''}`}
                        onDragOver={handleDragOver}
                        onDrop={(event) => handleDropOnFront(event, front.id)}
                      >
                        {assigned ? (
                          <div className="pair-grid__assigned">
                            <span>
                              Back {assigned.order}
                              {assigned.source === 'manual' && <span className="pair-tag">Manual</span>}
                            </span>
                            <button type="button" onClick={() => handleClearAssignment(front.id)}>
                              Remove
                            </button>
                          </div>
                        ) : (
                          <span>Drop back card here</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="pair-grid__column">
              <Text as="h3" variant="label">
                Back detections ({backCards.length})
              </Text>
              <div className="pair-grid__list">
                {availableBacks.length > 0 ? (
                  availableBacks.map((back) => (
                    <div
                      key={back.id}
                      className="pair-grid__backCard"
                      draggable
                      onDragStart={(event) => handleDragStart(event, back.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="pair-grid__cardHeader">
                        <span>Back {back.order}</span>
                        {back.source === 'manual' && <span className="pair-tag">Manual</span>}
                      </div>
                      <Text variant="muted">Drag to a front slot</Text>
                    </div>
                  ))
                ) : (
                  <Text variant="muted">No unassigned backs available.</Text>
                )}
              </div>
              <div
                className="pair-grid__skipZone"
                onDragOver={handleDragOver}
                onDrop={handleDropSkip}
                role="button"
                aria-label="Skip back detection"
              >
                Skip back
              </div>
              {skippedBackEntries.length > 0 && (
                <div className="pair-grid__skippedList">
                  <Text variant="muted">Skipped backs</Text>
                  {skippedBackEntries.map((back) => (
                    <div key={back.id} className="pair-grid__skippedItem">
                      <span>
                        Back {back.order}
                        {back.source === 'manual' && <span className="pair-tag">Manual</span>}
                      </span>
                      <button type="button" onClick={() => handleRestoreBack(back.id)}>
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Stack>
      )}
      <StepNavigation
        step="pairs"
        nextLabel="Naming"
        nextDisabled={frontCards.length === 0}
        onNext={handleSavePairs}
      />
    </Stack>
  );
};

export const pairsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pairs',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (!state.canAccessStep('pairs')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: PairsStep
});
