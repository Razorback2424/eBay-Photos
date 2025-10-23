# Spike summaries

## File System Access API capability probe

- Location: [`docs/spikes/file-access/index.html`](./file-access/index.html)
- Provides on-page feature detection for `showOpenFilePicker`, `showDirectoryPicker`,
  `showSaveFilePicker`, and `FileSystemWritableFileStream`.
- Action buttons surface the browser's actual responses and error payloads in an
  append-only log for quick validation when testing behind feature flags.
- Chromium browsers may require the `--enable-features=FileSystemAccessAPI` flag.
  For local file testing also consider `--allow-file-access-from-files` so the page
  can open directories without serving from localhost.

## OpenCV.js worker prototype

- Location: [`spikes/workers/opencv/`](../../spikes/workers/opencv/)
- Dedicated worker imports OpenCV.js from the official CDN, synthesises a 512×512 test
  pattern via `OffscreenCanvas`, and executes a Canny edge detection followed by
  `findContours`.
- Results (contour count, per-stage timings, and canvas dimensions) are posted back to
  the main thread; see [`demo.html`](../../spikes/workers/opencv/demo.html) for host-side
  wiring and log rendering.
- When hosting from the filesystem, Chrome requires
  `--allow-file-access-from-files` so the worker can fetch `opencv_js.wasm`. Disable
  cross-origin isolation in DevTools or serve via `npx http-server` to avoid WASM fetch
  errors.

## HEIC decoding via libheif-js

- Location: [`spikes/heic-decode/index.html`](../../spikes/heic-decode/index.html)
- Loads `libheif-js@1.15.1` from UNPKG, decodes a user-selected HEIC asset, and converts
  the decoded frame into an `ImageBitmap` for canvas preview.
- Logs pipeline timings (decode, color conversion, bitmap upload) and reports image
  resolution to gauge 12–48 MP throughput. Rendering is capped to a 1024px preview to
  keep memory usage predictable.
- Required Chromium flags when running from disk: `--allow-file-access-from-files` to
  permit WASM fetches, and optionally `--enable-unsafe-webgpu` if the decoded bitmap
  should feed into GPU workflows. Safari Technology Preview currently lacks
  `createImageBitmap` support for HEIC decoding without enabling the
  “HEIF Image Support” experimental feature.
