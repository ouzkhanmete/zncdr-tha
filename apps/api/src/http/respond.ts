/**
 * The one error envelope, used everywhere -- docs/api.md section 8. Every controller in this
 * folder replies through `jsonReply` or `errorReply` instead of building a `Response` by hand, so
 * every reply is shaped the same way without repeating the JSON header on every route.
 */

import type { ErrorCode } from "@app/shared"

const JSON_HEADERS = { "content-type": "application/json" }

/** A successful reply -- whatever `body` already is, JSON-encoded, with the right status and
 *  content type. Callers pass an object that has already been checked against a `@app/shared`
 *  response schema, not a raw domain object. */
export function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/** The one error shape docs/api.md section 8 defines, for every failure this API ever returns. */
export function errorReply(status: number, code: ErrorCode, message: string, details?: Record<string, string>): Response {
  return jsonReply(status, { error: { code, message, ...(details ? { details } : {}) } })
}

export const badRequest = (message: string, details?: Record<string, string>) => errorReply(400, "bad_request", message, details)
export const notFound = (message: string) => errorReply(404, "not_found", message)
export const internalError = () => errorReply(500, "internal_error", "Something went wrong on our end. Please try again.")

/** One unexpected error must not take the server down or leak internals -- every route is
 *  wrapped in this before it reaches `Bun.serve`, so a bug in a service comes back as a plain
 *  500 to the caller while the real error (stack trace included) still goes to the server log. */
export function withErrorHandling<Req>(handler: (req: Req) => Response | Promise<Response>): (req: Req) => Promise<Response> {
  return async (req) => {
    try {
      return await handler(req)
    } catch (err) {
      console.error("[api] unhandled error", err)
      return internalError()
    }
  }
}
