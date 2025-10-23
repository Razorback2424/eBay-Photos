const OPENCV_BASE_URL = 'https://docs.opencv.org/4.x/';
const OPENCV_SCRIPT_URL = `${OPENCV_BASE_URL}opencv.js`;

export type CV = typeof globalThis extends { cv: infer T } ? T : any;

type Runtime = {
  cv?: CV;
  Module?: Record<string, unknown>;
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

  const response = await fetch(OPENCV_SCRIPT_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenCV.js (${response.status})`);
  }
  const source = await response.text();

  return await new Promise<CV>((resolve, reject) => {
    moduleConfig.onRuntimeInitialized = () => {
      if (!runtime.cv) {
        reject(new Error('OpenCV runtime failed to initialise.'));
        return;
      }
      resolve(runtime.cv);
    };

    try {
      const evaluator = new Function('self', source);
      evaluator(self);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to evaluate OpenCV script.'));
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
