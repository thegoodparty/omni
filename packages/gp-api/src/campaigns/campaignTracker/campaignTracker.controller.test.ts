import { describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { CampaignTrackerController } from './campaignTracker.controller'

// The generate route is a non-prod-only override gated on IS_NON_PROD_DEPLOY,
// which is false in the test env (OTEL_SERVICE_ENVIRONMENT is unset — i.e.
// prod-like). Direct instantiation exercises the real const, so this proves the
// gate denies in a prod-like deploy, keeping generation cron-only there. The
// non-prod dispatch path is covered by CampaignTrackerTasksService.generateNow.
describe('CampaignTrackerController.generateTasks (env gate)', () => {
  it('404s and does not dispatch when not a non-prod deploy', async () => {
    const service = { generateNow: vi.fn() }
    const controller = new CampaignTrackerController(service as never)
    await expect(
      controller.generateTasks({ id: 42 } as never),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(service.generateNow).not.toHaveBeenCalled()
  })
})
