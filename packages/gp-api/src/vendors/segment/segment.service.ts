import { Injectable } from '@nestjs/common'
import Analytics, { TrackParams } from '@segment/analytics-node'
import { pickKeys } from 'src/shared/util/objects.util'
import { SEGMENT_KEYS } from './segment.schema'
import {
  SegmentGroupTraits,
  SegmentIdentityTraits,
  SegmentTrackEventProperties,
  UserContext,
} from './segment.types'
import { PinoLogger } from 'nestjs-pino'

// HubSpot rejects any custom-behavioral-event property value over 256 chars
// (`property_value_too_long`), failing the whole event. Cap string values so a
// long property (e.g. a community-issue summary) can't drop the event.
const MAX_EVENT_PROPERTY_LENGTH = 256

@Injectable()
export class SegmentService {
  private analytics: Analytics

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SegmentService.name)
    const SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY
    if (!SEGMENT_WRITE_KEY) {
      throw new Error(
        'SEGMENT_WRITE_KEY is not defined. Please add it to your .env',
      )
    }
    this.analytics = new Analytics({ writeKey: SEGMENT_WRITE_KEY })
  }

  async trackEvent(
    userId: number,
    event: string,
    properties: SegmentTrackEventProperties = {},
    userContext?: UserContext,
    // A caller-supplied deterministic id. Segment dedups events sharing a
    // messageId, so a replayed milestone (e.g. a robocall hold) resolves to a
    // single downstream email instead of one per retry.
    messageId?: string,
  ): Promise<TrackParams> {
    try {
      const stringId = String(userId)

      const truncatedProperties = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          typeof value === 'string' && value.length > MAX_EVENT_PROPERTY_LENGTH
            ? `${value.slice(0, MAX_EVENT_PROPERTY_LENGTH - 3)}...`
            : value,
        ]),
      )

      const eventConfig: TrackParams = {
        event,
        userId: stringId,
        properties: truncatedProperties,
        ...(messageId ? { messageId } : {}),
      }

      if (userContext) {
        const traits: Record<string, string> = {}

        if (userContext.email !== undefined) {
          traits.email = userContext.email as string
        }
        if (userContext.hubspotId !== undefined) {
          traits.hubspotId = userContext.hubspotId as string
        }

        if (Object.keys(traits).length > 0) {
          eventConfig.context = { traits }
        }
      }

      await this.analytics.track(eventConfig)
      this.logger.debug(
        `[SEGMENT] Event tracked - Event: ${event}, User: ${userId}`,
      )
      return eventConfig
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.logger.error(
        error,
        `[SEGMENT] Failed to track event: ${event} for user: ${userId}`,
      )
      throw error
    }
  }

  async identify(
    userId: number,
    traits: SegmentIdentityTraits,
    userContext?: UserContext,
  ): Promise<void> {
    try {
      const segmentProps = pickKeys(traits, SEGMENT_KEYS)
      const stringId = String(userId)

      const identifyTraits = {
        ...segmentProps,
        ...(userContext ?? {}),
      } as Record<string, unknown>

      await this.analytics.identify({
        userId: stringId,
        traits: identifyTraits,
      })
      this.logger.debug(`[SEGMENT] User identified - User: ${userId}`)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.logger.error(error, `[SEGMENT] Failed to identify user: ${userId}`)
      throw error
    }
  }

  async group(
    userId: number,
    groupId: string,
    traits: SegmentGroupTraits,
  ): Promise<void> {
    try {
      await this.analytics.group({
        userId: String(userId),
        groupId,
        traits,
      })
      this.logger.debug(
        `[SEGMENT] User grouped - User: ${userId}, Group: ${groupId}`,
      )
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.logger.error(
        error,
        `[SEGMENT] Failed to group user: ${userId} into ${groupId}`,
      )
      throw error
    }
  }
}
