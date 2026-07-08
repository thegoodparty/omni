import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { getEnv } from '@/shared/util/env.util'
import { WEBAPP_ROOT } from '@/shared/util/appEnvironment.util'
import { recordRevalidation } from '../observability/person-profiles.metrics'

// Fires an on-demand ISR cache-bust at the marketing site for one person's
// public profile. Best-effort by design: a publish/unpublish/delete write must
// still succeed even if the marketing site is briefly unreachable — the page's
// own revalidate window is the durable backstop, and the render gate reads the
// live gp-api state anyway. Never throws to the caller.
@Injectable()
export class MarketingRevalidationService {
  private static readonly PATH = '/api/revalidate-person'

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MarketingRevalidationService.name)
  }

  async revalidatePerson(personId: string): Promise<void> {
    const secret = getEnv('MARKETING_REVALIDATE_SECRET')
    if (!secret) {
      this.logger.warn(
        { personId },
        'MARKETING_REVALIDATE_SECRET not set; skipping person profile cache-bust',
      )
      recordRevalidation('skipped')
      return
    }

    const url = `${WEBAPP_ROOT}${MarketingRevalidationService.PATH}`
    try {
      await lastValueFrom(
        this.httpService.post(
          url,
          { personId },
          { headers: { 'x-revalidate-secret': secret } },
        ),
      )
      this.logger.debug({ personId }, 'Triggered marketing revalidation')
      recordRevalidation('success')
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined
      this.logger.error(
        {
          personId,
          status,
          message: error instanceof Error ? error.message : String(error),
        },
        'Marketing revalidation request failed (non-fatal)',
      )
      recordRevalidation('failed')
    }
  }
}
