// Shared weather icon mapping — used by Weather and WeatherForecastModal.
import { Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning } from 'lucide-react';

export const WEATHER_ICONS: { max: number; icon: typeof Sun; label: string }[] = [
  { max: 0, icon: Sun, label: 'Clear' },
  { max: 3, icon: CloudSun, label: 'Partly Cloudy' },
  { max: 48, icon: CloudFog, label: 'Fog' },
  { max: 57, icon: CloudDrizzle, label: 'Drizzle' },
  { max: 67, icon: CloudRain, label: 'Rain' },
  { max: 77, icon: CloudSnow, label: 'Snow' },
  { max: 86, icon: CloudSnow, label: 'Snow Showers' },
  { max: Infinity, icon: CloudLightning, label: 'Thunderstorm' },
];

export function weatherInfo(code: number): { icon: typeof Sun; label: string } {
  for (const entry of WEATHER_ICONS) {
    if (code <= entry.max) return { icon: entry.icon, label: entry.label };
  }
  return { icon: Cloud, label: 'Cloudy' };
}
