// Bundles the viewer into dist/ (app.js, app.css, index.html). Trip data is bundled in,
// so dist/index.html opens straight from disk with no server and works offline.
import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { headTags } from './csp.mjs';

// MapLibre's worker script is inlined as text so the map also works when index.html is opened from disk.
const workerText = {
  name: 'worker-text',
  setup(b) {
    b.onResolve({ filter: /^worker-text$/ }, () => ({ path: 'worker-text', namespace: 'wt' }));
    b.onLoad({ filter: /.*/, namespace: 'wt' }, () => ({
      contents: 'export default ' + JSON.stringify(readFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'utf8').replace(/export\{[^}]*\};?/g, '').replace(/\/\/# sourceMappingURL=.*$/m, '')),
      loader: 'js',
    }));
  },
};

// Optional overrides for the database address, e.g. SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/build.mjs
const sbUrl = process.env.SUPABASE_URL ?? '';
const sbKey = process.env.SUPABASE_ANON_KEY ?? '';
// The public id of the Google project that lets people connect Gmail. Empty hides the feature.
const googleId = process.env.GOOGLE_CLIENT_ID ?? '';

mkdirSync('dist', { recursive: true });
// Old builds are removed first, so files that no longer exist are not published or cached.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/main.tsx'],
  entryNames: 'app',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'fonts/[name]-[hash]',
  outdir: 'dist',
  bundle: true,
  splitting: true, // the map, the film and the booking import are fetched when first used
  metafile: true,
  plugins: [workerText],
  minify: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  loader: { '.json': 'json', '.woff2': 'file', '.woff': 'file', '.png': 'dataurl', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', __SB_URL__: JSON.stringify(sbUrl), __SB_KEY__: JSON.stringify(sbKey), __GOOGLE_CLIENT_ID__: JSON.stringify(googleId), __LOCAL_PHOTOS__: JSON.stringify(existsSync('photos')) },
  logLevel: 'info',
});
writeFileSync('dist/index.html', readFileSync('src/index.html', 'utf8').replace('<!--CSP-->', headTags));
for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `dist/${f}`);
// The service worker keeps every file the app needs, so a trip opens with no signal even if the film or the map was never
// opened on this phone. The list and the cache name come from this build, so each release replaces the old files.
const built = Object.keys(result.metafile.outputs).map((f) => f.replace(/^dist\//, '')).filter((f) => !f.endsWith('.map'));
const shell = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', ...built.map((f) => `./${f}`)];
const stamp = Date.now().toString(36);
writeFileSync(
  'dist/sw.js',
  readFileSync('dist/sw.js', 'utf8')
    .replace(/\/\*SHELL\*\/\s*\[[^\]]*\]/, JSON.stringify(shell))
    .replace(/traililo-app-[\w-]+/, `traililo-app-${stamp}`),
);
if (existsSync('photos')) cpSync('photos', 'dist/photos', { recursive: true });
