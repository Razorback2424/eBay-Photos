import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const root = process.cwd();
const outDir = await mkdtemp(path.join(tmpdir(), 'cardworks-unit-'));
const outFile = path.join(outDir, 'unit-tests.mjs');

try {
  await build({
    entryPoints: [path.join(root, 'tests/unit.test.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: 'inline',
    logLevel: 'silent'
  });

  await import(pathToFileURL(outFile).href);
} finally {
  await rm(outDir, { recursive: true, force: true });
}
