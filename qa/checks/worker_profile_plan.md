# Worker throughput profiling plan

Because the export worker depends on browser APIs (OffscreenCanvas, ImageBitmap,
OpenCV WASM) the profiling workflow must run inside Chromium. Use the following
steps when real 48 MP HEIC assets are available:

1. Launch the web client in production mode to avoid development-time throttling.
   - `npm install` *(fails offline; run on a machine with registry access).*
   - `npm run build && npm run preview`.
2. Capture a 48 MP HEIC asset from an iPhone and drop into `qa/assets/heic/`.
3. In Chrome, open DevTools > Performance panel and start a recording.
4. Upload a mixed batch (HEIC + JPEG) and progress to the export step with
   warped fronts enabled.
5. Trigger the export twice:
   - once with directory access granted;
   - once forcing the ZIP fallback (deny directory permission).
6. Record the worker thread's total processing time and main thread frame budget.
7. Export the trace as JSON and attach the summary to `qa/reports/mvp-readout.md`.

Document observed frame drops (>16 ms) or long tasks (>50 ms) as blockers.