const OPENCV_BASE_URL = 'https://docs.opencv.org/4.x/';
const OPENCV_SCRIPT_URL = `${OPENCV_BASE_URL}opencv.js`;

export type CV = typeof globalThis extends { cv: infer T } ? T : unknown;

type Runtime = {
  cv?: CV;
  Module?: Record<string, unknown>;
  importScripts?: (...urls: string[]) => void;
} & typeof globalThis;

const loadOpenCv = async (): Promise<CV> => {
  const runtime = self as unknown as Runtime;
  if (runtime.cv) {
    return runtime.cv;
  }

  const moduleConfig = {
    locateFile(path: string) {
      if (path.endsWith('.wasm')) {
        return `${OPENCV_BASE_URL}${path}`;
      }
      return `${OPENCV_BASE_URL}${path}`;
    },
    onRuntimeInitialized() {
      /* replaced during load */
    }
  } as Record<string, unknown>;

  runtime.Module = moduleConfig;

  return await new Promise<CV>((resolve, reject) => {
    moduleConfig.onRuntimeInitialized = () => {
      if (!runtime.cv) {
        reject(new Error('OpenCV runtime failed to initialise.'));
        return;
      }
      resolve(runtime.cv);
    };

    try {
      if (typeof runtime.importScripts !== 'function') {
        throw new Error('OpenCV can only be loaded in classic workers with importScripts support.');
      }
      runtime.importScripts(OPENCV_SCRIPT_URL);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to load OpenCV script.'));
    }
  });
};

export const ensureOpenCv = (() => {
  let initPromise: Promise<CV> | null = null;
  return () => {
    if (!initPromise) {
      initPromise = loadOpenCv().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  };
})();
