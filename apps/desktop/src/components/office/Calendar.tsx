import { useState, useCallback } from 'react';

const STORAGE_KEY = 'cabinet-calendar-notes';

function loadNotes(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNotes(notes: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function Calendar() {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [notesByDate, setNotesByDate] = useState<Record<string, string[]>>(loadNotes);

  const persistAndSet = useCallback((updated: Record<string, string[]>) => {
    setNotesByDate(updated);
    saveNotes(updated);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const todayStr = toDateStr(today);
  const selectedStr = toDateStr(selectedDate);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const selectedNotes = notesByDate[selectedStr] ?? [];

  const addNote = () => {
    const updated = { ...notesByDate, [selectedStr]: [...selectedNotes, ''] };
    persistAndSet(updated);
  };

  const updateNote = (index: number, value: string) => {
    const next = [...selectedNotes];
    next[index] = value;
    const updated = { ...notesByDate, [selectedStr]: next };
    persistAndSet(updated);
  };

  const deleteNote = (index: number) => {
    const next = selectedNotes.filter((_, i) => i !== index);
    const updated = next.length > 0
      ? { ...notesByDate, [selectedStr]: next }
      : { ...notesByDate };
    if (next.length === 0) delete updated[selectedStr];
    persistAndSet(updated);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-primary shadow-xs p-3">
      {/* Month navigation */}
      <div className="mb-1 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded-sm px-1 text-xs text-content-tertiary hover:text-content-secondary"
        >
          &#8249;
        </button>
        <div className="text-xs font-medium text-content-secondary">
          {MONTHS[month]} {year}
        </div>
        <button
          onClick={nextMonth}
          className="rounded-sm px-1 text-xs text-content-tertiary hover:text-content-secondary"
        >
          &#8250;
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-[10px] text-content-tertiary">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 text-center">
        {weeks.flat().map((d, i) => {
          const dateStr = d
            ? `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            : null;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedStr;
          const hasNotes = dateStr ? (notesByDate[dateStr]?.length ?? 0) > 0 : false;

          return (
            <button
              key={i}
              onClick={() => {
                if (d) {
                  setSelectedDate(new Date(year, month, d));
                  setViewDate(new Date(year, month, 1));
                }
              }}
              disabled={!d}
              className={`relative flex h-[22px] items-center justify-center text-[11px] ${
                isToday
                  ? 'rounded bg-accent font-semibold text-content-inverse'
                  : isSelected
                    ? 'rounded bg-accent-muted font-medium text-accent'
                    : d
                      ? 'text-content-secondary hover:rounded hover:bg-surface-muted'
                      : ''
              }`}
            >
              {d ?? ''}
              {hasNotes && !isToday && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent" />
              )}
              {hasNotes && isToday && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-content-inverse" />
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="my-1.5 border-t border-border" />

      {/* Notes for selected date */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {selectedNotes.map((note, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={note}
              onChange={(e) => updateNote(i, e.target.value)}
              placeholder="..."
              className="min-w-0 flex-1 rounded-sm bg-surface-muted px-2 py-1 text-[11px] text-content-primary outline-hidden placeholder:text-content-tertiary"
            />
            <button
              onClick={() => deleteNote(i)}
              className="shrink-0 text-xs text-content-tertiary hover:text-intent-danger"
            >
              &#10005;
            </button>
          </div>
        ))}
        <button
          onClick={addNote}
          className="flex w-full items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-content-tertiary hover:bg-surface-muted hover:text-content-secondary"
        >
          + Add note
        </button>
      </div>
    </div>
  );
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
