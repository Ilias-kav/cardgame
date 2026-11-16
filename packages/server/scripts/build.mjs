// Bundles the server (with the workspace packages @cardgame/engine and @cardgame/protocol inlined)
// into plain JavaScript in dist/, so production needs no TypeScript tooling.
// Third-party dependencies stay external and are installed from package.json.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@cardgame/'));

await build({
  entryPoints: { server: 'src/server.ts', migrate: 'src/db/migrate-cli.ts', seed: 'src/db/seed-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  sourcemap: true,
  logLevel: 'info',
});
