// What the map pickers know about the plan: the places and lines of the trip, and which one the day being edited starts from.
// The maps themselves are in PickMap.tsx.
import { createContext } from 'react';
import type { Point, Trip } from './model.ts';


/** What the editors know about the plan, so a map can show it: the whole trip and the day being worked on. */
export const PlanCtx = createContext<{ trip: Trip; date?: string; tracks?: Record<string, { lines: number[][][] }> } | null>(null);

export type PlanKind = 'stay' | 'hike' | 'activity' | 'travel' | 'spot' | 'town';
export interface PlanPlace { name: string; kind: PlanKind; point: Point }

/** Every place in the plan that has a spot on the map. */
export function planPlaces(trip: Trip, tracks?: Record<string, { lines: number[][][] }>): PlanPlace[] {
  const out: PlanPlace[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: PlanKind, point?: Point) => {
    if (!point) return;
    const k = `${kind}${point.lat.toFixed(3)}${point.lon.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ name, kind, point });
  };
  const regions = new Set<string>();
  for (const d of trip.days) {
    if (d.point && !regions.has(d.region)) { regions.add(d.region); add(d.region, 'town', d.point); }
    for (const e of d.entries) {
      if (e.kind === 'commute') { for (const l of e.legs ?? []) { add(l.from || 'Start', 'travel', l.fromPoint); add(l.to || 'End', 'travel', l.toPoint); } }
      else if (e.kind === 'hike') { const t0 = tracks?.[e.id]?.lines[0]?.[0]; add(e.title, 'hike', e.at ?? (t0 ? { lat: t0[1], lon: t0[0] } : undefined)); for (const w of e.waypoints ?? []) add(w.name, 'hike', w.point); }
      else add(e.title, 'activity', e.at);
    }
  }
  for (const st of trip.stays) add(st.name, 'stay', st.point);
  for (const po of trip.pois ?? []) add(po.name, 'spot', po.point);
  for (const l of trip.lines ?? []) for (const x of l.stops ?? []) add(x.name, 'spot', x.point);
  return out;
}

export interface PlanLine { coords: number[][]; color: string; dash: boolean }

/** Every trail and drive in the plan, as lines. */
export function planLines(trip: Trip, tracks?: Record<string, { lines: number[][][] }>): PlanLine[] {
  const out: PlanLine[] = [];
  const hikeIds = new Set<string>();
  for (const d of trip.days) {
    for (const e of d.entries) {
      if (e.kind === 'hike') hikeIds.add(e.id);
      if (e.kind === 'commute') {
        for (const l of e.legs ?? []) {
          const coords = l.path?.length ? l.path : l.fromPoint && l.toPoint ? [[l.fromPoint.lon, l.fromPoint.lat], [l.toPoint.lon, l.toPoint.lat]] : null;
          if (coords) out.push({ coords, color: LINE_COLOR[l.mode] ?? '#b3261e', dash: l.mode === 'flight' || l.mode === 'ferry' });
        }
      }
    }
  }
  for (const id of hikeIds) for (const ln of tracks?.[id]?.lines ?? []) if (ln.length > 1) out.push({ coords: ln, color: '#3f7a2c', dash: false });
  const lc: Record<string, string> = { drive: '#b3261e', ferry: '#1f5f8b', trek: '#3f7a2c', scenic: '#7a2e8a' };
  for (const l of trip.lines ?? []) if (l.points.length > 1) out.push({ coords: l.points.map((q) => [q.lon, q.lat]), color: lc[l.mode] ?? '#b3261e', dash: l.mode === 'ferry' || l.mode === 'trek' });
  return out;
}

const LINE_COLOR: Record<string, string> = { drive: '#b3261e', bus: '#b3261e', taxi: '#b3261e', ferry: '#1f5f8b', flight: '#7a2e8a' };

/** Where a map for this day should open when nothing has been chosen yet. */
export function planAnchor(trip: Trip, date?: string): Point | undefined {
  const d = date ? trip.days.find((x) => x.date === date) : undefined;
  return d?.point ?? trip.stays.find((x) => x.id === d?.stayId)?.point;
}

