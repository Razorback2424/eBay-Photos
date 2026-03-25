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
  component: function PairsStep() {
    const { files, sourcePairs, pairs, detectedCards, detectionAdjustments, setPairsForSourcePair } = useSessionStore((state) => ({
      files: state.files,
      sourcePairs: state.getConfirmedSourcePairs(),
      pairs: state.pairs,
      detectedCards: state.detectedCards,
      detectionAdjustments: state.detectionAdjustments,
      setPairsForSourcePair: state.setPairsForSourcePair
    }));

    const [activeSourcePairId, setActiveSourcePairId] = useState<string | null>(sourcePairs[0]?.id ?? null);

    useEffect(() => {
      if (!sourcePairs.some((pair) => pair.id === activeSourcePairId)) {
        setActiveSourcePairId(sourcePairs[0]?.id ?? null);
      }
    }, [activeSourcePairId, sourcePairs]);

    const activeSourcePair = useMemo(
      () => sourcePairs.find((pair) => pair.id === activeSourcePairId) ?? sourcePairs[0] ?? null,
      [activeSourcePairId, sourcePairs]
    );
    const fileMap = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
    const frontFile = activeSourcePair ? fileMap.get(activeSourcePair.primaryFileId) : files[0];
    const backFile = activeSourcePair ? fileMap.get(activeSourcePair.secondaryFileId) : files[1];

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
        if (activeSourcePair) {
          setPairsForSourcePair(activeSourcePair.id, []);
        }
      }
    }, [activeSourcePair, frontCards.length, setPairsForSourcePair]);

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
      if (!activeSourcePair || !backFile) {
        setAssignments({});
        setSkippedBacks([]);
        return;
      }
      const validBackIds = new Set(backCards.map((card) => card.id));
      const storedPairs = pairs.filter((pair) => pair.sourcePairId === activeSourcePair.id);
      const nextAssignments: Record<string, string | null> = {};
      frontCards.forEach((front) => {
        const stored = storedPairs.find((pair) => pair.primaryDetectionId === front.id);
        nextAssignments[front.id] =
          stored?.secondaryDetectionId && validBackIds.has(stored.secondaryDetectionId) ? stored.secondaryDetectionId : null;
      });
      setAssignments(nextAssignments);
      const assignedBackIds = new Set(
        storedPairs
          .map((pair) => pair.secondaryDetectionId)
          .filter((value): value is string => typeof value === 'string' && validBackIds.has(value))
      );
      setSkippedBacks(backCards.filter((card) => !assignedBackIds.has(card.id)).map((card) => card.id).filter((id) => {
        const usedByAssignment = Object.values(nextAssignments).includes(id);
        return !usedByAssignment;
      }));
    }, [activeSourcePair, backCards, backFile, frontCards, pairs]);

    const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, backId: string) => {
      event.dataTransfer?.setData('text/plain', backId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
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
      if (!activeSourcePair || !frontFile || frontCards.length === 0) {
        return;
      }

      if (!backFile || frontCards.length !== backCards.length) {
        const nextPairs = frontCards.map((front) => {
          const assignedId = assignments[front.id];
          const matched = assignedId ? backMap.get(assignedId) : undefined;
          return {
            id: `pair-${activeSourcePair.id}-${front.id}`,
            sourcePairId: activeSourcePair.id,
            primaryFileId: frontFile.id,
            primaryDetectionId: front.id,
            secondaryFileId: matched ? backFile?.id : undefined,
            secondaryDetectionId: matched?.id,
            status: matched ? 'matched' as const : 'pending' as const
          };
        });
        setPairsForSourcePair(activeSourcePair.id, nextPairs);
        return;
      }

      const order = reverseBacks ? [...backCards].reverse() : backCards;
      const nextPairs = frontCards.map((front, index) => {
        const matched = order[index];
        return {
          id: `pair-${activeSourcePair.id}-${front.id}`,
          sourcePairId: activeSourcePair.id,
          primaryFileId: frontFile.id,
          primaryDetectionId: front.id,
          secondaryFileId: matched ? backFile.id : undefined,
          secondaryDetectionId: matched?.id,
          status: matched ? 'matched' as const : 'pending' as const
        };
      });
      setPairsForSourcePair(activeSourcePair.id, nextPairs);
    }, [activeSourcePair, assignments, backCards, backFile, backMap, frontCards, frontFile, reverseBacks, setPairsForSourcePair]);

    const autoPairing = frontCards.length > 0 && frontCards.length === backCards.length;
    const resolvedSourcePairIds = useMemo(() => new Set(pairs.map((pair) => pair.sourcePairId)), [pairs]);
    const unresolvedSourcePairs = sourcePairs.filter((pair) => !resolvedSourcePairIds.has(pair.id)).length;

    const handleSwitchSourcePair = useCallback(
      (sourcePairId: string) => {
        handleSavePairs();
        setActiveSourcePairId(sourcePairId);
      },
      [handleSavePairs]
    );

    const handleNext = useCallback(() => {
      handleSavePairs();
      const nextResolved = new Set([
        ...pairs
          .filter((pair) => pair.sourcePairId !== activeSourcePair?.id)
          .map((pair) => pair.sourcePairId),
        activeSourcePair?.id
      ].filter((value): value is string => Boolean(value)));
      if (!sourcePairs.every((pair) => nextResolved.has(pair.id))) {
        return false;
      }
    }, [activeSourcePair?.id, handleSavePairs, pairs, sourcePairs]);

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
        {sourcePairs.length > 1 && (
          <Stack gap={8}>
            <div className="source-pairTabs" role="tablist" aria-label="Detected source pairs">
              {sourcePairs.map((pair, index) => (
                <button
                  key={pair.id}
                  type="button"
                  role="tab"
                  className={`source-pairTabs__tab${pair.id === activeSourcePair?.id ? ' source-pairTabs__tab--active' : ''}`}
                  aria-selected={pair.id === activeSourcePair?.id}
                  onClick={() => handleSwitchSourcePair(pair.id)}
                >
                  Pair {index + 1}
                </button>
              ))}
            </div>
            {unresolvedSourcePairs > 0 && (
              <Text variant="muted">
                Save each source pair before continuing. {unresolvedSourcePairs} source pair{unresolvedSourcePairs === 1 ? '' : 's'} still need pairing data.
              </Text>
            )}
          </Stack>
        )}
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
          onNext={handleNext}
        />
      </Stack>
    );
  }
});
