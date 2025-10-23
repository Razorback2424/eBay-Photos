import { useEffect, useMemo, useState } from 'react';

import {
  ChromiumFeatureReport,
  detectChromiumFeatures,
  shouldRecommendChromiumFromReport
} from '../utils/chromium';
import { Button } from '../ui/Button';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';

const STORAGE_KEY = 'ebay-photos.chromium-banner.dismissed';

export const BannerChromium = () => {
  const [report, setReport] = useState<ChromiumFeatureReport | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const detected = detectChromiumFeatures();
    setReport(detected);
    if (!shouldRecommendChromiumFromReport(detected)) {
      setDismissed(true);
    }
  }, []);

  const shouldRender = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (dismissed) return false;
    if (!report) return false;
    return shouldRecommendChromiumFromReport(report);
  }, [dismissed, report]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    }
  };

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="chromium-banner" role="status" aria-live="polite">
      <Stack direction="row" gap={16} align="center" className="chromium-banner__content">
        <Stack gap={4}>
          <Text variant="label">Chromium recommended</Text>
          <Text variant="body">
            For the best experience with the file system and automation features, use a Chromium-based
            browser such as Chrome, Edge, or Brave.
          </Text>
        </Stack>
        <div className="chromium-banner__actions">
          <Button variant="ghost" onClick={handleDismiss} aria-label="Dismiss Chromium recommendation banner">
            Dismiss
          </Button>
        </div>
      </Stack>
    </div>
  );
};
