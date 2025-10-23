import { ChangeEvent } from 'react';
import { createRoute, redirect } from '@tanstack/react-router';

import { StepNavigation } from '../components/StepNavigation';
import { getStepPath, NamingPreset, useSessionStore } from '../state/session';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { rootRoute } from './__root';

const mergeNaming = (current: NamingPreset[], next: NamingPreset): NamingPreset[] => {
  const existingIndex = current.findIndex((item) => item.pairId === next.pairId);
  if (existingIndex === -1) {
    return [...current, next];
  }
  const updated = [...current];
  updated[existingIndex] = next;
  return updated;
};

const NamingStep = () => {
  const { pairs, naming, setNaming } = useSessionStore((state) => ({
    pairs: state.pairs,
    naming: state.naming,
    setNaming: state.setNaming
  }));

  const handleFieldChange = (
    pairId: string,
    field: 'title' | 'subtitle' | 'keywords',
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const value = event.target.value;
    const existing = naming.find((item) => item.pairId === pairId);
    const next: NamingPreset = {
      id: existing?.id ?? `${pairId}-naming`,
      pairId,
      title: existing?.title ?? '',
      subtitle: existing?.subtitle,
      keywords: existing?.keywords ?? []
    };

    if (field === 'keywords') {
      next.keywords = value.split(',').map((keyword) => keyword.trim()).filter(Boolean);
    } else if (field === 'title') {
      next.title = value;
    } else {
      next.subtitle = value;
    }
    setNaming(mergeNaming(naming, next));
  };

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Apply consistent naming
        </Text>
        <Text variant="body">
          Provide listing-friendly titles, optional subtitles, and keyword tags for each image pair.
        </Text>
      </Stack>
      {pairs.length > 0 ? (
        <Stack gap={16}>
          {pairs.map((pair) => {
            const record = naming.find((item) => item.pairId === pair.id);
            return (
              <Stack key={pair.id} className="ui-card" gap={12}>
                <Text as="span" variant="label">
                  Pair {pair.id}
                </Text>
                <label>
                  <Text as="span" variant="muted">
                    Title
                  </Text>
                  <input
                    type="text"
                    value={record?.title ?? ''}
                    onChange={(event) => handleFieldChange(pair.id, 'title', event)}
                    placeholder="e.g. Vintage watch hero shot"
                  />
                </label>
                <label>
                  <Text as="span" variant="muted">
                    Subtitle (optional)
                  </Text>
                  <input
                    type="text"
                    value={record?.subtitle ?? ''}
                    onChange={(event) => handleFieldChange(pair.id, 'subtitle', event)}
                    placeholder="e.g. Natural light detail"
                  />
                </label>
                <label>
                  <Text as="span" variant="muted">
                    Keywords (comma separated)
                  </Text>
                  <input
                    type="text"
                    value={record?.keywords.join(', ') ?? ''}
                    onChange={(event) => handleFieldChange(pair.id, 'keywords', event)}
                    placeholder="e.g. stainless steel, macro"
                  />
                </label>
              </Stack>
            );
          })}
        </Stack>
      ) : (
        <Text variant="muted">Create at least one pair to begin naming.</Text>
      )}
      <StepNavigation step="naming" nextLabel="Output" nextDisabled={pairs.length === 0} />
    </Stack>
  );
};

export const namingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/naming',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (!state.canAccessStep('naming')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: NamingStep
});

