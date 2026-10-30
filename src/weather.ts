// Weather per place: a real forecast when the day is within about two weeks, otherwise what the same dates were like last year.
import type { Trip } from './model.ts';

export interface DayWeather {
  hi: number;
  lo: number;
  rain: number; // mm
  wind: number; // km/h, strongest gusts of the day
  kind: 'forecast' | 'last year';
}
export type WeatherByDate = Record<string, DayWeather>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftYears = (s: string, n: number) => {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return iso(d);
};

const get = (k: string): { at: number; v: WeatherByDate } | null => {
  try {
    return JSON.parse(localStorage.getItem('traililo:wx:' + k) ?? 'null');
  } catch {
    return null;
  }
};
const put = (k: string, v: WeatherByDate) => {
  try {
    localStorage.setItem('traililo:wx:' + k, JSON.stringify({ at: Date.now(), v }));
  } catch {
    /* full */
  }
};

interface Daily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_gusts_10m_max: number[];
}
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max';

async function fetchDaily(url: string): Promise<Daily> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  if (!j.daily) throw new Error('no weather');
  return j.daily as Daily;
}
const round = (n: number | null | undefined) => (typeof n === 'number' ? Math.round(n) : 0);

/** Weather for one stretch of days at one place. Keeps the answer on the phone so it still shows with no signal. */
export async function weatherFor(lat: number, lon: number, dates: string[], today: string): Promise<WeatherByDate> {
  const out: WeatherByDate = {};
  const pt = `latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&timezone=auto`;
  const horizon = iso(new Date(Date.parse(today + 'T00:00:00Z') + 15 * 86400000));
  const near = dates.filter((d) => d >= today && d <= horizon);
  const far = dates.filter((d) => !near.includes(d));
  const run = async (list: string[], mode: 'forecast' | 'last year') => {
    if (!list.length) return;
    const key = `${mode}:${lat.toFixed(2)},${lon.toFixed(2)}:${list[0]}:${list[list.length - 1]}`;
    const hit = get(key);
    const fresh = hit && Date.now() - hit.at < (mode === 'forecast' ? 3 * 3600e3 : 30 * 86400e3);
    if (fresh) return void Object.assign(out, hit.v);
    try {
      const a = mode === 'forecast' ? list[0] : shiftYears(list[0], -1);
      const b = mode === 'forecast' ? list[list.length - 1] : shiftYears(list[list.length - 1], -1);
      const base = mode === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
      const d = await fetchDaily(`${base}?${pt}&start_date=${a}&end_date=${b}&daily=${DAILY}`);
      const got: WeatherByDate = {};
      d.time.forEach((t, i) => {
        const date = mode === 'forecast' ? t : shiftYears(t, 1);
        if (list.includes(date)) got[date] = { hi: round(d.temperature_2m_max[i]), lo: round(d.temperature_2m_min[i]), rain: Math.round((d.precipitation_sum[i] ?? 0) * 10) / 10, wind: round(d.wind_gusts_10m_max[i]), kind: mode };
      });
      put(key, got);
      Object.assign(out, got);
    } catch {
      if (hit) Object.assign(out, hit.v); // old answer beats none
    }
  };
  await Promise.all([run(near, 'forecast'), run(far, 'last year')]);
  return out;
}

/** One line of advice for a stretch of weather, in plain words. */
export function adviceFor(w: DayWeather[]): string[] {
  if (!w.length) return [];
  const lo = Math.min(...w.map((x) => x.lo));
  const hi = Math.max(...w.map((x) => x.hi));
  const wet = w.filter((x) => x.rain >= 2).length;
  const gust = Math.max(...w.map((x) => x.wind));
  const tips: string[] = [];
  if (lo <= 3) tips.push('Freezing mornings possible: warm hat, gloves, thermal layers');
  else if (lo <= 8) tips.push('Cold mornings: a warm mid-layer and a beanie');
  if (hi >= 24) tips.push('Warm afternoons: sun hat, sunscreen, light shirts');
  if (wet >= Math.ceil(w.length / 3)) tips.push('Wet often: rain jacket and waterproof trousers, dry bags');
  else if (wet > 0) tips.push('Some rain: a light rain shell');
  if (gust >= 55) tips.push('Strong gusts: windproof jacket, secure your hat; ferries and boat trips can be cancelled');
  return tips;
}

export const placePoint = (trip: Trip, dates: string[]) => {
  for (const d of trip.days) if (dates.includes(d.date) && d.point) return d.point;
  return undefined;
};
