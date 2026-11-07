// How big the text is: a choice kept on this device. It is not private, so it is stored outside the keys that sign-out clears.
export const TEXT_SIZES = [
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.15 },
  { id: 'xl', label: 'Extra large', scale: 1.3 },
] as const;
export type TextSizeId = (typeof TEXT_SIZES)[number]['id'];
const KEY = 'tlui:textsize';

export function textSize(): TextSizeId {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.some((s) => s.id === v) ? (v as TextSizeId) : 'normal';
  } catch {
    return 'normal';
  }
}
export function applyTextSize(id: TextSizeId = textSize()) {
  document.documentElement.style.setProperty('--text-scale', String(TEXT_SIZES.find((s) => s.id === id)!.scale));
}
export function setTextSize(id: TextSizeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* applies for this visit only */
  }
  applyTextSize(id);
}
