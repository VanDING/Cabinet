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

    async function fetchWeather(lat: number, lon: number, city: string) {
      try {
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`,
        );
        if (!weatherRes.ok) throw new Error('API error');
        const j = await weatherRes.json();
        if (cancelled) return;

        const c = j.current;
        const info = weatherInfo(c.weather_code);
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

    async function load() {
      // Primary: IP geolocation gives matched city + coords (works in China, no GPS needed)
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const ipRes = await fetch('/api/geoip', { signal: ctrl.signal });
        clearTimeout(t);
        if (ipRes.ok) {
          const ip = await ipRes.json();
          const ipCity = ip.city || ip.region || `${ip.latitude}deg, ${ip.longitude}deg`;
          // Use GPS coords for better precision if available, but keep IP city
          if ('geolocation' in navigator && !cancelled) {
            const gpsTimeout = setTimeout(() => {
              fetchWeather(ip.latitude, ip.longitude, ipCity);
            }, 6000);
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                clearTimeout(gpsTimeout);
                if (!cancelled) fetchWeather(pos.coords.latitude, pos.coords.longitude, ipCity);
              },
              () => {
                clearTimeout(gpsTimeout);
                if (!cancelled) fetchWeather(ip.latitude, ip.longitude, ipCity);
              },
              { timeout: 5000 },
            );
            return;
          }
          fetchWeather(ip.latitude, ip.longitude, ipCity);
          return;
        }
      } catch { /* IP lookup failed */ }

      // Fallback: GPS → hardcoded city
      if ('geolocation' in navigator && !cancelled) {
        navigator.geolocation.getCurrentPosition(
          (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude, 'Unknown'),
          () => fetchWeather(40.7, -74.0, 'New York'),
          { timeout: 8000 },
        );
      } else {
        fetchWeather(40.7, -74.0, 'New York');
      }
    }

    load();

    return () => { cancelled = true; };
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
