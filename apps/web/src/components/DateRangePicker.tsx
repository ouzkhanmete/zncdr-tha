import { useEffect, useState } from "react"

// The date range control shared by org, team, and engineer -- see docs/ui.md. Three presets
// cover the common case in one click; the two native date boxes cover everything else. A plain
// <input type="date"> on purpose: the browser already has a calendar, a keyboard path, and a
// screen reader path that a hand-built widget would only reinvent worse.

export type Preset = "7d" | "30d" | "90d"
export type DateRange = { from: string; to: string }

const PRESET_DAYS: Record<Preset, number> = { "7d": 7, "30d": 30, "90d": 90 }

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return isoDateOnly(d)
}

export function DateRangePicker({
  defaultPreset,
  onRangeChange,
  now = () => new Date(),
}: {
  defaultPreset: Preset
  /** Called on mount and every time the selected range changes, with a full ISO 8601 UTC
   *  timestamp on each end -- exactly what every `RangeFilter`-shaped endpoint in docs/api.md
   *  takes as `from`/`to`. */
  onRangeChange: (range: DateRange) => void
  /** Overridable so a test doesn't depend on the real clock; defaults to the actual current time. */
  now?: () => Date
}) {
  const [today] = useState(() => isoDateOnly(now()))
  // `preset` is `null` once a date box has been hand-edited -- a custom range matches no button,
  // so none should read as active.
  const [preset, setPreset] = useState<Preset | null>(defaultPreset)
  const [from, setFrom] = useState(() => subtractDays(today, PRESET_DAYS[defaultPreset]))
  const [to, setTo] = useState(today)

  useEffect(() => {
    if (preset) {
      // A preset means "the last N days ending now" -- the real current moment, not midnight of
      // today, so the freshest data (this hour's runs) is included rather than held back until
      // tomorrow's picker.
      const nowDate = now()
      onRangeChange({ from: new Date(nowDate.getTime() - PRESET_DAYS[preset] * 86_400_000).toISOString(), to: nowDate.toISOString() })
    } else {
      // A hand-picked range is two calendar days -- run the whole of both, midnight to midnight
      // UTC, per docs/ui.md's own rule under this control.
      onRangeChange({ from: `${from}T00:00:00Z`, to: `${to}T23:59:59.999Z` })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to])

  function choosePreset(next: Preset) {
    setPreset(next)
    setTo(today)
    setFrom(subtractDays(today, PRESET_DAYS[next]))
  }

  return (
    <div className="daterange">
      {(Object.keys(PRESET_DAYS) as Preset[]).map((p) => (
        <button
          key={p}
          type="button"
          className={`preset${p === preset ? " active" : ""}`}
          aria-pressed={p === preset}
          onClick={() => choosePreset(p)}
        >
          {p}
        </button>
      ))}
      <span className="dr-sep" />
      <input
        type="date"
        aria-label="From"
        value={from}
        max={to}
        onChange={(e) => {
          setFrom(e.target.value)
          setPreset(null)
        }}
      />
      <span className="dr-arrow">→</span>
      <input
        type="date"
        aria-label="To"
        value={to}
        min={from}
        onChange={(e) => {
          setTo(e.target.value)
          setPreset(null)
        }}
      />
      <span className="dr-note">Days run midnight to midnight UTC</span>
    </div>
  )
}
