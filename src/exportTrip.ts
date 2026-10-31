// "Export my trip": hands the owner their whole trip as one JSON file (private notes and bookings included).
// Nothing is sent anywhere; the file is made on the device and saved or shared from there.
import type { Trip } from './model.ts';
import { download } from './OpenTrail.tsx';

export async function exportTrip(title: string, trip: Trip, tracks: unknown): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'trip'}-${stamp}.json`;
  const body = JSON.stringify({ app: 'traililo', exportedAt: new Date().toISOString(), title, trip, tracks }, null, 2);
  const file = new File([body], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'Shared.';
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return '';
  }
  download(file);
  return `Saved ${name}.`;
}
