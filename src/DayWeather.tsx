// A small weather line at the top of each upcoming day.
import { useEffect, useState } from 'react';
import type { Day, Trip } from './model.ts';
import { regionRuns } from './derive.ts';
import { todayDate } from './today.ts';
import { weatherFor, placePoint, type DayWeather as W, type WeatherByDate } from './weather.ts';

const pending = new Map<string, Promise<WeatherByDate>>();

export function DayWeather({ trip, day }: { trip: Trip; day: Day }) {
  const [w, setW] = useState<W | null>(null);
  const today = todayDate();
  useEffect(() => {
    if (day.date < today) return;
    const run = regionRuns(trip).find((r) => r.days.some((d) => d.date === day.date));
    if (!run) return;
    const dates = run.days.map((d) => d.date);
    const p = placePoint(trip, dates);
    if (!p) return;
    const key = run.region + dates[0] + today;
    let job = pending.get(key);
    if (!job) pending.set(key, (job = weatherFor(p.lat, p.lon, dates, today)));
    let live = true;
    job.then((all) => live && setW(all[day.date] ?? null));
    return () => {
      live = false;
    };
  }, [trip, day.date, today]);
  if (!w) return null;
  return (
    <p className="wx-chip" aria-label="Weather">
      <b>
        {w.lo}° to {w.hi}°
      </b>
      <span>
        {w.rain >= 2 ? `rain ${Math.round(w.rain)} mm` : 'dry'} · gusts {w.wind} km/h · {w.kind === 'forecast' ? 'forecast' : 'same day last year'}
      </span>
    </p>
  );
}
