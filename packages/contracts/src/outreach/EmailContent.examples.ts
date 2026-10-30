import type { EmailContent } from './EmailContent.schema'
import type { EmailLayoutPresetKey } from './EmailLayoutPreset.const'

// One finished email per layout for each product, with fictional people and
// places. Used by the template gallery and as few-shot examples for the
// drafting agent, so they must always pass EmailContentSchema (tested).
// Images point at a placeholder service until the gallery has real ones.
const PLACEHOLDER_PHOTO = 'https://placehold.co/1200x600.png'

export const EMAIL_CONTENT_EXAMPLES = {
  short_cta: {
    win: {
      layout: 'short_cta',
      theme: 'bold_red',
      subject: 'Knock doors with me this Saturday?',
      previewText: 'Two hours, one neighborhood, and coffee on me.',
      blocks: [
        {
          type: 'image',
          url: PLACEHOLDER_PHOTO,
          alt: 'Volunteers with clipboards on a sidewalk in Maple Heights',
        },
        { type: 'heading', text: 'Help me meet Maple Heights', level: 1 },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}},\n\nThe election is four weeks out, and the best way to win is talking with voters face to face. Join me for two hours of door knocking. No experience needed. We’ll pair you with someone who has done it before.',
        },
        {
          type: 'paragraph',
          text: 'Saturday, October 10, 10am to noon, at the Maple Heights Library, 210 Oak Street. Bring comfortable shoes and your phone.',
        },
        {
          type: 'button',
          label: 'Save my spot',
          url: 'https://example.org/jordan-ellis/canvass',
        },
      ],
    },
    serve: {
      layout: 'short_cta',
      theme: 'classic_blue',
      subject: 'Town hall on the Elm Street repaving',
      previewText: 'Tell us what the construction schedule should work around.',
      blocks: [
        {
          type: 'image',
          url: PLACEHOLDER_PHOTO,
          alt: 'Elm Street at the corner of Second Avenue',
        },
        { type: 'heading', text: 'Elm Street is getting repaved', level: 1 },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}}, work starts in the spring. Before we set the schedule, I want to hear from the people who live and work on Elm. Come tell me what the crews should plan around.',
        },
        {
          type: 'paragraph',
          text: 'Tuesday, November 3, at 6:30pm in Room 2 at Riverton City Hall.',
        },
        {
          type: 'button',
          label: 'RSVP for the town hall',
          url: 'https://example.org/riverton/elm-street-town-hall',
        },
      ],
    },
  },
  long_update: {
    win: {
      layout: 'long_update',
      theme: 'fresh_green',
      subject: 'What 1,200 conversations taught me',
      previewText:
        'What I heard at the doors this month, and what I’ll do about it.',
      blocks: [
        { type: 'heading', text: 'What I heard at your doors', level: 1 },
        {
          type: 'image',
          url: PLACEHOLDER_PHOTO,
          alt: 'A volunteer talking with a resident on a front porch',
        },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}},\n\nThis month our volunteers and I knocked on 1,200 doors east of the river. I want to tell you what voters told us, because it changed what this campaign will focus on for the next four weeks.',
        },
        {
          type: 'paragraph',
          text: 'I expected to hear about property taxes. Some people did bring them up. But the thing almost everyone mentioned first was their water bill. One retired teacher on Birch Street showed me three months of bills that had gone up by a third, with no letter from the utility explaining why.',
        },
        { type: 'heading', text: 'Why water bills keep going up', level: 2 },
        {
          type: 'paragraph',
          text: 'The city council approved two rate increases in the last eighteen months. Both passed on the consent agenda, without public discussion. The utility says the money pays for pipe repairs, but it hasn’t published which repairs, where, or what they cost.\n\nI don’t think that’s good enough. If we’re paying more, we deserve to see where the money goes.',
        },
        { type: 'heading', text: 'What I’ll do on the council', level: 2 },
        {
          type: 'paragraph',
          text: 'First, I’ll ask for an independent audit of the last two rate increases and put the results online. Second, I’ll move every future rate change off the consent agenda so it gets a real public hearing. Third, I’ll push for a simple monthly report showing which pipes were fixed and what each repair cost.',
        },
        { type: 'divider' },
        {
          type: 'paragraph',
          text: 'Early voting starts October 26. If you have a question about any of this, just reply. I read every email myself.',
        },
        {
          type: 'paragraph',
          text: 'The candidate forum is Tuesday, October 20, at 7pm at Central High.',
        },
        {
          type: 'button',
          label: 'Read my full water plan',
          url: 'https://example.org/jordan-ellis/water-plan',
        },
        {
          type: 'paragraph',
          text: 'Thank you,\nJordan Ellis\nCandidate for City Council, Ward 3',
        },
      ],
    },
    serve: {
      layout: 'long_update',
      theme: 'classic_blue',
      subject: 'Your October update from Ward 2',
      previewText:
        'Crosswalks, the library budget and a change to recycling day.',
      blocks: [
        { type: 'heading', text: 'Your October update from Ward 2', level: 1 },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}},\n\nA lot moved forward this month on the issues you’ve raised with me. Here’s where things stand, what I voted for and why, and what’s coming up next.',
        },
        { type: 'heading', text: 'A safer crossing at Pine and 5th', level: 2 },
        {
          type: 'paragraph',
          text: 'After more than 40 of you wrote in about near misses outside Lincoln Elementary, I asked the traffic engineer to study the intersection. The study found that most drivers were going well over the school-zone limit at drop-off time.\n\nOn October 14 the council approved a raised crosswalk and two new flashing signs. Construction starts next week and should finish before winter break.',
        },
        {
          type: 'heading',
          text: 'The library keeps its Sunday hours',
          level: 2,
        },
        {
          type: 'paragraph',
          text: 'The first draft of next year’s budget closed the main library on Sundays to save about $40,000. I voted against that line. Sunday is the only day many working parents can bring their kids, and the library is the only free place in the ward with reliable internet.\n\nThe final budget keeps the library open seven days a week. The savings will come from delaying a vehicle purchase instead.',
        },
        { type: 'divider' },
        { type: 'heading', text: 'Recycling moves to Thursdays', level: 2 },
        {
          type: 'paragraph',
          text: 'Starting November 5, recycling pickup in Ward 2 moves from Monday to Thursday. Trash day doesn’t change. The city will leave a reminder tag on every bin the week before.',
        },
        {
          type: 'button',
          label: 'Tell me what to work on next',
          url: 'https://example.org/riverton/ward-2-survey',
        },
        {
          type: 'paragraph',
          text: 'Thank you,\nDana Whitfield\nCity Council Member, Ward 2',
        },
      ],
    },
  },
  personal_letter: {
    win: {
      layout: 'personal_letter',
      theme: 'cream_and_forest',
      subject: 'Why I’m running',
      blocks: [
        {
          type: 'image',
          url: PLACEHOLDER_PHOTO,
          alt: 'Sam Ortega with his Little League team on the field',
        },
        {
          type: 'paragraph',
          text: 'Dear {{first_name}},\n\nI’ve coached Little League in this town for eleven years. Last spring our field flooded for the third season in a row, and nobody at the county could tell me who was responsible for fixing the drain.',
        },
        {
          type: 'paragraph',
          text: 'That’s when I decided to run for County Commission. I’m not backed by a party or big donors. I’m backed by neighbors who want a county that answers the phone.\n\nIf you have a question for me, just reply to this email. I read every one.',
        },
        {
          type: 'button',
          label: 'See where I stand',
          url: 'https://example.org/sam-ortega/issues',
        },
        {
          type: 'paragraph',
          text: 'Thank you,\nSam Ortega\nIndependent candidate for County Commission',
        },
      ],
    },
    serve: {
      layout: 'personal_letter',
      theme: 'fresh_green',
      subject: 'About Tuesday’s vote on the park fee',
      blocks: [
        {
          type: 'paragraph',
          text: 'Dear {{first_name}},\n\nOn Tuesday the board voted 4 to 1 to add a $2 parking fee at Lakeside Park on weekends. I was the one no vote, and I want you to hear why from me.',
        },
        {
          type: 'paragraph',
          text: 'The fee covers about a third of the park’s repair backlog. I agree the repairs can’t wait. But families who use the park most told me $2 every weekend adds up, and I think we can close the gap with the state grant we applied for in August.\n\nThe fee is up for review in six months. Before then, I’d like to know what you think.',
        },
        {
          type: 'paragraph',
          text: 'The fee starts Saturday, November 7, and the board will review it at the May meeting.',
        },
        {
          type: 'paragraph',
          text: 'Thank you,\nPriya Natarajan\nTownship Trustee',
        },
      ],
    },
  },
} as const satisfies Record<
  EmailLayoutPresetKey,
  Record<'win' | 'serve', EmailContent>
>
