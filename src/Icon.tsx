import type { ReactElement } from 'react';
const P: Record<string, ReactElement> = {
  journey: (<><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>),
  map: (<><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>),
  bed: (<><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.4" /></>),
  tent: (<><path d="M3.5 20 12 6l8.5 14M2 20h20M12 6V3.5" /><path d="M9 20l3-6.5 3 6.5" /></>),
  hike: <path d="M2.5 19l6-10 4 6 2.2-3.2 6.8 7.2z" />,
  flight: <path d="M2 13l8-2 4-8 2 1-2 8 6 2 1 2-8-1-3 5-2-1 1-5z" />,
  bus: (<><path d="M4 16V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8M4 16h16M7 19v-3M17 19v-3M4 11h16" /></>),
  ferry: (<><path d="M3 15l2 5h14l2-5zM12 4v8M12 6l5 5h-5" /></>),
  spark: <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />,
  note: <path d="M5 4h14v16H5zM8 9h8M8 13h6" />,
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  eye: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  flag: <path d="M5 21V4M5 5h12l-2 4 2 4H5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] ?? P.note}
    </svg>
  );
}

export const modeIcon = (mode?: string) => (mode === 'flight' ? 'flight' : mode === 'ferry' ? 'ferry' : 'bus');
