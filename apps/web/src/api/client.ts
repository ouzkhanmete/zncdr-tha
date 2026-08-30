// The one place a `fetch()` happens. Every endpoint file in this folder calls `apiGet`/`apiPut`
// instead of touching `fetch` directly, so a reply is always checked against the same
// `@app/shared` schema the server was checked against on the way out -- the two sides can't
// drift apart (see docs/api.md's opening rule). Vite proxies `/api` to the running API in dev
// (see apps/web/vite.config.ts); in every other environment this app is served from, `/api` is
// expected to resolve the same way.

import { ErrorEnvelope } from "@app/shared"
import type { z, ZodTypeAny } from "zod"

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export function isNotFound(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 404
}

type QueryValue = string | number | boolean | undefined

/** Drops every `undefined` value -- a caller can pass `{ team: undefined }` for "no team filter"
 *  without it turning into the literal string `"undefined"` on the wire. */
export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return ""
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ""
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Turns a failed response into one `ApiError` a section's error state can show, using the one
 *  error envelope every endpoint returns (docs/api.md section 8) when the body actually matches
 *  it, and a plain fallback when it doesn't (a proxy error page, a dropped connection). */
async function throwForFailedResponse(res: Response): Promise<never> {
  const body = await readBody(res)
  const parsed = ErrorEnvelope.safeParse(body)
  if (parsed.success) throw new ApiError(parsed.data.error.message, res.status, parsed.data.error.code)
  throw new ApiError(`Request failed with status ${res.status}.`, res.status)
}

export async function apiGet<S extends ZodTypeAny>(
  path: string,
  schema: S,
  params?: Record<string, QueryValue>,
): Promise<z.infer<S>> {
  const res = await fetch(`/api${path}${buildQuery(params)}`)
  if (!res.ok) await throwForFailedResponse(res)
  return schema.parse(await readBody(res))
}

export async function apiPut<S extends ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) await throwForFailedResponse(res)
  return schema.parse(await readBody(res))
}
