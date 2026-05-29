import { useState, useEffect } from 'react';

interface WeatherData {
  temp: number;
  desc: string;
  humidity: number;
  city: string;
  code: number;
}

function weatherDesc(code: number): string {
  if (code <= 3) return 'Clear';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow Showers';
  return 'Thunderstorm';
}

function weatherEmoji(code: number): string {
  if (code <= 1) return '☀️';
  if (code <= 3) return '\u{1F324}️';
  if (code <= 48) return '\u{1F32B}️';
  if (code <= 57) return '\u{1F326}️';
  if (code <= 67) return '\u{1F327}️';
  if (code <= 77) return '\u{1F328}️';
  if (code <= 82) return '\u{1F326}️';
  if (code <= 86) return '\u{1F328}️';
  return '⛈️';
}

export function Weather() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather(lat: number, lon: number) {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`,
        );
        if (!res.ok) throw new Error('API error');
        const j = await res.json();
        if (cancelled) return;
        const c = j.current;
        setData({
          temp: Math.round(c.temperature_2m),
          humidity: c.relative_humidity_2m,
          code: c.weather_code,
          desc: weatherDesc(c.weather_code),
          city: `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
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

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-hidden rounded-lg border bg-white p-3">
      {data ? (
        <>
          <span className="text-2xl">{weatherEmoji(data.code)}</span>
          <span className="mt-1 text-xl font-bold text-gray-800">
            {data.temp}&deg;C
          </span>
          <span className="truncate text-xs text-gray-500">{data.desc}</span>
          <span className="mt-0.5 text-[10px] text-gray-400">Humidity {data.humidity}%</span>
          <span className="truncate text-[10px] text-gray-400">{data.city}</span>
        </>
      ) : error ? (
        <div className="text-center text-xs text-gray-400">
          <span className="text-xl">{'☀️'}</span>
          <div>{error}</div>
        </div>
      ) : (
        <div className="text-center text-xs text-gray-400">
          <span className="animate-pulse text-xl">{'\u{1F321}️'}</span>
          <div>Loading...</div>
        </div>
      )}
    </div>
  );
}
