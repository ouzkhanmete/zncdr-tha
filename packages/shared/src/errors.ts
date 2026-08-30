import { z } from "zod"

/** The four error codes this API ever returns. See docs/api.md section 8. */
export const errorCode = z.enum(["bad_request", "not_found", "invalid_budget", "internal_error"])
export type ErrorCode = z.infer<typeof errorCode>

/** The one error shape every failed call returns, whatever went wrong. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: errorCode,
    message: z.string(),
    details: z.record(z.string()).optional(),
  }),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>
