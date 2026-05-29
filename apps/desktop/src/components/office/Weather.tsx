import { useState, useEffect } from 'react';
import { Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning } from 'lucide-react';

interface WeatherData {
  temp: number;
  desc: string;
  humidity: number;
  city: string;
  code: number;
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

interface Props {
  onExpand?: () => void;
}

export function Weather({ onExpand }: Props) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather(lat: number, lon: number) {
      try {
        const [weatherRes, geoRes] = await Promise.all([
          fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`,
          ),
          fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`,
          ),
        ]);

        if (!weatherRes.ok) throw new Error('API error');
        const j = await weatherRes.json();
        if (cancelled) return;

        const c = j.current;
        const info = weatherInfo(c.weather_code);

        let city = `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
        if (geoRes.ok) {
          const geo = await geoRes.json();
          if (geo.address) {
            city = geo.address.city || geo.address.town || geo.address.village || geo.address.county || city;
          }
        }

        setData({
          temp: Math.round(c.temperature_2m),
          humidity: c.relative_humidity_2m,
          code: c.weather_code,
          desc: info.label,
          city,
        });
      } catch {
        if (!cancelled) setError('Unavailable');
      }
    }

    function onPos(pos: GeolocationPosition) {
      fetchWeather(pos.coords.latitude, pos.coords.longitude);
    }

    function onPosError() {
      fetchWeather(40.7, -74.0);
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(onPos, onPosError, { timeout: 8000 });
    } else {
      onPosError();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const content = data ? (
    <>
      {(() => {
        const Icon = weatherInfo(data.code).icon;
        return <Icon size={28} className="text-content-secondary" />;
      })()}
      <span className="mt-1 text-xl font-bold text-content-primary">{data.temp}&deg;C</span>
      <span className="text-xs text-content-tertiary">{data.desc}</span>
      <span className="text-[10px] text-content-tertiary">Humidity {data.humidity}%</span>
      <span className="truncate text-[10px] text-content-tertiary">{data.city}</span>
    </>
  ) : error ? (
    <div className="text-center text-xs text-content-tertiary">
      <Cloud size={24} className="mx-auto text-content-tertiary" />
      <div className="mt-1">{error}</div>
    </div>
  ) : (
    <div className="text-center text-xs text-content-tertiary">
      <Sun size={24} className="mx-auto animate-pulse text-content-tertiary" />
      <div className="mt-1">Loading...</div>
    </div>
  );

  return (
    <div
      onClick={onExpand}
      className={`flex h-full flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-primary shadow-sm p-3 ${
        onExpand ? 'cursor-pointer transition-shadow hover:shadow-md' : ''
      }`}
    >
      {content}
    </div>
  );
}
