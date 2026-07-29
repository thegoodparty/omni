import { z } from 'zod'
import { SupportStatusRollupSchema } from '@goodparty_org/contracts'
import { activityConditionSchema } from './activityCondition.schema'

/**
 * Base schema containing all voter filter fields used across different contexts
 * (VoterFileFilter creation, P2P phone lists, etc.)
 */
export const voterFilterBaseSchema = z.object({
  audienceSuperVoters: z.boolean().optional(),
  audienceLikelyVoters: z.boolean().optional(),
  audienceUnreliableVoters: z.boolean().optional(),
  audienceUnlikelyVoters: z.boolean().optional(),
  audienceFirstTimeVoters: z.boolean().optional(),
  audienceUnknown: z.boolean().optional(),
  partyIndependent: z.boolean().optional(),
  partyDemocrat: z.boolean().optional(),
  partyRepublican: z.boolean().optional(),
  partyUnknown: z.boolean().optional(),
  // Retired overlapping age split (ENG-10752). Still accepted so saved
  // filters keep their original query bounds; new selections use the
  // mutually exclusive keys below.
  age18_25: z.boolean().optional(),
  age25_35: z.boolean().optional(),
  age35_50: z.boolean().optional(),
  age50Plus: z.boolean().optional(),
  age18_24: z.boolean().optional(),
  age25_34: z.boolean().optional(),
  age35_49: z.boolean().optional(),
  age50_64: z.boolean().optional(),
  age65Plus: z.boolean().optional(),
  ageUnknown: z.boolean().optional(),
  genderMale: z.boolean().optional(),
  genderFemale: z.boolean().optional(),
  genderUnknown: z.boolean().optional(),
  hasCellPhone: z.boolean().optional(),
  hasLandline: z.boolean().optional(),
  // New boolean flags to allow FE to pass simple true/false values
  registeredVoterTrue: z.boolean().optional(),
  registeredVoterFalse: z.boolean().optional(),
  likelyMarried: z.boolean().optional(),
  likelySingle: z.boolean().optional(),
  married: z.boolean().optional(),
  single: z.boolean().optional(),
  maritalUnknown: z.boolean().optional(),
  hasChildrenYes: z.boolean().optional(),
  hasChildrenNo: z.boolean().optional(),
  hasChildrenUnknown: z.boolean().optional(),
  veteranYes: z.boolean().optional(),
  veteranUnknown: z.boolean().optional(),
  homeownerYes: z.boolean().optional(),
  homeownerLikely: z.boolean().optional(),
  homeownerNo: z.boolean().optional(),
  homeownerUnknown: z.boolean().optional(),
  contactsMade0: z.boolean().optional(),
  contactsMade1: z.boolean().optional(),
  contactsMade2: z.boolean().optional(),
  contactsMade3: z.boolean().optional(),
  contactsMade4: z.boolean().optional(),
  contactsMade5Plus: z.boolean().optional(),
  businessOwnerYes: z.boolean().optional(),
  businessOwnerUnknown: z.boolean().optional(),
  educationNone: z.boolean().optional(),
  educationHighSchoolDiploma: z.boolean().optional(),
  educationTechnicalSchool: z.boolean().optional(),
  educationSomeCollege: z.boolean().optional(),
  educationCollegeDegree: z.boolean().optional(),
  educationGraduateDegree: z.boolean().optional(),
  educationUnknown: z.boolean().optional(),
  ethnicityAsian: z.boolean().optional(),
  ethnicityEuropean: z.boolean().optional(),
  ethnicityHispanic: z.boolean().optional(),
  ethnicityAfricanAmerican: z.boolean().optional(),
  ethnicityOther: z.boolean().optional(),
  ethnicityUnknown: z.boolean().optional(),
  languageCodes: z.array(z.string()).optional(),
  voterStatus: z.array(z.string()).optional(),
  incomeRanges: z.array(z.string()).optional(),
  incomeUnknown: z.boolean().optional(),
  // Free-text search term captured when a list is saved directly from a
  // contacts search result set, re-applied on read so selecting the saved
  // list reproduces the searched-down view (ENG-10518). Nullish because a
  // persisted filter row stores null when no search was saved, and the FE
  // round-trips the whole row back into this schema (e.g. POST /p2p/phone-list).
  search: z.string().nullish(),
  supportStatus: z.array(SupportStatusRollupSchema).optional(),
  activityConditions: z.array(activityConditionSchema).optional(),
})
