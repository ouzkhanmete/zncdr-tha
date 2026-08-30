// Small display formatters shared by every screen. Dates are always read out in UTC -- see
// docs/ui.md: "days run midnight to midnight UTC," said the same way everywhere, because a day
// meaning different things on different charts is one of the easier ways to make a whole
// dashboard wrong.

/** `0.78 -> "78%"`. Rates on the wire are a plain fraction between 0 and 1 (docs/api.md). */
export function formatPercent(rate: number, decimals = 0): string {
  return `${(rate * 100).toFixed(decimals)}%`
}

/** `1652 -> "1,652"`. Plain thousands-grouped integer, for anything that isn't money. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}

/**
 * A millisecond duration as a short, human string: `2100 -> "2.1s"`, `400000 -> "6m 40s"`. Always
 * seconds zero-padded once minutes are shown, so a column of these lines up.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) throw new Error(`formatDuration got a negative duration: ${ms}`)
  if (ms < 1000) return `${Math.round(ms)}ms`

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    // One decimal place under a minute, but don't print "8.0s" -- whole seconds stay whole.
    const rounded = Math.round(totalSeconds * 10) / 10
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds - totalMinutes * 60)
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes - hours * 60
  return `${hours}h ${String(minutes).padStart(2, "0")}m`
}

/** `"2026-08-29T00:00:00Z" -> "Aug 29"`. Read in UTC, never the browser's local time zone. */
export function formatUtcDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  )
}

/** `"2026-08-29T14:02:00Z" -> "Aug 29, 2026 · 14:02 UTC"`, for the run page's fixed timestamp. */
export function formatUtcDateTime(iso: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso))
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso))
  return `${date} · ${time} UTC`
}

/** `"2026-08-29T14:02:00Z" -> "14:02"`. */
export function formatUtcTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso))
}
