const MAX_BUFFER = 50;
const buffer: { type: string; data: unknown; timestamp: string }[] = [];

export function addToEventBuffer(type: string, data: unknown): void {
  buffer.push({ type, data, timestamp: new Date().toISOString() });
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

export function getBufferedEvents(
  type?: string,
): { type: string; data: unknown; timestamp: string }[] {
  if (!type) return [...buffer];
  return buffer.filter((e) => e.type === type);
}
