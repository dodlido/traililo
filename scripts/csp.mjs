// The one list of outside places the app may talk to. The build turns it into a Content-Security-Policy meta tag,
// so a script that sneaks into the page (a bad package, say) cannot send your data to a server that is not listed here.
// Add a service here when the app starts using it; a missing entry shows up as a console message "Refused to ...".
// A native app shell adds its own origin to 'self' entries here; keep this the only place that changes.
const SUPABASE = 'https://*.supabase.co';
const GOOGLE_API = ['https://www.googleapis.com', 'https://gmail.googleapis.com', 'https://photospicker.googleapis.com'];
const GOOGLE_IMG = ['https://*.googleusercontent.com', 'https://drive.google.com'];
const MAP_TILES = ['https://server.arcgisonline.com', 'https://s3.amazonaws.com']; // satellite/terrain tiles, elevation
const WIKIMEDIA = ['https://commons.wikimedia.org', 'https://upload.wikimedia.org']; // place pictures
const LOOKUPS = ['https://nominatim.openstreetmap.org', 'https://router.project-osrm.org', 'https://overpass-api.de', 'https://api.open-meteo.com', 'https://archive-api.open-meteo.com'];

const policy = {
  'default-src': ["'none'"],
  'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
  // React and MapLibre set style attributes on elements; there is no way to allow that without 'unsafe-inline' for styles
  'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
  'font-src': ["'self'", 'data:'],
  'img-src': ["'self'", 'data:', 'blob:', SUPABASE, ...MAP_TILES, ...WIKIMEDIA, ...GOOGLE_IMG],
  'media-src': ["'self'", 'blob:', 'data:'],
  'connect-src': ["'self'", 'blob:', SUPABASE, 'https://accounts.google.com', ...GOOGLE_API, ...GOOGLE_IMG, ...MAP_TILES, ...WIKIMEDIA, ...LOOKUPS],
  'frame-src': ['https://accounts.google.com'],
  'worker-src': ["'self'", 'blob:'], // the map's worker is started from a blob
  'child-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

export const csp = Object.entries(policy)
  .map(([k, v]) => `${k} ${v.join(' ')}`)
  .join('; ');

/** The tags the build puts in the page head. "strict-origin" sends only the site address (never the page path) to other sites;
 *  Nominatim's usage rules ask for a Referer, so "no-referrer" would risk being blocked. */
export const headTags = `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n  <meta name="referrer" content="strict-origin" />`;
