import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Profiler } from 'node:inspector'
import { Session } from 'node:inspector/promises'
import {
  IntervalHistogram,
  monitorEventLoopDelay,
  PerformanceObserver,
} from 'node:perf_hooks'
import { PinoLogger } from 'nestjs-pino'
import { summarizeProfile } from './stallProfiler.summary'

const WINDOW_MS = 30_000
const SAMPLING_INTERVAL_US = 10_000
const STALL_THRESHOLD_MS = 1_500

// Samples the event loop's own CPU profile in rolling windows and logs a
// summary only for a window whose loop stalled. ECS Exec is not available to
// engineers on prod, so this is how a stall is attributed to code.
@Injectable()
export class StallProfilerService implements OnModuleInit, OnModuleDestroy {
  private session: Session | null = null
  private timer: NodeJS.Timeout | null = null
  private delay: IntervalHistogram | null = null
  private gcObserver: PerformanceObserver | null = null
  private gcTotalMs = 0
  private gcMaxMs = 0
  private gcCount = 0

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(StallProfilerService.name)
  }

  async onModuleInit() {
    if (process.env.STALL_PROFILER_ENABLED !== 'true') return
    try {
      this.session = new Session()
      this.session.connect()
      await this.session.post('Profiler.enable')
      await this.session.post('Profiler.setSamplingInterval', {
        interval: SAMPLING_INTERVAL_US,
      })
      await this.session.post('Profiler.start')
      this.delay = monitorEventLoopDelay({ resolution: 20 })
      this.delay.enable()
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.gcTotalMs += entry.duration
          this.gcMaxMs = Math.max(this.gcMaxMs, entry.duration)
          this.gcCount += 1
        }
      })
      this.gcObserver.observe({ entryTypes: ['gc'] })
      this.timer = setInterval(() => void this.rotate(), WINDOW_MS)
      this.timer.unref()
    } catch (err) {
      this.logger.warn({ err }, 'stall profiler failed to start')
      await this.onModuleDestroy()
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.delay?.disable()
    this.gcObserver?.disconnect()
    if (this.session) {
      await this.session.post('Profiler.stop').catch(() => undefined)
      this.session.disconnect()
    }
    this.session = null
  }

  private async rotate() {
    const session = this.session
    const delay = this.delay
    if (!session || !delay) return
    try {
      const { profile } = (await session.post('Profiler.stop')) as {
        profile: Profiler.Profile
      }
      const maxDelayMs = delay.max / 1e6
      const gc = {
        totalMs: Math.round(this.gcTotalMs),
        maxPauseMs: Math.round(this.gcMaxMs),
        count: this.gcCount,
      }
      delay.reset()
      this.gcTotalMs = 0
      this.gcMaxMs = 0
      this.gcCount = 0
      await session.post('Profiler.start')
      if (maxDelayMs < STALL_THRESHOLD_MS) return
      this.logger.warn(
        {
          maxDelayMs: Math.round(maxDelayMs),
          windowMs: WINDOW_MS,
          gc,
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1e6),
          ...summarizeProfile(profile, SAMPLING_INTERVAL_US / 1000),
        },
        'event loop stall profile',
      )
    } catch (err) {
      this.logger.warn({ err }, 'stall profiler window failed')
    }
  }
}
