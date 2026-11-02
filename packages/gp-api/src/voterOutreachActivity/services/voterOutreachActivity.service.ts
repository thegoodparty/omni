import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// DEPRECATED — replaced by the ContactInteraction* models and services
// (src/contactInteraction/) per the CRM tech design:
// https://app.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-98973
// No new write paths may target this service. Segment-derived send-attribution
// writes were retired in feature 5 (ENG-10731), and the last remaining writer
// has since been deleted, so nothing in the product writes here any more. The
// legacy rows stay readable for the person activity feed until the sunset ends.
@Injectable()
export class VoterOutreachActivityService extends createPrismaBase(
  MODELS.VoterOutreachActivity,
) {}
