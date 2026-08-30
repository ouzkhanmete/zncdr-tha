import { useEffect, useRef, useState } from "react"
import { ApiError } from "../api/client.ts"

// Every section on every screen fetches, loads, and fails on its own -- see docs/ui.md: "failures
// are scoped per section, not whole-page. One broken chart never takes the rest of the page down
// with it." This hook is the one place that "own fetch, own loading, own error, own retry" is
// implemented, so a page's job is just calling it once per section and handing the result to
// `SectionState`.

export type SectionResult<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T }

/** The message a section's error state shows -- an `ApiError`'s own message is already a plain
 *  sentence a person can read (docs/api.md section 8); anything else gets a generic fallback
 *  rather than leaking a raw exception onto the screen. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return "Something went wrong."
}

/**
 * Runs `fetcher` whenever `deps` changes (the date range, the team id, ...) and reports its own
 * loading/error/ready state. Two things a naive `useEffect` gets wrong that this handles:
 *
 * - A slow first request resolving *after* a newer one has already started must not overwrite
 *   the newer result -- `requestId` drops any response that isn't from the most recent call.
 * - `retry()` re-runs the same fetch without needing a dependency to actually change.
 */
export function useSection<T>(fetcher: () => Promise<T>, deps: unknown[]): SectionResult<T> & { retry: () => void } {
  const [state, setState] = useState<SectionResult<T>>({ status: "loading" })
  const [retryTick, setRetryTick] = useState(0)
  const requestId = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const id = ++requestId.current
    setState({ status: "loading" })
    fetcherRef.current().then(
      (data) => {
        if (id === requestId.current) setState({ status: "ready", data })
      },
      (err) => {
        if (id === requestId.current) setState({ status: "error", message: errorMessage(err) })
      },
    )
    // `fetcher` itself is deliberately not a dependency -- callers build a fresh closure every
    // render, and `deps` already names exactly what should trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryTick])

  return { ...state, retry: () => setRetryTick((t) => t + 1) }
}
