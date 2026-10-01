import { Prisma } from '../../src/generated/prisma'

export {}

declare global {
  export namespace PrismaJson {
    export type MeetingBriefingArtifact = {
      briefing_status?:
        | 'briefing_ready'
        | 'agenda_provided_by_user'
        | 'awaiting_agenda'
        | 'no_meeting_found'
        | 'error'
      meeting_date?: string
      meeting_time?: string
      meeting_timezone?: string
      meeting_name?: string
      location?: string
      run_metadata?: {
        agenda_packet_url?: string | null
        agenda_availability?: string
        packet_stated_meeting_date?: string | null
        packet_date_verification?: string
        [key: string]: Prisma.JsonValue | undefined
      }
      sources?: Array<{
        source_type?: string
        retrieved_text_or_snapshot?: string | null
        [key: string]: Prisma.JsonValue | undefined
      }>
      [key: string]: Prisma.JsonValue | undefined
    }
  }
}
