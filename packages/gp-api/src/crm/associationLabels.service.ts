import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { HubspotService } from './hubspot.service'
import { HubSpot } from './crm.types'

// Company (0-2) -> Contact (0-1) — the direction every labeled writer
// (crmTeamMembers, crmCampaigns) already associates in.
const COMPANY_OBJECT_TYPE = '0-2'
const CONTACT_OBJECT_TYPE = '0-1'

/**
 * Resolves user-defined Contact-Company association label ids by NAME
 * (ENG-11030, ENG-11031). Label `associationTypeId`s are portal-specific
 * (Ops creates them per portal), so the name is the only contract that
 * survives sandbox vs. prod. Cached per process: the labels don't change
 * at runtime, and every labeled write would otherwise cost a lookup call.
 */
@Injectable()
export class AssociationLabelsService {
  private labelIdsByName: Promise<Map<string, number>> | null = null

  constructor(
    private readonly hubspot: HubspotService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  /**
   * Returns the label's associationTypeId, or undefined if it can't be
   * resolved — Ops hasn't created it in this portal yet, or the lookup
   * itself failed. Logs loudly either way: HubSpot silently drops writes
   * to an undefined association type, so a silent miss here would read as
   * a successful write. Callers must skip the labeled write when this
   * returns undefined rather than send a corrupted create/archive.
   */
  async resolveLabelId(
    name: HubSpot.AssociationLabelName,
  ): Promise<number | undefined> {
    let labels: Map<string, number>
    try {
      labels = await this.loadLabels()
    } catch (err) {
      // Don't let a transient lookup failure permanently disable labeling
      // for the rest of the process — clear the cache so the next call
      // retries instead of replaying this same rejection forever.
      this.labelIdsByName = null
      this.logger.error(
        { err, labelName: name },
        'Failed to fetch HubSpot association label definitions — skipping the labeled association write',
      )
      return undefined
    }

    const id = labels.get(name)
    if (id === undefined) {
      this.logger.error(
        { labelName: name },
        'HubSpot association label not found in this portal — Ops has not created it yet; skipping the labeled association write',
      )
    }
    return id
  }

  private loadLabels(): Promise<Map<string, number>> {
    this.labelIdsByName ??= this.fetchLabels()
    return this.labelIdsByName
  }

  private async fetchLabels(): Promise<Map<string, number>> {
    const { results } =
      await this.hubspot.client.crm.associations.v4.schema.definitionsApi.getAll(
        COMPANY_OBJECT_TYPE,
        CONTACT_OBJECT_TYPE,
      )
    const labeled = results.filter(
      (spec): spec is typeof spec & { label: string } => Boolean(spec.label),
    )
    return new Map(labeled.map((spec) => [spec.label, spec.typeId]))
  }
}
