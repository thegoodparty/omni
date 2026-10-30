import type { EmailContent } from './EmailContent.schema'
import type { EmailLayoutPresetKey } from './EmailLayoutPreset.const'

// One finished email per layout for each product, with fictional people and
// places. Used by the template gallery and as few-shot examples for the
// drafting agent, so they must always pass EmailContentSchema (tested).
// Images point at a placeholder service until the gallery has real ones.
const PLACEHOLDER_PHOTO = 'https://placehold.co/1200x600.png'
const PLACEHOLDER_HEADSHOT = 'https://placehold.co/200x200.png'

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
          type: 'details',
          rows: [
            { label: 'When', value: 'Saturday, October 10, 10am to noon' },
            { label: 'Where', value: 'Maple Heights Library, 210 Oak Street' },
            { label: 'Bring', value: 'Comfortable shoes and a phone' },
          ],
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
          type: 'details',
          rows: [
            { label: 'When', value: 'Tuesday, November 3, 6:30pm' },
            { label: 'Where', value: 'Riverton City Hall, Room 2' },
          ],
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
      subject: 'Campaign update: 1,200 doors and counting',
      previewText: 'What we heard from voters this month, and what’s next.',
      blocks: [
        { type: 'heading', text: 'October campaign update', level: 1 },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}}, thank you for being part of this. Here’s what our campaign did this month and what voters told us.',
        },
        {
          type: 'section',
          heading: '1,200 doors knocked',
          text: 'Twenty-two volunteers covered every street east of the river. The top concern we heard was the cost of water bills, followed by speeding near schools.',
          image: {
            url: PLACEHOLDER_PHOTO,
            alt: 'A volunteer talking with a resident on a front porch',
          },
        },
        {
          type: 'section',
          heading: 'My plan for water bills',
          text: 'I published a three-step plan to audit the utility’s rate increases and put the results online. It takes about two minutes to read.',
          link: {
            label: 'Read the plan',
            url: 'https://example.org/jordan-ellis/water-plan',
          },
        },
        {
          type: 'section',
          heading: 'Candidate forum on October 20',
          text: 'All three candidates will answer questions from the League of Women Voters. Come see us side by side.',
        },
        { type: 'divider' },
        { type: 'heading', text: 'Coming up', level: 2 },
        {
          type: 'details',
          rows: [
            { label: 'Forum', value: 'Tuesday, October 20, 7pm, Central High' },
            { label: 'Early voting', value: 'Starts Monday, October 26' },
          ],
        },
        {
          type: 'button',
          label: 'Volunteer for a shift',
          url: 'https://example.org/jordan-ellis/volunteer',
        },
        {
          type: 'signature',
          name: 'Jordan Ellis',
          title: 'Candidate for City Council, Ward 3',
        },
      ],
    },
    serve: {
      layout: 'long_update',
      theme: 'classic_blue',
      subject: 'What I worked on in October',
      previewText:
        'Crosswalks, the library budget and a new recycling pickup day.',
      blocks: [
        { type: 'heading', text: 'Your October update from Ward 2', level: 1 },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}}, here’s a short look at what moved forward this month on the issues you raised with me.',
        },
        {
          type: 'section',
          heading: 'New crosswalk at Pine and 5th',
          text: 'After 40 of you wrote in about near misses outside Lincoln Elementary, the council approved a raised crosswalk. Construction finishes before winter break.',
          image: {
            url: PLACEHOLDER_PHOTO,
            alt: 'The intersection of Pine Street and 5th Avenue',
          },
        },
        {
          type: 'section',
          heading: 'Library hours stay the same',
          text: 'The draft budget cut Sunday hours. I voted no on that line, and the final budget keeps the library open seven days a week.',
          link: {
            label: 'See the final budget',
            url: 'https://example.org/riverton/budget-2027',
          },
        },
        {
          type: 'section',
          heading: 'Recycling moves to Thursdays',
          text: 'Starting November 5, recycling pickup in Ward 2 moves from Monday to Thursday. Trash day doesn’t change.',
        },
        {
          type: 'button',
          label: 'Tell me what to work on next',
          url: 'https://example.org/riverton/ward-2-survey',
        },
        {
          type: 'signature',
          name: 'Dana Whitfield',
          title: 'City Council Member, Ward 2',
          photoUrl: PLACEHOLDER_HEADSHOT,
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
          type: 'signature',
          name: 'Sam Ortega',
          title: 'Independent candidate for County Commission',
          photoUrl: PLACEHOLDER_HEADSHOT,
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
          type: 'details',
          rows: [
            { label: 'Fee starts', value: 'Saturday, November 7' },
            { label: 'Review', value: 'May board meeting' },
          ],
        },
        {
          type: 'signature',
          name: 'Priya Natarajan',
          title: 'Township Trustee',
        },
      ],
    },
  },
} as const satisfies Record<
  EmailLayoutPresetKey,
  Record<'win' | 'serve', EmailContent>
>
