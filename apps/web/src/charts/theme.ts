// Recharts renders colour as literal SVG attributes it computes itself -- it can't resolve a
// `var(--x)` string the way plain hand-rolled SVG markup in this codebase could. This resolves
// design tokens (docs/ui.md's colour rules; values in styles/tokens.css) to the browser's current
// computed colour, live across theme changes, so every Recharts chart keeps working in both light
// and dark mode without ever hard-coding a hex value here.

import { useEffect, useState } from "react"

const VAR_PATTERN = /^var\((--[\w-]+)\)$/

function resolveVar(value: string): string {
  const match = VAR_PATTERN.exec(value.trim())
  if (!match) return value // already a literal colour (or a one-off override) -- pass through
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim()
  return resolved || value
}

/** Re-renders whenever the theme flips -- an OS dark-mode change, or a `data-theme` attribute
 *  toggle (tokens.css supports both; see its header comment). */
function useThemeTick(): void {
  const [, bump] = useState(0)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => bump((n) => n + 1)
    media.addEventListener("change", onChange)
    const observer = new MutationObserver(onChange)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => {
      media.removeEventListener("change", onChange)
      observer.disconnect()
    }
  }, [])
}

/**
 * Resolves a map of `var(--x)` references (or literal colours) to their current computed values.
 * Call it with an object literal each render -- `useThemeTick` forces the re-render that keeps the
 * resolved values in step with the theme; the map itself is cheap to recompute every time.
 */
export function useThemeColors<T extends Record<string, string>>(vars: T): T {
  useThemeTick()
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, resolveVar(value)])) as T
}

/** Shared hover-tooltip chrome so every chart's box reads as one system: a surface background
 *  and a visible border (dark mode keeps a border rather than leaning on colour alone -- see
 *  docs/ui.md's dark-mode rule), ink text, no shadow theatrics. */
export function tooltipProps(colors: { surface: string; border: string; ink: string; inkSoft: string }) {
  return {
    contentStyle: {
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      fontSize: 12,
      padding: "6px 10px",
    },
    labelStyle: { color: colors.inkSoft, marginBottom: 2, fontSize: 11 },
    itemStyle: { color: colors.ink, padding: 0 },
  } as const
}
