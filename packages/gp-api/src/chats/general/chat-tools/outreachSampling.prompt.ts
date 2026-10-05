import {
  DEFAULT_TEXT_REPLY_RATE,
  recommendedSampleSize,
  SAMPLE_TARGET_REPLIES,
} from '@goodparty_org/contracts'

const pct = (fraction: number): string => `${fraction * 100}%`
const people = (n: number): string => n.toLocaleString('en-US')
const EXAMPLE_AUDIENCE = 58_520
const EXAMPLE_SAMPLE = recommendedSampleSize({ audience: EXAMPLE_AUDIENCE })

// How every assistant that proposes outreach sizes a random sample. The
// numbers come from size_outreach_sample, never from the model, so these
// lines only say when to call it and how to put its answer on the card.
export const buildSampleSizingRules = (args: {
  has: (name: string) => boolean
  /** Who works a phone bank or walks doors: "the official", "the candidate". */
  sender: string
  /** What about 83 replies is enough to tell, finishing the example line. */
  replyGoal: string
}): string[] => [
  `- Size a text sample with size_outreach_sample, which sizes it the way polls do, for about ${SAMPLE_TARGET_REPLIES} replies. Pass the audience count. Use its numbers as given; never work out a sample or a cost yourself.`,
  args.has('read_past_outreach')
    ? `- Pass this office's own reply rate when it has one: call read_past_outreach and take replyRate from its past texts that went to a few hundred people or more. Otherwise leave it out, and ${pct(DEFAULT_TEXT_REPLY_RATE)} is assumed.`
    : `- Leave replyRate out, and ${pct(DEFAULT_TEXT_REPLY_RATE)} is assumed.`,
  '- Never sample more people than the audience holds. When wholeAudience comes back true, send to all of it, leave sampleSize out, and say so.',
  `- A phone bank is sized by the calls ${args.sender} or their volunteers can realistically make, not by a reply rate. Use judgment from what you know of them, and say what you chose and why. Door knocking the same way, by the doors they can walk. A social post has no audience to sample.`,
  '- On the card, count stays the whole audience. For a text, set sampleSize, targetResponses and assumedReplyRate to the sampleSize, targetReplies and replyRate that size_outreach_sample returned. For a phone bank or door knocking, set sampleSize to what you chose.',
  `- Explain the number once, in one line, in your message: "I'd text ${people(EXAMPLE_SAMPLE)} of the ${people(EXAMPLE_AUDIENCE)}, picked at random. About ${SAMPLE_TARGET_REPLIES} replies is enough to tell ${args.replyGoal}." Never call it statistically proven or representative. It is directional, because the 3 in 100 who reply choose themselves.`,
]
