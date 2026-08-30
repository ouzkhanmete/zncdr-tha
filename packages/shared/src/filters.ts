import { z } from "zod"

/** ISO 8601, UTC only ("Z", never a local offset) -- the rule for every timestamp on the wire. */
export const isoDateTime = z.string().datetime({
  message: "must be an ISO 8601 UTC timestamp, e.g. 2026-08-01T00:00:00Z",
})

/** A team id as it travels over the wire. See docs/api.md: "An id is a short string." */
export const teamId = z.string()

/** e.g. "code-fix". Not a closed list -- see the note at the bottom of enums.ts. */
export const agentKind = z.string()

/** True unless both dates are given and `from` comes after `to`. */
export function isValidDateOrder(from: string | undefined, to: string | undefined): boolean {
  return !from || !to || new Date(from) <= new Date(to)
}

/**
 * Fills in the defaults docs/api.md section 2 specifies: `to` defaults to now, and `from`
 * defaults to `defaultWindowDays` before whatever `to` ends up being -- so passing only `to`
 * still gives a sensible window ending there, not one that always ends "now" regardless.
 * Most calls use a 30-day window; the engineer trend call uses 90 (see api.ts).
 */
export function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
  defaultWindowDays = 30,
): { from: string; to: string } {
  const resolvedTo = to ?? new Date().toISOString()
  const windowMs = defaultWindowDays * 24 * 60 * 60 * 1000
  const resolvedFrom = from ?? new Date(new Date(resolvedTo).getTime() - windowMs).toISOString()
  return { from: resolvedFrom, to: resolvedTo }
}

/**
 * The three filters almost every metrics call takes, defined once -- see docs/api.md section 2.
 * `from`/`to` on the wire are optional; what comes out the other end always has both filled in.
 *
 * A few endpoints need a different mix of these fields (the engineer screens drop `team`; the
 * list endpoints add paging and a couple of extra filters). Those build their own object in
 * api.ts using `isValidDateOrder` and `resolveDateRange` directly, rather than extending this
 * one -- a parsed Zod object with a refinement attached can't be extended or picked from.
 */
export const rangeFilter = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    team: teamId.optional(),
    agentKind: agentKind.optional(),
  })
  .refine((input) => isValidDateOrder(input.from, input.to), {
    message: "from must not be after to",
    path: ["from"],
  })
  .transform((input) => ({
    ...resolveDateRange(input.from, input.to),
    team: input.team,
    agentKind: input.agentKind,
  }))

export type RangeFilter = z.infer<typeof rangeFilter>

/**
 * Paging for the list calls: GET /api/flags, GET /api/runs, GET /api/engineers/:id/runs.
 * Exported as plain fields too (`pageFilterFields`) so an endpoint that mixes paging into a
 * bigger query object -- as all three of those do -- can spread it in without repeating the
 * default/max values.
 */
export const pageFilterFields = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}
export const pageFilter = z.object(pageFilterFields)
export type PageFilter = z.infer<typeof pageFilter>

/** The page shape every list call returns -- see docs/api.md section 2. */
export function page<Item extends z.ZodTypeAny>(item: Item) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
}
