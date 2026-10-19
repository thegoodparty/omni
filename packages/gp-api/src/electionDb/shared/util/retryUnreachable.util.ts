import { Prisma } from '@/generated/election-prisma'

const UNREACHABLE_CODE = 'P1001'
const RETRY_DELAY_MS = 250

// Only for idempotent reads. A P1001 means the connection was never
// established, so one retry is safe and rides out a short election-db blip.
export async function retryOnceIfUnreachable<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== UNREACHABLE_CODE
    ) {
      throw err
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    return read()
  }
}
