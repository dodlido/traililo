// Shrinks a photo from the device before it is uploaded: long side 1600 px, JPEG. Phone photos are several megabytes.
export async function shrink(file: File, maxSide = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a picture');
  const bmp = await createImageBitmap(file); // applies the phone's rotation
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the picture');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not shrink the picture');
  return blob;
}
