import {
  forwardRef,
  Inject,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import { User } from '../../generated/prisma'
import { WrapperType } from 'src/shared/types/utility.types'
import { UsersService } from 'src/users/services/users.service'
import { PinoLogger } from 'nestjs-pino'

const SESSION_TIMEOUT = 1000 * 60 * 30 // 30 minutes (fullstory's inactivity timeout)

// Each task flushes the visits buffered in its own memory, so this is a plain
// per-task timer, not a fleet-once pg-boss schedule.
export class SessionsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly pendingLastVisited = new Map<number, number>()
  private flushTimer?: NodeJS.Timeout
  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly users: WrapperType<UsersService>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessionsService.name)
  }

  async trackSession(user: User) {
    // We try catch to prevent crashes since trackSession isn't await'd when called
    try {
      const currentTime = Date.now()

      // Buffer latest lastVisited; flush will handle sessionCount increment
      const prev = this.pendingLastVisited.get(user.id) ?? 0
      if (currentTime > prev) {
        this.pendingLastVisited.set(user.id, currentTime)
      }
    } catch (err) {
      if (err instanceof Error) {
        this.logger.warn(
          `Failed to track session for user ${user?.id}: ${err.message}`,
        )
      }
    }
  }

  onApplicationBootstrap() {
    // The route-test harness keeps timers off unless a suite opts in
    // (test-service.ts `scheduler`), so no flush writes mid-suite.
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.TEST_SCHEDULER === 'off'
    ) {
      return
    }
    this.flushTimer = setInterval(
      () => void this.flushBufferedSessions(),
      Number(process.env.SESSIONS_FLUSH_INTERVAL_MS ?? 60_000),
    )
  }

  onModuleDestroy() {
    clearInterval(this.flushTimer)
  }

  async flushBufferedSessions() {
    try {
      if (this.pendingLastVisited.size === 0) return
      const entries = Array.from(this.pendingLastVisited.entries())
      this.pendingLastVisited.clear()
      for (const [userId, pending] of entries) {
        try {
          await this.users.flushLastVisited(userId, pending, SESSION_TIMEOUT)
        } catch (err) {
          if (err instanceof Error) {
            this.logger.warn(
              `Failed to flush lastVisited for user ${userId}: ${err.message}`,
            )
          } else {
            this.logger.warn(
              `Failed to flush lastVisited for user ${userId}: Unknown error`,
            )
          }
          continue
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        this.logger.warn(`Failed to flush sessions: ${err.message}`)
      }
    }
  }
}
