import { NextRequest } from 'next/server'

/**
 * The visitor's address, for forwarding to gp-api.
 *
 * These sites POST through our own route handlers rather than calling gp-api
 * from the browser, so without this every visitor of every site arrives at
 * gp-api as the serverless function's egress address — and gp-api's per-IP
 * limits would meter them all as one caller.
 *
 * `x-real-ip` comes first because Vercel's edge sets it itself, while it
 * appends to whatever `x-forwarded-for` the connecting client sent — so the
 * leftmost `x-forwarded-for` entry is the client's own claim about who they
 * are, and reading it first would let a caller rotate that value to get a
 * fresh bucket per request. `x-forwarded-for` stays as the fallback for a
 * proxy that sets only that, taking its first entry (the client, with each
 * proxy appended after).
 */
export const clientAddress = (request: NextRequest): string | null => {
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwardedFor = request.headers.get('x-forwarded-for')
  return forwardedFor?.split(',')[0]?.trim() || null
}

/** Spreadable so a caller with no client address sends no header at all. */
export const clientAddressHeaders = (
  request: NextRequest,
): Record<string, string> => {
  const address = clientAddress(request)
  return address ? { 'X-Forwarded-For': address } : {}
}
