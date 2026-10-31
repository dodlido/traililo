// "Open in maps app": hands the trail to Organic Maps, Maps.me, OsmAnd, Gaia and the like as a GPX file.
import { useState } from 'react';
import { Icon } from './Icon.tsx';
import { toGpx } from './gpx.ts';

const fileName = (n: string) => (n.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'trail') + '.gpx';

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function OpenTrail({ title, lines }: { title: string; lines: number[][][] }) {
  const [note, setNote] = useState('');
  const go = async () => {
    setNote('');
    const file = new File([toGpx(title, lines)], fileName(title), { type: 'application/gpx+xml' });
    try {
      // on a phone this opens the share sheet, which lists every installed maps app
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
    download(file);
    setNote('Saved the file. Open it from your downloads with your maps app.');
  };
  return (
    <>
      <button type="button" className="show-map" onClick={() => void go()}>
        <Icon name="map" size={16} /> Open in maps app
      </button>
      {note && <p className="small">{note}</p>}
    </>
  );
}
