import type { ReactNode } from "react"

// Every section on every screen fails, loads, and empties on its own -- one broken chart never
// takes the rest of the page down with it. See docs/ui.md's per-screen "Loading" / "Error"
// entries, which all describe the same three shapes.

export function SectionLoading({ lines = 3 }: { lines?: number }) {
  const widths = ["w60", "w80", "w40"]
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`skeleton ${widths[i % widths.length]}`} />
      ))}
    </div>
  )
}

export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="section-error" role="alert">
      {message}
      {onRetry && (
        <>
          {" "}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </div>
  )
}

export function SectionEmpty({ children }: { children: ReactNode }) {
  return <div className="section-empty">{children}</div>
}

/**
 * Wraps one section's data-fetching state -- see `lib/useSection.ts`, which every page's fetches
 * go through to produce exactly this `state`/`errorMessage`/`onRetry` shape.
 */
export function SectionState({
  state,
  errorMessage,
  onRetry,
  children,
}: {
  state: "loading" | "error" | "ready"
  errorMessage?: string
  onRetry?: () => void
  children: ReactNode
}) {
  if (state === "loading") return <SectionLoading />
  if (state === "error") return <SectionError message={errorMessage ?? "Couldn't load this section."} onRetry={onRetry} />
  return <>{children}</>
}
