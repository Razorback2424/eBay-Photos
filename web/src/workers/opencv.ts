const OPENCV_BASE_URL = new URL(import.meta.env.BASE_URL, self.location.origin);
const OPENCV_SCRIPT_URL = new URL('opencv.js', OPENCV_BASE_URL).href;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = typeof globalThis extends { cv: infer T } ? T : any;

type Runtime = {
  cv?: CV;
  Module?: Record<string, unknown>;
  importScripts?: (...urls: string[]) => void;
  eval?: (script: string) => void;
} & typeof globalThis;

const loadScriptIntoWorker = async (runtime: Runtime) => {
  if (typeof runtime.importScripts === 'function') {
    runtime.importScripts(OPENCV_SCRIPT_URL);
    return;
  }

  const response = await fetch(OPENCV_SCRIPT_URL);
  if (!response.ok) {
    throw new Error(`Failed to load OpenCV script (${response.status}).`);
  }

  const scriptSource = await response.text();
  if (typeof runtime.eval !== 'function') {
    throw new Error('OpenCV could not be evaluated in this worker context.');
  }
  runtime.eval(scriptSource);
};

const loadOpenCv = async (): Promise<CV> => {
  const runtime = self as unknown as Runtime;
  if (runtime.cv) {
    return runtime.cv;
  }

  const moduleConfig = {
    locateFile(path: string) {
      if (path.endsWith('.wasm')) {
        return new URL(path, OPENCV_BASE_URL).href;
      }
      return new URL(path, OPENCV_BASE_URL).href;
    },
    onRuntimeInitialized() {
      /* replaced during load */
    }
  } as Record<string, unknown>;

  runtime.Module = moduleConfig;

  return await new Promise<CV>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('OpenCV runtime initialization timed out.'));
    }, 8000);

    const finalizeResolve = (value: CV) => {
      clearTimeout(timeoutId);
      resolve(value);
    };

    const finalizeReject = (error: unknown) => {
      clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error('Failed to load OpenCV script.'));
    };

    moduleConfig.onRuntimeInitialized = () => {
      if (!runtime.cv) {
        finalizeReject(new Error('OpenCV runtime failed to initialise.'));
        return;
      }
      finalizeResolve(runtime.cv);
    };

    loadScriptIntoWorker(runtime).catch((error) => {
      finalizeReject(error);
    });
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
