// Bundles the viewer into dist/ (app.js, app.css, index.html). Trip data is bundled in,
// so dist/index.html opens straight from disk with no server and works offline.
import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

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
await build({
  entryPoints: ['src/main.tsx'],
  entryNames: 'app',
  outdir: 'dist',
  bundle: true,
  plugins: [workerText],
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  loader: { '.json': 'json', '.woff2': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', __SB_URL__: JSON.stringify(sbUrl), __SB_KEY__: JSON.stringify(sbKey), __GOOGLE_CLIENT_ID__: JSON.stringify(googleId) },
  logLevel: 'info',
});
copyFileSync('src/index.html', 'dist/index.html');
for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `dist/${f}`);
if (existsSync('photos')) cpSync('photos', 'dist/photos', { recursive: true });
