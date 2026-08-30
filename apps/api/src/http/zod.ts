import type { ZodError } from "zod"

/** The first thing wrong with a request, in one sentence a person can read -- docs/api.md's "A
 *  failed parse is a 400 with a message a person can read, never a stack trace." Only the first
 *  issue is reported; a person fixing one bad field at a time is enough, and the full list is
 *  still available server-side in the thrown error if it's ever needed. */
export function firstIssueMessage(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "That request isn't shaped right."
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}
