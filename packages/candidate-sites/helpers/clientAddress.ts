import { NextRequest } from 'next/server'

/**
 * The visitor's address, for forwarding to gp-api.
 *
 * These sites POST through our own route handlers rather than calling gp-api
 * from the browser, so without this every visitor of every site arrives at
 * gp-api as the serverless function's egress address — and gp-api's per-IP
 * limits would meter them all as one caller.
 *
 * Vercel sets `x-forwarded-for` with the client first and each proxy appended,
 * so the first entry is the visitor. `x-real-ip` is the fallback for a proxy
 * that sets only that.
 */
export const clientAddress = (request: NextRequest): string | null => {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const first = forwardedFor?.split(',')[0]?.trim()
  if (first) return first

  return request.headers.get('x-real-ip')?.trim() || null
}

/** Spreadable so a caller with no client address sends no header at all. */
export const clientAddressHeaders = (
  request: NextRequest,
): Record<string, string> => {
  const address = clientAddress(request)
  return address ? { 'X-Forwarded-For': address } : {}
}
