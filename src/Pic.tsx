import { useEffect, useState } from 'react';
import type { DrivePhoto } from './model.ts';
import { peekPicture, pictureBlob, pictureSrc } from './drive.ts';

/** A picture from Drive, as a background-ready <img>. Shows nothing until Google is connected. */
export function Pic({ photo, ready, size = 900, alt = '' }: { photo?: DrivePhoto; ready: boolean; size?: number; alt?: string }) {
  const [src, setSrc] = useState(() => (photo && ready ? (peekPicture(photo.id, size) ?? '') : ''));
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setTried(false);
    if (!photo || !ready) {
      setSrc('');
      return;
    }
    const have = peekPicture(photo.id, size);
    if (have) setSrc(have);
    let live = true;
    pictureSrc(photo.id, size).then(
      (s) => live && setSrc(s),
      () => live && setSrc(''),
    );
    return () => {
      live = false;
    };
  }, [photo?.id, ready, size]);
  if (!photo || !src) return <span className="recap-blank" aria-hidden="true" />;
  const fallback = () => {
    if (tried) return;
    setTried(true);
    pictureBlob(photo.id).then(setSrc, () => setSrc(''));
  };
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={fallback} />;
}
