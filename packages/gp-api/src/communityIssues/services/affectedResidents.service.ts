import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  AffectedResidentsList,
  AffectedResidentsListSchema,
} from '../schemas/affectedResidents.schema'

const BUCKET = process.env.AFFECTED_RESIDENTS_BUCKET

const KEY_PREFIX = 'affected-residents'

// These lists are individual-level L2 records, so they are deliberately NOT a
// committed asset the way the first pilot did it: a list in git puts real names,
// street addresses and cell numbers into repository history permanently, and
// history is not practically reversible. They live in S3, read the same way
// this module already reads its experiment artifacts, and the repo carries only
// the schema, the route and a synthetic fixture.
//
// The cache is bounded for the same reason it exists. Unbounded, a process that
// served every issue would end up holding every office's constituents in
// memory; the cap keeps that to a working set. Entries are immutable per run,
// so eviction only costs a re-fetch.
const CACHE_MAX_ENTRIES = 50

@Injectable()
export class AffectedResidentsService extends createPrismaBase(
  MODELS.CommunityIssue,
) {
  private readonly cache = new Map<string, AffectedResidentsList>()

  constructor(private readonly s3: S3Service) {
    super()
  }

  /**
   * The ranked, contactable residents most materially affected by one issue.
   *
   * Returns null both for an issue with no list and for an issue that is not
   * this office's, so one office cannot probe another's feed by id. The issue
   * lookup is the authorization: the S3 key is built from an id that has
   * already been proven to belong to the caller, so a caller-supplied string
   * never reaches the bucket on its own.
   */
  async getForIssue(
    communityIssueId: string,
    organizationSlug: string,
  ): Promise<AffectedResidentsList | null> {
    const issue = await this.model.findFirst({
      where: { id: communityIssueId, organizationSlug },
      select: { id: true },
    })
    if (!issue) return null

    const cached = this.cache.get(communityIssueId)
    if (cached) return cached

    const list = await this.load(communityIssueId, organizationSlug)
    if (list) this.remember(communityIssueId, list)
    return list
  }

  private remember(key: string, list: AffectedResidentsList): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next()
      if (!oldest.done) this.cache.delete(oldest.value)
    }
    this.cache.set(key, list)
  }

  private async load(
    communityIssueId: string,
    organizationSlug: string,
  ): Promise<AffectedResidentsList | null> {
    if (!BUCKET) {
      this.logger.warn(
        'AFFECTED_RESIDENTS_BUCKET is unset; no affected-residents list can be served',
      )
      return null
    }

    const key = `${KEY_PREFIX}/${communityIssueId}.json`

    let raw: string | undefined
    try {
      raw = await this.s3.getFile(BUCKET, key)
    } catch (err) {
      // A bucket failure must not take down the issue detail page it hangs off.
      this.logger.error(
        { err, communityIssueId },
        'failed to read affected-residents list from S3',
      )
      return null
    }
    if (!raw) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch (err) {
      this.logger.error(
        { err, communityIssueId },
        'affected-residents list is not valid JSON',
      )
      return null
    }

    const result = AffectedResidentsListSchema.safeParse(parsed)
    if (!result.success) {
      // Refuse rather than serve what parsed. The caveats are part of the
      // payload and most of one of these lists is scored with a factor dropped
      // out, so a partial list is not a smaller list, it is a misleading one.
      this.logger.error(
        { communityIssueId, issues: result.error.issues },
        'affected-residents list failed validation',
      )
      return null
    }

    // The id keys the object, so a payload describing a different issue or a
    // different office means the wrong file is in the bucket. Serving it would
    // hand one officeholder another's constituents.
    const { issue } = result.data
    if (
      issue.communityIssueId !== communityIssueId ||
      issue.organizationSlug !== organizationSlug
    ) {
      this.logger.error(
        {
          communityIssueId,
          organizationSlug,
          payloadIssueId: issue.communityIssueId,
          payloadOrganizationSlug: issue.organizationSlug,
        },
        'affected-residents list does not match the issue it is keyed under — refusing',
      )
      return null
    }

    return result.data
  }
}
