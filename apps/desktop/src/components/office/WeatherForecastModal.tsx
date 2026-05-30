import { useState, useEffect } from 'react';
import { X, Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning } from 'lucide-react';

interface DailyForecast {
  date: string;
  high: number;
  low: number;
  code: number;
  precip: number;
}

interface Props {
  onClose: () => void;
}

const WEATHER_ICONS: { max: number; icon: typeof Sun; label: string }[] = [
  { max: 0, icon: Sun, label: 'Clear' },
  { max: 3, icon: CloudSun, label: 'Partly Cloudy' },
  { max: 48, icon: CloudFog, label: 'Fog' },
  { max: 57, icon: CloudDrizzle, label: 'Drizzle' },
  { max: 67, icon: CloudRain, label: 'Rain' },
  { max: 77, icon: CloudSnow, label: 'Snow' },
  { max: 86, icon: CloudSnow, label: 'Snow Showers' },
  { max: Infinity, icon: CloudLightning, label: 'Thunderstorm' },
];

function weatherInfo(code: number): { icon: typeof Sun; label: string } {
  for (const entry of WEATHER_ICONS) {
    if (code <= entry.max) return { icon: entry.icon, label: entry.label };
  }
  return { icon: Cloud, label: 'Cloudy' };
}

export function WeatherForecastModal({ onClose }: Props) {
  const [forecast, setForecast] = useState<DailyForecast[]>([]);
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchForecast(lat: number, lon: number) {
      try {
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=7`,
        );
        if (!weatherRes.ok) throw new Error('API error');
        const j = await weatherRes.json();
        if (cancelled) return;

        let city = `${lat.toFixed(1)}deg, ${lon.toFixed(1)}deg`;
        try {
          const geoRes = await fetch('/api/geoip');
          if (geoRes.ok) {
            const geo = await geoRes.json();
            if (geo.city) city = geo.city;
          }
        } catch { /* use coordinates fallback */ }

        const days: DailyForecast[] = [];
        for (let i = 0; i < j.daily.time.length; i++) {
          days.push({
            date: j.daily.time[i],
            high: Math.round(j.daily.temperature_2m_max[i]),
            low: Math.round(j.daily.temperature_2m_min[i]),
            code: j.daily.weather_code[i],
            precip: j.daily.precipitation_probability_max[i] ?? 0,
          });
        }

        setForecast(days);
        setCity(city);
      } catch {
        if (!cancelled) setError('Unable to load forecast');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    function onPos(pos: GeolocationPosition) {
      fetchForecast(pos.coords.latitude, pos.coords.longitude);
    }

    function onPosError() {
      fetchForecast(40.7, -74.0);
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(onPos, onPosError, { timeout: 8000 });
    } else {
      onPosError();
    }

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="m-4 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface-primary shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-lg font-semibold text-content-primary">
            7-Day Forecast{city ? ` - ${city}` : ''}
          </h3>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-content-tertiary">{error}</div>
        ) : (
          <div className="px-5 pb-4">
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 gap-y-2">
              {/* Header row */}
              <div className="text-[10px] font-medium uppercase tracking-wider text-content-tertiary" />
              <div className="text-[10px] font-medium uppercase tracking-wider text-content-tertiary" />
              <div className="text-right text-[10px] font-medium uppercase tracking-wider text-content-tertiary">High</div>
              <div className="text-right text-[10px] font-medium uppercase tracking-wider text-content-tertiary">Low</div>

              {forecast.map((day) => {
                const info = weatherInfo(day.code);
                const Icon = info.icon;
                const date = new Date(day.date + 'T12:00');
                const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
                const isToday =
                  new Date().toISOString().slice(0, 10) === day.date;

                return (
                  <div key={day.date} className="contents text-xs">
                    <span className={`py-1.5 ${isToday ? 'font-medium text-accent' : 'text-content-secondary'}`}>
                      {isToday ? 'Today' : dayName}
                    </span>
                    <div className="flex items-center gap-2 py-1.5">
                      <Icon size={14} className="text-content-tertiary" />
                      <span className="text-content-secondary">{info.label}</span>
                      {day.precip > 0 && (
                        <span className="text-[10px] text-content-tertiary">{day.precip}%</span>
                      )}
                    </div>
                    <span className="py-1.5 text-right tabular-nums text-content-primary">
                      {day.high}&deg;
                    </span>
                    <span className="py-1.5 text-right tabular-nums text-content-tertiary">
                      {day.low}&deg;
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
