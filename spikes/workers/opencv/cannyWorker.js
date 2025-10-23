/*
 * Proof-of-concept Web Worker that loads OpenCV.js on demand and performs
 * Canny edge detection on a synthetic sample image. The worker responds with
 * both timing information and the detected contour count so the host page can
 * visualise performance characteristics.
 */

self.Module = {
  wasmBinaryFile: undefined,
  locateFile(path) {
    // Allow overriding the WASM path when the worker is co-located with the
    // default OpenCV distribution. When loaded from the CDN the runtime will
    // request the wasm next to the script, so we simply return the path.
    return path;
  },
  onRuntimeInitialized() {
    self.postMessage({ type: "status", message: "OpenCV runtime initialised" });
    runCannyPipeline();
  },
};

// OpenCV.js exposes a global `cv` object after importScripts resolves.
importScripts("https://docs.opencv.org/4.x/opencv.js");

async function runCannyPipeline() {
  const timings = {};
  const t0 = performance.now();

  const imageData = await generateSampleImage();
  timings.generate = performance.now() - t0;

  const cvStart = performance.now();
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1.5, 1.5, cv.BORDER_DEFAULT);
  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 50, 150, 3, false);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  timings.opencv = performance.now() - cvStart;

  const contourCount = contours.size();

  src.delete();
  gray.delete();
  blurred.delete();
  edges.delete();
  contours.delete();
  hierarchy.delete();

  self.postMessage({
    type: "result",
    contourCount,
    timings,
    dimensions: { width: imageData.width, height: imageData.height },
  });
}

async function generateSampleImage() {
  const width = 512;
  const height = 512;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#0d6efd";
  ctx.fillRect(64, 64, width - 128, height - 128);

  ctx.strokeStyle = "#dc3545";
  ctx.lineWidth = 12;
  ctx.strokeRect(128, 128, width - 256, height - 256);

  ctx.strokeStyle = "#212529";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(96, height - 96);
  ctx.lineTo(width / 2, 96);
  ctx.lineTo(width - 96, height - 96);
  ctx.stroke();

  return ctx.getImageData(0, 0, width, height);
}

self.onmessage = (event) => {
  if (event.data && event.data.type === "run") {
    self.postMessage({ type: "status", message: "Starting Canny pipeline" });
    runCannyPipeline();
  }
};
