import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseListError } from './judgeChatFixture/accountState'
import { User } from '@/generated/prisma'
import { TestFixturesJudgeController } from './testFixturesJudge.controller'
import { JudgeChatFixtureService } from './services/judgeChatFixture.service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

// IS_NON_PROD_DEPLOY is a module-level constant read inside every handler.
// Default true because the unit-test env has no OTEL_SERVICE_ENVIRONMENT (so
// the real value is false) yet the happy-path cases need a non-prod deploy.
useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

const JUDGE_USER = { id: 42 } as User
const SWEEP_ID = 'judge-19284756312-1'

describe('TestFixturesJudgeController', () => {
  let controller: TestFixturesJudgeController
  let service: {
    setUp: ReturnType<typeof vi.fn>
    tearDown: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = true
    service = {
      setUp: vi.fn().mockResolvedValue({ organizationSlug: 'judge-abc' }),
      tearDown: vi.fn().mockResolvedValue(true),
    }
    controller = new TestFixturesJudgeController(
      service as unknown as JudgeChatFixtureService,
    )
  })

  it('stages a case for the authenticated caller on a non-prod deploy', async () => {
    const body = {
      agentId: 'chief_of_staff',
      sweepId: SWEEP_ID,
      slugKey: 'case-1',
    }

    await expect(controller.setUpCase(body, JUDGE_USER)).resolves.toEqual({
      organizationSlug: 'judge-abc',
    })
    // The caller's own id, never one the request named.
    expect(service.setUp).toHaveBeenCalledWith(JUDGE_USER.id, body)
  })

  it('reports whether teardown found anything to remove', async () => {
    service.tearDown.mockResolvedValue(false)

    await expect(
      controller.tearDownCase('judge-gone', JUDGE_USER),
    ).resolves.toEqual({ organizationSlug: 'judge-gone', removed: false })
  })

  // A state the scope has no row for is the caller's mistake, and the seeder
  // is the only thing that knows it — so it must not reach the client as a
  // 500 that reads like ours.
  it('turns an unseedable account state into a bad request', async () => {
    service.setUp.mockRejectedValue(new CaseListError('no row carries pro'))

    await expect(
      controller.setUpCase(
        { agentId: 'chief_of_staff', sweepId: SWEEP_ID, slugKey: 'case-1' },
        JUDGE_USER,
      ),
    ).rejects.toThrow(BadRequestException)
  })

  // false models prod or a misconfigured/absent OTEL_SERVICE_ENVIRONMENT,
  // where the fail-closed gate must 404 rather than silently ungate. The
  // refusal lands before the service is reached, which is the half that
  // matters: no row is written or removed on the way to the 404.
  it('404s both endpoints outside a known non-prod deploy', async () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = false

    await expect(
      controller.setUpCase(
        { agentId: 'chief_of_staff', sweepId: SWEEP_ID, slugKey: 'case-1' },
        JUDGE_USER,
      ),
    ).rejects.toThrow(NotFoundException)
    await expect(
      controller.tearDownCase('judge-abc', JUDGE_USER),
    ).rejects.toThrow(NotFoundException)
    expect(service.setUp).not.toHaveBeenCalled()
    expect(service.tearDown).not.toHaveBeenCalled()
  })
})
