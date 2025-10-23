export interface ChromiumFeatureReport {
  isChromiumUserAgent: boolean;
  hasFileSystemAccessAPI: boolean;
  hasLaunchQueue: boolean;
  hasViewTransitionAPI: boolean;
}

const isClient = typeof window !== 'undefined' && typeof navigator !== 'undefined';

const CHROMIUM_ENGINES = ['Chromium', 'Google Chrome', 'Microsoft Edge', 'Brave'];

export const detectChromiumFeatures = (): ChromiumFeatureReport => {
  if (!isClient) {
    return {
      isChromiumUserAgent: false,
      hasFileSystemAccessAPI: false,
      hasLaunchQueue: false,
      hasViewTransitionAPI: false
    };
  }

  const uaData = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
  const brands = uaData?.brands?.map((brand) => brand.brand) ?? [];
  const userAgent = navigator.userAgent || '';

  const isChromiumUserAgent =
    brands.some((brand) => CHROMIUM_ENGINES.includes(brand)) ||
    /Chrome\//.test(userAgent) ||
    /Edg\//.test(userAgent);

  const hasFileSystemAccessAPI =
    'showOpenFilePicker' in window || 'chooseFileSystemEntries' in window || 'FileSystemHandle' in window;
  const hasLaunchQueue = 'launchQueue' in window && typeof (window as any).launchQueue === 'object';
  const hasViewTransitionAPI = 'startViewTransition' in document || 'DocumentTransition' in window;

  return {
    isChromiumUserAgent,
    hasFileSystemAccessAPI,
    hasLaunchQueue,
    hasViewTransitionAPI
  };
};

export const shouldRecommendChromiumFromReport = (report: ChromiumFeatureReport): boolean => {
  const hasKeyCapabilities = report.hasFileSystemAccessAPI && report.hasLaunchQueue;
  return !report.isChromiumUserAgent || !hasKeyCapabilities;
};

export const shouldRecommendChromium = (): boolean => {
  if (!isClient) return false;
  const report = detectChromiumFeatures();
  return shouldRecommendChromiumFromReport(report);
};
