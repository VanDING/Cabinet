export interface BufferedEvent {
  type: string;
  data: unknown;
}

const buffers = new Map<string, BufferedEvent[]>();
const MAX_SIZE = 50;

export function addToEventBuffer(type: string, data: unknown): void {
  if (!buffers.has(type)) buffers.set(type, []);
  const arr = buffers.get(type)!;
  arr.push({ type, data });
  if (arr.length > MAX_SIZE) arr.shift();
}

export function getBufferedEvents(type?: string): BufferedEvent[] {
  if (!type) {
    const all: BufferedEvent[] = [];
    for (const arr of buffers.values()) all.push(...arr);
    return all;
  }
  const arr = buffers.get(type);
  if (!arr) return [];
  return [...arr];
}

export function consumeBufferedEvents(type: string): BufferedEvent[] {
  const arr = buffers.get(type);
  if (!arr) return [];
  buffers.set(type, []); // clear after consume
  return arr;
}
