import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  SOCIAL_DRAFT_MESSAGE_MAX_LENGTH,
  SOCIAL_POST_COPY_MAX_LENGTH,
  SOCIAL_VIDEO_SCRIPT_MAX_LENGTH,
  ServeSocialPurpose,
  SocialAsset,
  SocialAssetPlatformSchema,
  SocialPurpose,
  SocialTone,
  socialAssetKindForPlatform,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { SocialAssetKind, SocialAssetPlatform } from '../../generated/prisma'
import { SOCIAL_PLATFORM_KIND } from '../util/socialAssets.util'
import { TONE_STYLES } from '../util/messageTone.util'

// The per-surface voice a compose request writes in. Win and Serve share
// every other piece of the generation pipeline (platform rules, output
// schemas, the LLM call plumbing) — only the purpose vocabulary and these
// three system prompts vary. nameLabel/subjectFallback also vary: the
// candidate/office context line must never say "candidate" for a Serve
// request (the AC bans candidate/voter framing entirely).
export interface SocialVoiceConfig<TPurpose extends string> {
  purposePrompts: Record<TPurpose, string>
  nameLabel: string
  subjectFallback: string
  officeLabel: string
  draftSystemPrompt: string
  improveSystemPrompt: string
  generateSystemPrompt: string
}

interface DraftInput<TPurpose extends string> {
  purpose: TPurpose
  tone: SocialTone
  currentDraft?: string
}

interface GenerateInput<TPurpose extends string> {
  draftMessage: string
  purpose: TPurpose
  platforms: SocialAssetPlatform[]
}

// A spoken-word script is unchanged by the CSV guidance — only the
// caption/description field's length and hashtag advice below is new.
const VIDEO_SCRIPT_RULE =
  'A spoken-word video script of roughly 30-45 seconds, written to be ' +
  'read to camera in the first person. '

// Nextdoor's per-purpose include/exclude/flag matrix is ENG-10989; this
// ticket carries only the tone guidance, unchanged by purpose.
const NEXTDOOR_RULE =
  'Conversational, neighbor-to-neighbor tone. Open by addressing ' +
  'neighbors directly (for example "Hi neighbors,"). Hyper-local, never ' +
  'salesy. No hashtags.'

// Canonical platform guidance (product/politics CSV
// social-copy-prompts-and-platform-guidance, 2026-09-01) for every
// AI-generated, non-custom purpose.
const PLATFORM_RULES: Record<SocialAssetPlatform, string> = {
  [SocialAssetPlatform.facebook]:
    'Aim for a short caption, roughly 80 characters performs best in ' +
    'feed; up to 2,200 if posted as a Reel. 2-3 lowercase hashtags kept ' +
    'in the caption.',
  [SocialAssetPlatform.instagram]:
    "Front-load the hook in the first 125-150 characters, since that's " +
    "what shows before 'more.' 3-5 relevant hashtags.",
  [SocialAssetPlatform.nextdoor]: NEXTDOOR_RULE,
  [SocialAssetPlatform.x]:
    'A single post within the 280-character hard limit, leaving room ' +
    'for a URL the candidate appends; aim for 70-150 characters for ' +
    'best engagement. 1-2 hashtags max, more measurably hurts ' +
    'engagement.',
  [SocialAssetPlatform.tiktok]:
    VIDEO_SCRIPT_RULE +
    'Caption accompanies the intro video itself. Front-load the hook, ' +
    'since only ~100-150 characters show before truncation; ideal ' +
    'total length 150-300 characters. 3-5 hashtags.',
  [SocialAssetPlatform.youtube_shorts]:
    VIDEO_SCRIPT_RULE +
    'Description allows up to 5,000 characters but only ~100 show ' +
    'above the fold, front-load it. 3-5 hashtags placed at the end.',
}

// The custom purpose's GENERATE path adapts the candidate/official's own
// written message rather than a fresh draft — trim/reformat, don't
// rewrite. Same CSV, its "custom purpose" table.
const CUSTOM_PLATFORM_RULES: Record<SocialAssetPlatform, string> = {
  [SocialAssetPlatform.facebook]:
    'Trim/reformat to ~80 characters for feed, or up to 2,200 if ' +
    'posted as a Reel. Adjust hashtag count to 2-3 if present.',
  [SocialAssetPlatform.instagram]:
    'Trim/reformat so the hook lands in the first 125-150 characters. ' +
    'Adjust hashtag count to 3-5 if present.',
  [SocialAssetPlatform.nextdoor]: NEXTDOOR_RULE,
  [SocialAssetPlatform.x]:
    'Trim/reformat to fit 280 characters, ideally 70-150, leaving room ' +
    'for a URL the candidate appends. Adjust hashtag count to 1-2 if ' +
    'present.',
  [SocialAssetPlatform.tiktok]:
    VIDEO_SCRIPT_RULE +
    'Trim/reformat so the hook lands in the first 100-150 characters; ' +
    'total 150-300 characters. Adjust hashtag count to 3-5 if present.',
  [SocialAssetPlatform.youtube_shorts]:
    VIDEO_SCRIPT_RULE +
    'Trim/reformat so the first ~100 characters carry the hook, ' +
    'within the 5,000-character limit. Adjust hashtag count to 3-5 if ' +
    'present.',
}

const WIN_DRAFT_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate draft one short campaign message.',
  'Rules:',
  '- Write in the first person, as the candidate.',
  '- Keep the draft roughly 60-120 words of plain prose (no hashtags,',
  '  no links, no headings).',
  "- Ground positions, issues, and specifics in the candidate's own",
  '  campaign materials when they are provided; never invent policy',
  '  positions, issue stances, endorsements, statistics, dates, places,',
  '  or events the materials do not contain. With no materials, stay',
  '  issue-neutral. The candidate edits this draft before it is used.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
].join('\n')

const WIN_IMPROVE_SYSTEM_PROMPT = [
  'You are a campaign writing assistant helping an independent,',
  'non-partisan local candidate polish one short campaign message they',
  'wrote themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  dates, deadlines, places, events, times, names, numbers, asks.',
  '  Dropping one is a failure. Do not paraphrase specifics away.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  '- Keep roughly the same length as the original. Do not add new',
  '  sentences, greetings, or sign-offs the original does not have.',
  '- Return plain prose (no hashtags, no links, no headings).',
  '- Never add policy positions, issue stances, endorsements,',
  '  statistics, dates, places, or events the original text does not',
  '  contain — campaign materials, when provided, are context for tone',
  '  and accuracy, not a source of new content in a polish.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

const WIN_GENERATE_SYSTEM_PROMPT = [
  'You are a social media expert helping an independent, non-partisan',
  'local candidate adapt one confirmed campaign message into',
  'platform-native posts.',
  'Rules:',
  '- Write in the first person, as the candidate.',
  "- Build on the provided draft message; the candidate's campaign",
  '  materials, when provided, may ground supporting detail. Never',
  '  invent facts, endorsements, statistics, dates, or places that',
  '  neither the draft nor the materials contain.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Return exactly one asset per requested platform, following each',
  "  platform's rules.",
  '- For video platforms, put the spoken script in "text" and the post',
  '  caption in "caption". For copy platforms, omit "caption".',
].join('\n')

// Product/politics prompt copy (CSV social-copy-prompts-and-platform-
// guidance, 2026-09-01), transcribed VERBATIM — do not editorialize, fix
// grammar, or reflow. Supersedes the launch-era one-line purposeGoals.
//
// Source-material mapping (prompt term -> context block; "not modeled"
// means no context builder emits it today, so the invention ban is what
// keeps the model from fabricating it):
//   candidate's name / office sought -> nameLabel/officeLabel lines
//   location                         -> OutreachComposeContextService's
//                                        "Where the candidate is running"
//   bio / why-they're-running        -> CampaignStory.background ("The
//                                        candidate's campaign story, in
//                                        their own words") — Win has one
//                                        combined story field, not two
//   top platform priorities          -> customIssues ("The candidate's
//                                        stated issue positions")
//   accomplishments                  -> not modeled
//   event / issue update details     -> not modeled (per-message specifics)
const WIN_PURPOSE_PROMPTS: Record<SocialPurpose, string> = {
  introduce_myself: [
    'Write a first-person social media post in which the candidate',
    "introduces themselves to voters. Use the candidate's name, office",
    "sought, location, bio, why-they're-running statement, and top",
    'platform priorities as source material. Do not invent biographical',
    'details, accomplishments, or positions not present in these inputs.',
    'Do not reference party affiliation, criticize opponents, or use',
    'inflammatory language. Structure: an opening hook line, 2-3',
    "sentences drawing from bio and why-they're-running, one sentence",
    'naming a top priority, then a closing call to action to vote for',
    'them. Keep framing consistent with how this candidate has',
    'introduced themselves before. Match the tone selected for this',
    'message.',
  ].join(' '),
  persuade_voters: [
    'Write a first-person social media post aimed at persuading likely',
    "voters to support the candidate. Use the candidate's name, office",
    "sought, bio, why-they're-running statement, accomplishments, and",
    'top platform priorities as source material. Do not invent facts',
    'not present in these inputs. Do not reference party affiliation,',
    'attack or name opponents, or use inflammatory language. Structure:',
    'an opening line naming the stakes or a shared concern, 2-3',
    "sentences connecting the candidate's platform to that concern,",
    'then a closing call to action to vote for them. Match the tone',
    'selected for this message.',
  ].join(' '),
  event_invite: [
    'Write a first-person social media post inviting people to a local',
    "event. Use the candidate's name, office sought, and the event",
    'details provided (name, date, time, location) as source material.',
    'Do not invent event details not provided. Avoid inflammatory',
    'language. Structure: an opening hook naming the event, 1-2',
    'sentences on why it matters or what to expect, then a closing',
    'call to action to attend, including date/time/location. Match',
    'the tone selected for this message.',
  ].join(' '),
  early_voting: [
    'Write a first-person social media post encouraging voters to vote',
    "early. Use the candidate's name and office sought as source",
    'material. Keep the message strictly nonpartisan and focused on',
    'participation, not persuasion, do not reference how to vote on',
    'any issue or candidate, and avoid inflammatory language.',
    'Structure: an opening line encouraging early voting, 1-2',
    'sentences on why participating matters, practical information on',
    'how/where to vote early if provided, then a closing encouragement',
    'to vote. Match the tone selected for this message.',
  ].join(' '),
  election_day_turnout: [
    'Write a first-person social media post encouraging voters to turn',
    "out on election day. Use the candidate's name and office sought",
    'as source material. Keep the message strictly nonpartisan and',
    'focused on participation, not persuasion, do not reference how to',
    'vote on any issue or candidate, and avoid inflammatory language.',
    'Structure: an opening line marking election day, 1-2 sentences on',
    'the importance of voting, practical voting information if',
    'provided, then a closing encouragement to vote. Match the tone',
    'selected for this message.',
  ].join(' '),
  issue_update: [
    'Write a first-person social media post sharing an update about a',
    "local issue the candidate is working on. Use the candidate's",
    'name, office sought, and the issue update details provided as',
    'source material. Do not invent facts, outcomes, or details not',
    'provided. Avoid inflammatory language. Structure: name the issue,',
    'explain the update in 2-3 sentences, then a closing line inviting',
    'continued engagement or follow-up. Match the tone selected for',
    'this message.',
  ].join(' '),
  custom: [
    "Take the candidate's own message, provided as written, and adapt",
    "it to fit the selected platform's format and length. Preserve the",
    'substance and wording of the original message as closely as',
    'possible. Do not add new claims, priorities, or calls to action',
    'not present in the original. Only adjust structure, length, and',
    'formatting (e.g. hashtags, line breaks) to match platform',
    'conventions. Flag rather than silently alter or remove language',
    "that may not comply with a platform's content policy (e.g. a",
    'direct vote-for-me ask on Nextdoor).',
  ].join(' '),
}

export const WIN_SOCIAL_VOICE: SocialVoiceConfig<SocialPurpose> = {
  purposePrompts: WIN_PURPOSE_PROMPTS,
  nameLabel: 'Candidate name',
  subjectFallback: 'The candidate',
  officeLabel: 'Office sought',
  draftSystemPrompt: WIN_DRAFT_SYSTEM_PROMPT,
  improveSystemPrompt: WIN_IMPROVE_SYSTEM_PROMPT,
  generateSystemPrompt: WIN_GENERATE_SYSTEM_PROMPT,
}

const SERVE_DRAFT_SYSTEM_PROMPT = [
  'You are a writing assistant helping a local elected official write to',
  'the constituents they serve. Draft one short constituent update.',
  'Rules:',
  '- Write in the first person, as the elected official.',
  '- Keep the draft roughly 60-120 words of plain prose (no hashtags,',
  '  no links, no headings).',
  "- Ground details and specifics in the elected official's own",
  '  materials when they are provided; never invent facts, decisions,',
  '  statistics, dates, places, or events the materials do not',
  '  contain. With no materials, stay general. The elected official',
  '  edits this draft before it is used.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone.',
].join('\n')

const SERVE_IMPROVE_SYSTEM_PROMPT = [
  'You are a writing assistant helping a local elected official polish',
  'one short constituent update they wrote themselves.',
  'This is a light edit, NOT a rewrite. Rules:',
  '- Every concrete detail in the original MUST appear in your output:',
  '  dates, deadlines, places, events, times, names, numbers, asks.',
  '  Dropping one is a failure. Do not paraphrase specifics away.',
  '- Fix grammar, punctuation, capitalization, and awkward phrasing;',
  "  keep the author's meaning, structure, and voice.",
  '- Keep roughly the same length as the original. Do not add new',
  '  sentences, greetings, or sign-offs the original does not have.',
  '- Return plain prose (no hashtags, no links, no headings).',
  '- Never add facts, decisions, endorsements, statistics, dates,',
  '  places, or events the original text does not contain — the',
  "  official's own materials, when provided, are context for tone",
  '  and accuracy, not a source of new content in a polish.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Match the requested tone through word choice, not new content.',
].join('\n')

const SERVE_GENERATE_SYSTEM_PROMPT = [
  'You are a social media expert helping a local elected official adapt',
  'one confirmed constituent update into platform-native posts.',
  'Rules:',
  '- Write in the first person, as the elected official.',
  "- Build on the provided draft message; the official's own materials,",
  '  when provided, may ground supporting detail. Never invent facts,',
  '  endorsements, statistics, dates, or places that neither the draft',
  '  nor the materials contain.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Return exactly one asset per requested platform, following each',
  "  platform's rules.",
  '- For video platforms, put the spoken script in "text" and the post',
  '  caption in "caption". For copy platforms, omit "caption".',
].join('\n')

// Same CSV as WIN_PURPOSE_PROMPTS above; transcribed VERBATIM.
//
// Source-material mapping (prompt term -> context block; "not modeled"
// as above):
//   their name / office held  -> nameLabel/officeLabel lines
//   location served           -> the serve controller's
//                                 "Where the elected official serves" line
//   bio                       -> PersonProfile.bioOverride ("The
//                                 official's bio, in their own words")
//   why-they-serve statement  -> PersonProfile.whyRunning ("Why they
//                                 serve, in their own words")
//   top priorities            -> published PersonProfileIssues ("The
//                                 official's published priorities")
//   decision / event / resource / issue update details -> not modeled
const SERVE_PURPOSE_PROMPTS: Record<ServeSocialPurpose, string> = {
  introduce_myself: [
    'Write a first-person social media post in which the elected',
    'official introduces themselves to the constituents they serve.',
    'Use their name, office held, location served, bio, why-they-serve',
    'statement, and top priorities as source material. Do not invent',
    'biographical details, accomplishments, or positions not present',
    'in these inputs. Do not reference party affiliation or use',
    'inflammatory language. Structure: an opening hook line, 2-3',
    'sentences drawing from bio and why-they-serve, one sentence',
    'naming a top priority, then a closing line inviting constituents',
    'to follow along or reach out. Keep framing consistent with how',
    'this official has introduced themselves before. Match the tone',
    'selected for this message.',
  ].join(' '),
  explain_decision: [
    'Write a first-person social media post in which the elected',
    'official explains a recent decision or vote and the reasoning',
    "behind it. Use the official's name, office held, and the decision",
    'details and reasoning provided as source material. Do not invent',
    'facts, outcomes, or justifications not present in these inputs.',
    'Do not attack colleagues or other officials, or use inflammatory',
    'language. Structure: state the decision plainly first, explain',
    'the reasoning in 2-3 sentences, then close with an invitation for',
    'questions or feedback. Match the tone selected for this message.',
  ].join(' '),
  event_invite: [
    'Write a first-person social media post inviting constituents to a',
    "town hall or local event. Use the official's name, office held,",
    'and the event details provided (name, date, time, location) as',
    'source material. Do not invent event details not provided. Avoid',
    'inflammatory language. Structure: an opening hook naming the',
    'event, 1-2 sentences on why it matters or what to expect, then a',
    'closing call to action to attend, including date/time/location.',
    'Match the tone selected for this message.',
  ].join(' '),
  community_input: [
    'Write a first-person social media post inviting constituents to',
    'share input on a local issue or upcoming decision. Use the',
    "official's name, office held, and the issue or decision details",
    'provided as source material. Do not invent details not provided.',
    'Avoid inflammatory language. Structure: name the issue or',
    'decision, explain briefly why input matters, then a clear closing',
    'call to action on how to share feedback (e.g. link, meeting,',
    'email). Match the tone selected for this message.',
  ].join(' '),
  share_resource: [
    'Write a first-person social media post announcing a local',
    'program, service, or resource available to constituents. Use the',
    "official's name, office held, and the resource details provided",
    'as source material. Do not invent details not provided. Avoid',
    'inflammatory language. Structure: name the resource, explain',
    'briefly who it helps and how, then a closing call to action on',
    'how to access it. Match the tone selected for this message.',
  ].join(' '),
  issue_update: [
    'Write a first-person social media post sharing a progress update',
    "on a local issue the official is working on. Use the official's",
    'name, office held, and the issue update details provided as',
    'source material. Do not invent facts, outcomes, or details not',
    'provided. Avoid inflammatory language. Structure: name the issue,',
    'explain the update in 2-3 sentences, then a closing line inviting',
    'continued engagement or follow-up. Match the tone selected for',
    'this message.',
  ].join(' '),
  custom: [
    "Take the official's own message, provided as written, and adapt",
    "it to fit the selected platform's format and length. Preserve the",
    'substance and wording of the original message as closely as',
    'possible. Do not add new claims, priorities, or calls to action',
    'not present in the original. Only adjust structure, length, and',
    'formatting (e.g. hashtags, line breaks) to match platform',
    'conventions. Flag rather than silently alter or remove language',
    "that may not comply with a platform's content policy.",
  ].join(' '),
}

export const SERVE_SOCIAL_VOICE: SocialVoiceConfig<ServeSocialPurpose> = {
  purposePrompts: SERVE_PURPOSE_PROMPTS,
  nameLabel: 'Elected official name',
  subjectFallback: 'The elected official',
  officeLabel: 'Office held',
  draftSystemPrompt: SERVE_DRAFT_SYSTEM_PROMPT,
  improveSystemPrompt: SERVE_IMPROVE_SYSTEM_PROMPT,
  generateSystemPrompt: SERVE_GENERATE_SYSTEM_PROMPT,
}

const DraftSchema = z.object({
  draft: z.string().min(1).max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH),
})

// Length caps live HERE, at the LLM boundary: an over-cap generation must
// fail jsonCompletion (caught below as a retryable 502), not pass through
// and get rejected by the response interceptor as an unretryable 500.
const GeneratedAssetsSchema = z.object({
  assets: z.array(
    z
      .object({
        platform: SocialAssetPlatformSchema,
        text: z.string().min(1),
        caption: z.string().min(1).max(SOCIAL_POST_COPY_MAX_LENGTH).optional(),
      })
      .refine(
        (asset) =>
          asset.text.length <=
          (socialAssetKindForPlatform(asset.platform) === 'video_script'
            ? SOCIAL_VIDEO_SCRIPT_MAX_LENGTH
            : SOCIAL_POST_COPY_MAX_LENGTH),
        { message: 'Generated text exceeds the platform cap' },
      ),
  ),
})

type GeneratedAssets = z.infer<typeof GeneratedAssetsSchema>

@Injectable()
export class OutreachSocialGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachSocialGenerationService.name)
  }

  async generateDraft<TPurpose extends string>(
    input: DraftInput<TPurpose>,
    candidateName: string,
    office: string,
    userId: string,
    campaignContext: string[],
    voice: SocialVoiceConfig<TPurpose>,
  ): Promise<string> {
    // Fresh generation only: improve mode polishes the author's own words,
    // so it applies to custom-purpose messages too.
    if (input.purpose === 'custom' && !input.currentDraft) {
      throw new BadRequestException(
        'Custom-purpose messages are written by the user',
      )
    }
    const context = [
      `${voice.nameLabel}: ${candidateName || voice.subjectFallback}.`,
      `${voice.officeLabel}: ${office || 'local office'}.`,
      voice.purposePrompts[input.purpose],
      `Tone: ${TONE_STYLES[input.tone]}`,
      ...campaignContext,
    ]
    const messages: LlmMessage[] = input.currentDraft
      ? [
          { role: 'system', content: voice.improveSystemPrompt },
          {
            role: 'user',
            content: [
              ...context,
              "The author's message to polish:",
              '"""',
              input.currentDraft,
              '"""',
              'Polish the message.',
            ].join('\n'),
          },
        ]
      : [
          { role: 'system', content: voice.draftSystemPrompt },
          {
            role: 'user',
            content: [...context, 'Write the draft message.'].join('\n'),
          },
        ]

    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: DraftSchema,
        // High enough that Regenerate re-rolls produce a different draft.
        temperature: 0.8,
        maxTokens: 1024,
        userId,
      })
      return object.draft
    } catch (err) {
      this.logger.error({ err }, 'Social draft generation failed')
      throw new BadGatewayException('Social draft generation failed')
    }
  }

  async generateAssets<TPurpose extends string>(
    input: GenerateInput<TPurpose>,
    candidateName: string,
    userId: string,
    campaignContext: string[],
    voice: SocialVoiceConfig<TPurpose>,
  ): Promise<SocialAsset[]> {
    const platforms = [...new Set(input.platforms)]
    const messages: LlmMessage[] = [
      { role: 'system', content: voice.generateSystemPrompt },
      {
        role: 'user',
        content: buildPrompt(
          input,
          platforms,
          candidateName,
          campaignContext,
          voice,
        ),
      },
    ]

    let generated: GeneratedAssets
    try {
      ;({ object: generated } = await this.llm.jsonCompletion({
        messages,
        schema: GeneratedAssetsSchema,
        temperature: 0.7,
        maxTokens: 8192,
        userId,
      }))
    } catch (err) {
      this.logger.error({ err }, 'Social asset generation failed')
      throw new BadGatewayException('Social asset generation failed')
    }

    return platforms.map((platform) => {
      const asset = generated.assets.find((a) => a.platform === platform)
      const kind = SOCIAL_PLATFORM_KIND[platform]
      // A partial set must never reach the client as a success: the flow
      // saves exactly what generate returned, so missing platforms would
      // silently persist an incomplete campaign.
      if (!asset || (kind === SocialAssetKind.video_script && !asset.caption)) {
        this.logger.error(
          { platform, requested: platforms },
          'Social asset generation returned an incomplete set',
        )
        throw new BadGatewayException(
          'Social asset generation returned an incomplete set',
        )
      }
      return {
        platform,
        kind,
        text: asset.text,
        caption:
          kind === SocialAssetKind.video_script
            ? (asset.caption ?? null)
            : null,
      }
    })
  }
}

const buildPrompt = <TPurpose extends string>(
  input: GenerateInput<TPurpose>,
  platforms: SocialAssetPlatform[],
  candidateName: string,
  campaignContext: string[],
  voice: SocialVoiceConfig<TPurpose>,
): string => {
  // custom is the only purpose adapting the author's own written message
  // rather than a fresh confirmed draft — trim/reformat, don't rewrite.
  const platformRules =
    input.purpose === 'custom' ? CUSTOM_PLATFORM_RULES : PLATFORM_RULES
  return [
    `${voice.nameLabel}: ${candidateName || voice.subjectFallback}.`,
    voice.purposePrompts[input.purpose],
    ...campaignContext,
    'Confirmed draft message:',
    '"""',
    input.draftMessage,
    '"""',
    'Requested platforms and their rules:',
    ...platforms.map((platform) => `- ${platform}: ${platformRules[platform]}`),
    'Adapt the draft into one asset per requested platform.',
  ].join('\n')
}
