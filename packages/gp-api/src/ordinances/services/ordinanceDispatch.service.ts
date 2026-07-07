import { Injectable } from '@nestjs/common'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { FIND_EXISTING_ORDINANCES } from '../ordinances.constants'

// Own flag (campaignTracker precedent): ordinance sourcing rolls out
// independently of the meetings-automation fleet.
const isAutomationEnabled = () =>
  process.env.ORDINANCES_AUTOMATION_ENABLED === 'true'

// Manifest maxLength for office. customPositionName is unbounded user input;
// the place name the agent derives sits at the front of the string, so
// truncation is safe.
const OFFICE_MAX_LENGTH = 256

const STATE_CODE = /^[A-Z]{2}$/

type ResolvedDispatchContext = {
  clerkUserId: string
  state: string
  positionName: string
  isServeIcp?: boolean | null
}

@Injectable()
export class OrdinanceDispatchService extends createPrismaBase(
  MODELS.ExperimentRun,
) {
  constructor(
    private readonly experimentRuns: ExperimentRunsService,
    private readonly organizations: OrganizationsService,
  ) {
    super()
  }

  /**
   * Called when a new elected office is created. One-time semantic: any live
   * or COMPLETED prior run blocks re-dispatch — the code corpus for a place
   * does not change per signup, so a FAILED-only history is the only state
   * that warrants another attempt. Unlike the other signup hooks this gates
   * on serve-ICP, fail-closed: sourcing a municipal code only pays off for
   * orgs the serve product targets.
   */
  async onElectedOfficeCreated(electedOffice: ElectedOffice): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        { electedOfficeId: electedOffice.id },
        'ordinance_dispatch_skipped: automation disabled',
      )
      return
    }

    const { organizationSlug } = electedOffice
    const ctx = await this.resolveContext(organizationSlug)
    if (!ctx) return

    if (ctx.isServeIcp !== true) {
      this.logger.info(
        { organizationSlug, isServeIcp: ctx.isServeIcp ?? null },
        'ordinance_dispatch_skipped: org not serve-ICP',
      )
      return
    }

    const state = ctx.state.trim().toUpperCase()
    if (!STATE_CODE.test(state)) {
      this.logger.warn(
        { organizationSlug, state: ctx.state },
        'ordinance_dispatch_skipped: state is not a 2-letter code',
      )
      return
    }

    const existing = await this.model.findFirst({
      where: {
        organizationSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: {
          in: [
            ExperimentRunStatus.QUEUED,
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
            ExperimentRunStatus.COMPLETED,
          ],
        },
      },
      select: { runId: true },
    })
    if (existing) {
      this.logger.info(
        { organizationSlug, runId: existing.runId },
        'ordinance_dispatch_skipped: run already exists',
      )
      return
    }

    await this.experimentRuns.dispatchRun({
      type: FIND_EXISTING_ORDINANCES,
      organizationSlug,
      clerkUserId: ctx.clerkUserId,
      priority: 'HIGH',
      params: {
        organization_slug: organizationSlug,
        state,
        office: ctx.positionName.slice(0, OFFICE_MAX_LENGTH),
      },
    })
  }

  private async resolveContext(
    organizationSlug: string,
  ): Promise<ResolvedDispatchContext | null> {
    const [eo, organization] = await Promise.all([
      this.client.electedOffice.findFirst({
        where: { organizationSlug },
        include: { user: true },
      }),
      this.client.organization.findUnique({
        where: { slug: organizationSlug },
      }),
    ])

    if (!eo?.user?.clerkId) {
      this.logger.warn(
        { organizationSlug },
        'ordinance_dispatch_skipped: no elected office or user clerkId',
      )
      return null
    }

    const serveCtx = organization
      ? await this.organizations.resolveServeContext(organization)
      : null

    if (!serveCtx?.state || !serveCtx.positionName) {
      this.logger.warn(
        { organizationSlug },
        'ordinance_dispatch_skipped: missing serve context',
      )
      return null
    }

    return {
      clerkUserId: eo.user.clerkId,
      state: serveCtx.state,
      positionName: serveCtx.positionName,
      isServeIcp: serveCtx.isServeIcp,
    }
  }
}
