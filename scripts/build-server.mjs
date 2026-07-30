import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'apps/server/src/index.ts')],
  outfile: path.join(root, 'apps/server/dist/index.js'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  minify: false,
  alias: {
    '@what-if-history/contracts': path.join(root, 'packages/contracts/src/index.ts'),
    '@what-if-history/core': path.join(root, 'packages/core/src/index.ts'),
  },
  external: ['node:sqlite'],
  logLevel: 'info',
});
