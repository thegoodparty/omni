// The product map: what GoodParty.org's product does, where each part of it
// lives, and what the assistants can and cannot change from chat.
//
// WHY THIS FILE EXISTS. A quarter of everything candidates ask the Campaign
// Manager is a product question, and until this existed neither assistant had
// any description of the platform in its prompt. They guessed at menu
// locations they could not see, relayed stale web-search results about
// GoodParty back to GoodParty users, recommended two third-party canvassing
// apps to a candidate who already had our door-knocking tool, and named eight
// different support routes across fifteen sessions. (Campaign manager
// conversation audit, September 2026, section 3; the chief of staff audit
// found the same gap in July.)
//
// HOW TO CHANGE IT. This is one source of truth for both assistants, rendered
// into each prompt by productKnowledgePrompt.ts. Every nav tab in
// gp-webapp's DashboardMenu.tsx must have an entry here, and CI fails a PR
// that adds one without it (scripts/product-map-coverage.ts). Read
// docs/product-knowledge.md before editing.
//
// WHAT BELONGS HERE. Only what a user could see and act on: the name of the
// tab as it reads in the left rail, what they do there, and where things sit
// inside it. Not our architecture, not service names, not flag names. If a
// statement would be wrong the day a designer renames a button, it is too
// specific to be worth the staleness.

export type ProductMode = 'win' | 'serve'

export interface ProductArea {
  // The nav item id in gp-webapp's DashboardMenu.tsx, which the coverage
  // check matches against. Null for a real surface with no tab of its own
  // (door knocking and the website builder are both reached from elsewhere).
  navId: string | null
  // Exactly what the tab reads in the left rail. The assistant tells users to
  // click this string, so it must match the UI character for character.
  name: string
  path: string
  modes: ProductMode[]
  // One sentence, in the user's terms: what they do here.
  does: string
  // Notable things INSIDE the area, for the "where do I find X" questions
  // that made the assistant guess. Each entry names what it is and where it
  // sits on the page.
  inside?: string[]
  // Access note, when the area is not simply available: Pro, a payment, a
  // prerequisite. Stated as the user experiences it.
  gate?: string
  // A second nav entry pointing at an area already described above (the
  // account menu repeats Profile and Community). It still needs an entry so
  // the coverage check sees the id, but rendering it again would tell the
  // assistant the same thing twice under the same name.
  aliasOf?: string
}

// Areas both products share. Billing lives in Account Settings, which is the
// single most common escalation the assistants get wrong.
const SHARED_AREAS: ProductArea[] = [
  {
    // The rendered one. `campaign-details-dashboard` below carries the label
    // 'My Profile', but that menu item has no v2Category and the nav filters
    // it out, so no user has ever seen those words. What they see is this.
    navId: 'nav-dash-profile',
    name: 'Profile',
    path: '/dashboard/profile',
    modes: ['win', 'serve'],
    does: 'Edit your profile photo, party, bio, occupation, website, and campaign or office details.',
    inside: ['In the account menu, at the bottom of the left-hand menu'],
  },
  {
    navId: 'campaign-details-dashboard',
    name: 'My Profile',
    path: '/dashboard/profile',
    modes: ['win', 'serve'],
    does: 'The same profile page. This menu entry is filtered out of the nav and never renders.',
    aliasOf: 'Profile',
  },
  {
    navId: 'nav-dash-account',
    name: 'Account Settings',
    path: '/dashboard/account',
    modes: ['win', 'serve'],
    does: 'Your name, sign-in details, notifications, billing, subscription, and closing an account. This is where every payment and cancellation question goes.',
    inside: [
      'Edit details, on the first card, changes your first and last name',
      'Manage sign-in, next to it, changes your sign-in email, phone, and password',
    ],
  },
  {
    navId: 'nav-dash-support',
    name: 'Get help',
    // Not a section: it ends the main nav on desktop and sits in the account
    // group on mobile. See SUPPORT_ROUTE in productKnowledgePrompt.ts.
    path: 'the bottom of the left-hand menu',
    modes: ['win', 'serve'],
    does: 'Opens the support chat, where a person answers billing, account, and anything that needs changing on their behalf.',
    inside: [
      'It opens the chat in place; there is no separate page to navigate to',
    ],
  },
  {
    // Same story as Profile: the rendered label is "Community Forum", in the
    // account menu. The 'community-dashboard' entry's "Community" label is
    // filtered out of the nav and never reaches a screen.
    navId: 'nav-dash-community',
    name: 'Community Forum',
    path: 'the GoodParty.org community on Circle',
    modes: ['win', 'serve'],
    does: 'A separate community site where candidates and elected officials talk to each other. It opens in a new tab and is not part of the dashboard.',
    inside: ['In the account menu, at the bottom of the left-hand menu'],
  },
  {
    navId: 'community-dashboard',
    name: 'Community',
    path: 'the GoodParty.org community on Circle',
    modes: ['win', 'serve'],
    does: 'The same community site. This menu entry is filtered out of the nav and never renders.',
    aliasOf: 'Community Forum',
  },
]

// Win: the candidate product. Home is the home tab.
const WIN_AREAS: ProductArea[] = [
  {
    navId: 'campaign-tracker-dashboard',
    name: 'Home',
    path: '/dashboard',
    modes: ['win'],
    does: 'The home tab, and where this chat lives, leading with the plan’s next task. While it rolls out, some candidates still see this tab named Campaign Manager, with the week’s top tasks listed under their progress.',
    inside: [
      'Opening the chat resumes their most recent conversation; New chat in the chat header starts a fresh one',
      'The clock icon in the chat box lists previous conversations, and each one can be reopened or deleted there',
      'Each reply carries a copy button and a thumbs up / thumbs down',
      'Rating a reply opens a bubble for an optional note; tapping the same thumb again takes the rating back',
      'The paperclip in the message box attaches a PDF, Word document, image, or text file to the message; dragging a file onto the chat does the same',
      'Pasting a link attaches it as a source the assistant can read',
      'A citation in a reply opens the document it points to, to the cited page when there is one',
      'Asking to turn a reply into a social post opens Voter Outreach’s social flow with the draft already written in, to review before you post it',
      'Asking the chat to reach voters gets an outreach card for one channel: a text, phone banking, door knocking or a social post. The card’s button opens that channel’s Voter Outreach flow with the audience and message filled in, to review before it goes out; a text or phone banking card opens on the message or script, its list already saved and picked, and Back goes to the list and the purpose; a text is paid for there',
      'A text card can go to a random sample of voters instead of everyone, sized the way polls are, with the cost of each',
      'Once the deadline to get verified for texting has passed for a campaign that did not file and pay for Pro in time, the chat offers no text cards and suggests door knocking, robocalls, phone banking or social media instead',
      'Asking the chat to build a list of voters gets a list card with a Create list button; once pressed, the card turns into the list on a map',
      'A list shown on a map here has Draw shapes / Edit shapes beside Open list, which narrows that list to the shapes without leaving the conversation',
      'Asking how an earlier send did gets its numbers in the reply, and can leave cards for those sends that open each one in Voter Outreach',
    ],
  },
  {
    navId: 'campaign-story-dashboard',
    name: 'Your Story',
    path: '/dashboard/campaign-story',
    modes: ['win'],
    does: 'The three Campaign Story questions (why you are running, your background, your positions), which the campaign and outreach plan is generated from.',
    inside: [
      'One Save in the page title bar commits every field at once; nothing saves until they press it',
      'Start over at the bottom clears the fields on screen but deletes nothing until they Save',
    ],
  },
  {
    navId: 'campaign-plan-dashboard',
    name: 'Campaign Plan',
    path: '/dashboard/campaign-plan',
    modes: ['win'],
    does: 'The campaign as a timeline of tasks in three phases (Launch, Active campaign, Get out the vote), with the full written plan under the Campaign strategy card at the top. Every candidate gets one; finishing the Campaign Story personalizes it. A task started from its own button (a text, a robocall, a call list, a social post, door knocking) is marked done on its own once that outreach is scheduled. Skip on the next task offers Show in 3 days (never past its due date) or, for anything but ballot access, Not for me; either can be brought back with Bring it back in the task menu. While it rolls out, some candidates still see the earlier page: the plan with their tasks grouped by phase below it.',
    gate: 'No gate. A candidate with no Campaign Story still gets a campaign and outreach plan, just a generic one, and completing the story regenerates it from their own answers.',
  },
  {
    navId: 'outreach-dashboard',
    name: 'Voter Outreach',
    path: '/dashboard/outreach',
    modes: ['win'],
    does: 'Build and send outreach to a voter audience, and see the history of what has gone out.',
    inside: [
      'Five channels: SMS, Robocall, Social media, Phone banking, and Door knocking',
      'Door knocking opens its own page rather than a flow here',
      'To add turfs to a door knocking campaign, open it in the outreach history and press Add turf beside Turfs in this campaign. The new turfs use the campaign’s list and talking points',
      'Each channel starts by asking who to reach, which reads from your saved lists',
      'A text asks for the message before the date it goes out: purpose, who to reach, message, date, then review and pay',
      'Picking an event invite for a text, phone banking or door knocking asks for the event date, start time and place first, and the draft writes them in',
      'A text or robocall can be written and saved before upgrading to Pro: build it, save it, and finish it once you can send',
      'A saved one waits in the outreach history, labeled with what it still needs — Pro needed, Verification needed, Verification in review, PIN needed, or Ready to schedule. A saved text reads Texting closed once the deadline to get verified for texting has passed',
      'Texting needs campaign verification filed and Pro paid for by 19 days before the general election. After that deadline, a campaign that missed it sees the SMS tile marked Not available for this race, and Robocall, Social media, Phone banking and Door knocking stay open',
      'Click that row to reopen the flow and pick up where you left off, or delete it from there',
      'One saved text and one saved robocall at a time, kept for 90 days',
      'SMS and Robocall take a promo code on their payment step, in a Promo Code box above the card details. A code that covers the whole cost schedules the send with no card',
      'Phone banking and Door knocking offer Hear from voters as a goal. The flow asks what question to put to people, and the call script or door card is written to ask it',
    ],
  },
  {
    navId: 'win-contacts-dashboard',
    name: 'Voter Data',
    path: '/dashboard/contacts',
    modes: ['win'],
    does: 'Browse the district’s voter file, filter it, and save lists to use for outreach.',
    inside: [
      'Saved lists live HERE, on the lists index below the district stat card. This is the answer to "where are my lists" and it is not under Contacts',
      'Create new list is in the top bar of the page',
      'Filters cover voter likelihood, party, age, phone on file, prior contacts made, support status, and precinct, among others',
      'The district stat card carries projected turnout and voters needed to win',
      'Recommended voter lists sit above the saved lists: ready-made audiences (voters who have not heard from you, persuadable independent-leaning voters, your supporters to invite or turn out) with a Details view and a Send outreach button, no saving needed',
      'Send outreach on any list, saved or recommended, opens Choose a channel, then that channel’s outreach flow with the list already picked',
      'Opening a list shows its filter summary and outreach history, never a table of individual voters',
      'Opening a list also shows a map of where its voters are',
      'Draw shapes on that map to narrow the list to one or more parts of the district',
      'The create-list flow asks for those shapes too, between the filters and the name, and it can be skipped',
      'Shapes can be added, renamed, recoloured, redrawn or deleted until the list has been used for outreach',
      'A voter’s record can carry What they told us: what they said at the door or on the phone, the issues they raised, where they stand on each and what they want, and any accepted tags. It is being rolled out account by account',
    ],
    gate: 'Filtering the voter file needs the Pro upgrade, and so does seeing which precincts it covers. Without Pro the page still shows district aggregates and a blurred preview.',
  },
  {
    navId: 'race-opponent-dashboard',
    name: 'Know Your Opponent',
    path: '/dashboard/race-opponent',
    modes: ['win'],
    does: 'Opposition research on the other candidates in the race, starting with a pass on the candidate’s own public record.',
    gate: 'Pro only. The tab is visible without Pro but shows an upgrade view instead of the research.',
  },
  {
    navId: 'public-profile-campaign',
    name: 'Public Profile',
    path: '/dashboard/public-profile',
    modes: ['win'],
    does: 'Edit the public page voters see, including its own "Why I’m running" and priorities.',
  },
  {
    navId: null,
    name: 'Candidate website',
    path: '/dashboard/website',
    modes: ['win'],
    does: 'The build-your-own campaign website, which is being discontinued. It is no longer in the left rail and nothing on the dashboard links to it.',
    inside: [
      'Do not suggest starting a new site here. If they ask, say the feature is being discontinued',
      'A candidate who bought a domain through us is asked to transfer it to another provider, from the notice on their dashboard and the Transfer button on Profile',
      'An existing site can still be edited at app.goodparty.org/dashboard/website',
      'Custom domain setup and its DNS instructions are under the site’s Domain settings',
    ],
  },
  {
    // The nav id belongs to a placeholder that holds the Voter Data slot
    // for the moment before we know whether the org is a campaign.
    // Describing it as a second "Voter Data" tab would be wrong: what a
    // candidate can actually reach here is the upgrade flow.
    navId: 'upgrade-pro-dashboard',
    name: 'Pro upgrade',
    path: '/dashboard/pro-upgrade',
    modes: ['win'],
    does: 'Upgrade to Pro, which is what unlocks filtering the voter file and Know Your Opponent.',
    inside: [
      'One flow: the candidate answers whether they have filed, gives their campaign EIN and their campaign filing details (plus a candidate profile if they have not written one), then pays',
      'Candidates who were already Pro without filing details on record add them under Campaign verification',
      'The same flow can open inside a text or robocall you are building, so upgrading does not lose the work',
      'The Welcome to Pro screen shows the receipt for the $10 monthly charge, with the card used and a download',
    ],
  },
  {
    // No tab: candidates reach this from the membership status shown at the
    // bottom of the left rail (or, on a phone, in the top bar), and from the
    // end of the Pro upgrade flow.
    navId: null,
    name: 'Campaign verification',
    path: '/dashboard/campaign-verification',
    modes: ['win'],
    does: 'Register a Pro campaign with the phone carriers, which is what makes texting possible.',
    inside: [
      'Campaign filing details: the committee name, the filing link, and where to send the PIN',
      'Carrier review takes about 1 to 2 weeks, then a PIN arrives to finish it',
      'Once verified, the membership status at the bottom of the left rail (on a phone, in the top bar) reads Schedule your text. It opens the text the candidate saved, or starts a new one',
      'The deadline to get verified for texting is 19 days before the general election. A candidate who has not filed and paid for Pro by then cannot get verified for this race. They can still save their filing details. Door knocking, robocalls, phone banking and social media stay open',
    ],
    gate: 'No tab, and not every candidate is offered it. Filing details can be submitted before paying, but carrier registration only starts once Pro is paid for.',
  },
  {
    navId: 'nav-dash-team',
    name: 'Team',
    path: '/dashboard/team',
    modes: ['win'],
    does: 'Invite campaign staff and manage who has access. In the account menu, and candidate campaigns only.',
    inside: [
      'Only the owner can remove members or change roles',
      'A member can also leave on their own: Leave campaign in the sidebar of their volunteer view',
    ],
  },
]

// Serve: the elected-official product. Chief of Staff is the home tab.
const SERVE_AREAS: ProductArea[] = [
  {
    navId: 'chief-of-staff-dashboard',
    name: 'Chief of Staff',
    path: '/dashboard/chief-of-staff',
    modes: ['serve'],
    does: 'The home tab, and where this chat lives, leading with one task at a time: the get-started cards first (with the civic panel build card between them where the civic panel is on), then the week’s meeting, agenda and community issue tasks by due date.',
    inside: [
      'Where the civic panel is on, setting up a new office walks through a short story on a street map of the district before landing here: how many people you represent (each dot stands for a group of residents), that until now you have mostly heard from the loudest voices, that a few voices from every group tell you where your community stands (the info button beside it says we aim to hear from every age group, neighborhood, race and gender in your district), and the loop of Ask residents, See what matters most, Vote with what you learned and Tell them what you did. Then you pick your priorities and take the pledge, whose Meet your Chief of Staff button opens this tab. The dots near the middle and the ones that fill in are an illustration, not real residents or real outreach',
      'The task in front has its main button, Mark done, Ask about this and Skip; finishing or skipping it brings the next task forward',
      'Ask about this opens a new chat with your Chief of Staff about that task. The civic panel cards do not have it, since their own button already opens a conversation',
      'Two get-started cards: Get the staff your office never had, which opens this chat to meet your Chief of Staff, and Get help focused on what you care about, which opens it to share your priorities. A new official always sees Get the staff your office never had first, until they open it or skip it; chatting from anywhere else does not count. They have no Mark done or Ask about this; they leave on their own once you have opened the first one, or shared your priorities',
      'Meeting your Chief of Staff, from that card or on your first chat, it says what it does and asks what you want to start with, with four cards: See what matters in your community, Build your civic panel (Grow your civic panel once it has members; Hear from your constituents where the civic panel is off), Get ready for your next meeting, and Something else, which opens a box to write your own. All four are checkboxes: pick one or more and press Start (with Something else picked, Start waits until you type something). One pick works on its own: Build your civic panel and Grow your civic panel start building it in this chat, Grow picking up at the plan’s next step, each other step starts that conversation, and Something else sends what you wrote. Picking more than one sends them as one message, and your Chief of Staff starts on the first, says it will come back to the rest, and moves to the next one once you are done with it: the steps in the order shown, then what you wrote last. None of them finishes the get-started card. A new chat from the chat bar shows the same cards',
      'Where the civic panel is on, the card right after Get the staff your office never had (the first card once that one is done or skipped), under People first, is Know what residents think before you decide, ahead of Get help focused on what you care about. It builds your civic panel, for every official, however long ago they joined. It shows no due date and no price; the cost comes in the text’s pay step. What’s a civic panel? on it opens this chat on the home to explain the panel, and builds nothing unless you say yes: with no panel yet, the answer ends with a Build my panel button that starts building it in this chat, and with members it offers nothing more. Build your panel on the card starts the same conversation, with or without a plan, which explains the panel, asks how much time you can give each week and plans texts, calls and door knocking from it; the civic panel page (Constituents, Your civic panel) does the same with its own form. Once you have a plan, the card keeps the same words and its Build your panel button, and the conversation it opens shows the plan’s next step. Asked in this chat to build the panel, your Chief of Staff makes the same plan the panel page does: with no plan yet it explains the panel in a line or two and asks How much time can you give each week? with the same answers, makes the plan from your answer, and shows its next step as a card that names it the way the panel page does (for example Call 60 residents, with who they are and how long it takes) and whose button (Start the text, Start the calls, Start door knocking, Keep calling or Keep knocking) opens that step’s own text, phone banking or door knocking flow, the same as the button on the panel page. The card shows no member count or panel status. While the plan waits on replies, it shows See your plan with the plan’s Next line and opens the panel page. Once your first text has gone out from this chat and you have no priorities yet, it ends by asking which priorities you want to work on and offers to record them. With a plan already, it shows that card and never asks again, and telling it you can give a different amount of time each week changes it for the next round. If no plan can be made (everyone it can reach was already invited), it says so and links the panel page; it never offers a single invite text. It has no Mark done; it is done once a text asking people to join is paid for, which the plan’s first text step does, or once the plan reaches its member goal (250 members at most). After that, while the plan has a step to take, a card under the same People first headline names that step (for example Call 60 residents), says who it reaches and how long it takes, and its button (Start the text, Start the calls, Start door knocking, Keep calling or Keep knocking) opens it on the panel page; there is no such card while a text waits on replies; skipping it sets aside that step’s card only, and the next step gets its own. Skip offers Show in 3 days, which brings it back to the front three days later, or Not for me, which sets it aside until Bring it back on it under Archive, Skipped',
      'Where the civic panel is on, Next steps on your priorities sit under the build card, whether it is open, put off, set aside or done: a card for each open priority with its next step, the same line as Next under Where this stands (or, with none, the step the Priorities page shows), and an Open priority button. It has no Mark done; it stays until the priority is archived or its plan is ready, and comes back if the priority is unarchived or a step opens up again. Skip offers Show in 3 days or Not for me, and Bring it back under Archive, Skipped. Meeting, agenda and community issue tasks show throughout, behind the build card while it leads',
      'Where the civic panel is on, a priority gets one Show people their voice counted on <priority> card once a text on it has its replies in and someone has answered, due two weeks later. It says where the read stands (for example A few groups need more answers) and what to do: tell everyone who answered what you heard. A new card shows each time the read changes, and only the one for where it stands now stays open. Report back opens that priority’s conversation, which walks through what came back and drafts a text to everyone who answered on any channel (texts, calls and door knocks), each counted once, telling them what you heard and what you will do next. Once the read is good (Every group heard, or Enough people have answered) it comes first on the home while it is open, ahead of the civic panel card under People first (only Get the staff your office never had comes before it). Before that it waits behind the civic panel and get-started cards. It is done once that text is paid for, or with Mark done. Skip offers Show in 3 days or Not for me, and Bring it back under Archive, Skipped',
      'Archive, in the page’s title bar, lists this week’s tasks, the ones marked done, the ones skipped and the ones missed',
      'Each reply carries a copy button and a thumbs up / thumbs down',
      'Rating a reply opens a bubble for an optional note; tapping the same thumb again takes the rating back',
      'When the chat offers a list, it appears as a card with the list name, its size and a Create list button; pressing it saves the list and the card turns into the list on a map',
      'A list shown on a map here has Draw shapes / Edit shapes beside Open list, which narrows that list to the shapes without leaving the conversation',
      'A list already used for outreach is locked, so its map offers no draw button',
      'The chat can leave cards in the conversation: a finished piece of outreach, past sends and how they did, and someone outside your records to call, with a script',
      'A phone banking outreach card is sent from its Send button without leaving the chat; a text or social one opens its outreach flow to finish there',
      'A text or phone banking card opens its outreach flow over the chat on the message or script, with the purpose already picked and the list already saved and picked. Back goes to the list, then the purpose, to change either; Continue goes on to the date (or call sheets) and payment. A card with no list to save opens on choosing who to reach instead',
      'A text outreach card can go to a random sample of its audience instead of everyone, sized the way polls are, and reads like "Text 2,767 of 58,520, picked at random". Asking for everyone instead gets a card for the whole audience',
      'When there is a choice to make, the chat asks it as a multiple-choice question, with room to write your own answer',
      'The paperclip in the message box attaches a PDF, Word document, image, or text file to the message; dragging a file onto the chat does the same',
      'Pasting a link attaches it as a source the assistant can read',
      'A citation in a reply opens the document it points to, to the cited page when there is one',
      'Asking to turn a reply into a social post opens Outreach’s social flow with the draft already written in, to review before you post it',
    ],
  },
  {
    navId: 'briefings-dashboard',
    name: 'Briefing Assistant',
    path: '/dashboard/briefings',
    modes: ['serve'],
    does: 'Prepared briefings for upcoming meetings: what is on the agenda and what is worth knowing before the room.',
    inside: [
      'Ask AI on a briefing opens a chat about that briefing',
      'Highlighting text in a briefing starts a question anchored to that passage',
      'Notes taken on a briefing stay with it',
      'A meeting whose agenda could not be found stays marked Awaiting agenda, with a place to paste the agenda link or upload the file',
      'A pasted agenda that turns out to be for another meeting is called out on that meeting, and the link can be tried again',
    ],
  },
  {
    navId: 'community-issues-dashboard',
    name: 'Community Issues',
    path: '/dashboard/community-issues',
    modes: ['serve'],
    does: 'A researched feed of what the district is talking about, split into the top ongoing issues and what is trending now.',
    inside: [
      'View all issues and View all open the full lists',
      'An issue’s detail page shows its category, rank, sources, and the briefings it touches',
    ],
  },
  {
    navId: 'priorities-dashboard',
    name: 'Priorities',
    path: '/dashboard/priorities',
    modes: ['serve'],
    does: 'Hold the things you are trying to get done this term, and work one of them forward with help.',
    inside: [
      'Add a priority writes down what you want to get done and why it matters, then opens that priority’s conversation',
      'An issue from Community Issues can be pulled in as a priority with Make this a priority here, or Add to my priorities on the issue. Either one opens that priority’s conversation',
      'Issues picked during sign-up, from the campaign or the community, start here as priorities. The sign-up step that asks for them is being rolled out account by account',
      'Each row shows the step it is on and the next thing to do about it',
      'Opening a priority works it forward one step at a time',
      'Before a step is done, it offers to check it with the constituents it affects most and least, with the lists and the question ready',
      'Where the civic panel is on, that check starts as three cards offered together: door knocking in one walkable neighborhood, and phone banking and a text to residents across the district picked at random, each inviting the people it reaches to join your civic panel. Starting the door knocking opens the walk with that neighborhood already drawn as its first turf. Doors and calls are sized from the time you give each week (it asks how much if you have no panel plan), and the text is sized so every sizable group of residents is expected to give at least 3 answers. The most and least affected come after, if what comes back is thin or one-sided',
      "Where the civic panel is on, an open priority shows where its read stands, at the top on a phone, above Where this stands on a computer. Until a check is out with residents it says No one asked yet, with no button. Once one is out and the read is still short, it shows a Get answers button. While a follow-up text is scheduled, the button gives way to Follow-up text to N people on its date. Until every large group has been heard from, it shows a bar of groups (for example 9 of 12 groups heard). The groups are by age, neighborhood, gender, and race where enough of the people who answered have one on file, and a group is large at 3% of the district or more; heard means at least three answers. It shows one status, with a line naming the groups: Waiting to hear back while a large group has no answer, A few groups need more answers while one has fewer than three, Still unsure what some groups think while it cannot yet say within about 10 points either way what a large group thinks (Still unsure what people 65 and over think), then Every group heard (You've heard from every group). Before that last stage the line says Still need to hear from a group with no answers yet (Still need to hear from men) and Need a few more answers from a group with only a few (Need a few more answers from women and people 65 and over), both in one sentence when it names one of each. Neighborhoods read as \"people in some parts of your district\", or \"people in a few neighborhoods\" once every one has answered. On a computer, once every group is heard, See what we heard is the one link to the results. A good read is every large group heard from, and enough answers to say what each of them thinks. Get answers is a detour in the priority's conversation: it proposes the outreach aimed at those groups, a text, calls and door knocking together when more than a text is needed, as cards you send yourself, then goes back to the step you were on in one line. It never starts the civic panel, and once the follow-up text is scheduled or has gone out it proposes only calls and doors, never a third text; for parts of the district not reached yet, the list it saves carries those parts as a shape on its map, named Not reached yet, which you can see and change like one you drew. Once every group is heard, it says so, with See what we heard. Before then the results page holds back what we heard, with the same line naming which groups are short, and We'll show what we heard once every group has enough answers (or once we're sure what every group thinks). If the district's census could not be checked, enough answers say Enough people have answered instead, and the results open without a claim about which groups answered",
      "Where the civic panel is on, the text a priority's first round of outreach proposes is one purchase sent in two rounds, and its card says so (for example Text 2,000 of 58,520: 1,000 now, 1,000 two weeks later). Half go out on the date you pick, to residents picked at random. The rest are held and go out about two weeks later, to the groups you have heard from least once replies are in, never to anyone the first half reached; there is nothing more to do or pay. It is sized to at most 90% of the people left after the first half, so a few opt-outs by then still leave it full. The review step shows a Follow-up row with how many and when. Until it goes out, the priority shows Follow-up text to N people on its date. In Outreach history the follow-up reads Draft until its recipients are picked and Scheduled after, with Recipients picked on its date, from the groups you've heard least from; its list stays out of Constituents lists and can't be edited or deleted. If nobody is left to text when it is picked, it reads Canceled with Nobody left to text, so this was canceled. We'll refund it. A text too small to split goes out whole",
      'Where the civic panel is on, What we heard, under the answers on an open priority, pools every text, call and door knock sent for it: how many answered, how many joined your civic panel, the themes in what they said (We’re reading what people said. Themes show up here soon. while the first summary of a good read is still running), a map of where answers came from, and Who you’re hearing from: the same petals as the civic panel page, one per group by age, gender and race where it can be named, each sized by that group’s share of the answers against its share of the district. Before a good read it shows only who answered, the status, the groups heard so far and which groups to hear more from, and holds back the themes, the map and the comparison. Until then the conversation and your Chief of Staff do not share themes either; asked directly, they say what came back in a sentence or two and that it is too early to act on',
      'Where the district’s census figures are not available yet, Who you’re hearing from says so instead of showing petals',
      'Where the civic panel is on, once a text’s replies are in, the priority offers to report back: it shows who it goes to (everyone who answered on any channel, each once), how many answered and the main themes, asks what you will do next, and drafts a short text to those who have not opted out since. It never quotes anyone, never asks them to join the panel, and goes out from the card’s Start the text button like any other text',
    ],
    gate: 'Priorities is being rolled out, so it is not on every account yet.',
  },
  {
    navId: 'ordinances-dashboard',
    name: 'Ordinances',
    path: '/dashboard/ordinances',
    modes: ['serve'],
    does: 'Work a policy idea up into a drafted ordinance, one step at a time.',
    inside: [
      'The steps run in order: whether the body has the authority, what the current law says, what comparable places did, then a draft',
      'Each step has its own chat, so a question asked on one step stays there',
    ],
  },
  {
    navId: null,
    name: 'Polls',
    path: '/dashboard/polls',
    modes: ['serve'],
    does: 'Commission a poll of the district and read the results. It is no longer in the left rail. New polls are created and opened from Outreach; past polls open from a constituent’s record.',
    inside: [
      'Each poll in the list opens its own results page. Until a poll goes out it shows its message and send date; after that it shows how many were texted, how many responded, the response rate and the opt-out rate, and refreshes by itself',
      'Under 20 responses it says Not enough responses yet and shows no themes. From 20 up it shows up to 5 top themes with their mentions and an "N new" tag for responses since the last read, plus an Other responses card for replies that fit no theme. Poll confidence, high or low, is worked out by GoodParty.org',
      'Opening a theme lists its responses. Filter them by All, Unread or Favorited, tap the heart to keep one, and open one to see when it arrived and, if the person is in your constituents, their status with a link to their record. A response counts as read once you open it',
      'Gather more feedback is on the results page for a poll that has gone out, and in the low-confidence and Not enough responses alerts. It asks how many more constituents to text: the minimum for a reliable sample, everyone you have not messaged yet, or a dollar amount. It never texts anyone the poll already reached',
      'Gather more feedback is paid at checkout, then held for review within 2 business days before it sends. Until then the results page lists it as In review, and only one request can be open at a time',
    ],
    gate: 'Polls are paid for individually, and a poll’s reach can be extended by paying more. Self-serve polls and Gather more feedback are being rolled out office by office.',
  },
  {
    navId: 'constituent-outreach-dashboard',
    name: 'Outreach',
    path: '/dashboard/constituent-outreach',
    modes: ['serve'],
    does: 'Build and send outreach to constituents, and see what has gone out.',
    inside: [
      'Four channels: Social media, SMS, Phone banking, and Door knocking. Where self-serve polls are on, a fifth, Poll / Survey, sits beside them',
      'Poll / Survey walks topic, who, question, date, then review and pay. Picking a topic drafts the question; the tone (Neutral, Warm, Direct, Friendly) and Regenerate rewrite it, and Optimize message flags wording that leads people toward an answer. It goes to a random sample of constituents, sized for a reliable read, or to a saved list. The greeting and the opt-out line are fixed. It is paid per text at checkout and then held for review, within 2 business days, before it sends at 11am local on the date chosen',
      'Door knocking opens its own page rather than a flow here',
      'To add turfs to a door knocking campaign, open it in the outreach history and press Add turf beside Turfs in this outreach. The new turfs use the campaign’s list and talking points',
      'What has gone out is listed under Your outreach, most recent first. A finished text shows its responses and unsubscribes, and a phone banking row shows how many people need a follow-up',
      'SMS drafts a text, picks a saved constituent list, and is paid for before it sends',
      'A text asks for the message before the date it goes out: purpose, who to reach, message, date, then review and pay',
      'Where the civic panel is on, SMS has a Build your civic panel purpose: the draft introduces you and the panel, and the ask to reply JOIN is always on',
      'Where the civic panel is on, phone banking and door knocking have an Invite to your civic panel purpose: a short script or talking points that introduce you by full name and ask whether they want to join, which is the question you record for each call or door',
      'Picking an event invite for a text, phone banking or door knocking asks for the event date, start time and place first, filled in from your next public meeting when there is one',
      'A text send goes out at 11am local on the date chosen, which must be at least 2 business days ahead and no more than 30 days out',
      'Once a text send’s replies are in, its row in outreach history lists them under Responses and links to What we heard, where the replies are grouped into themes',
    ],
    gate: 'Texting and self-serve polls are being rolled out office by office, so the SMS and Poll / Survey channels are not on every account yet. Both are paid for per message at checkout, with no subscription.',
  },
  {
    navId: 'contacts-dashboard',
    name: 'Constituents',
    path: '/dashboard/contacts',
    modes: ['serve'],
    does: 'Browse the district’s people, filter them, and save lists to use for outreach.',
    inside: [
      'Saved lists live HERE, on the lists index below the district stat card',
      'Create new list is in the top bar of the page',
      'Opening a list shows its filter summary and outreach history, never a table of individual people',
      'Opening a list also shows a map of where its people are',
      'Draw shapes on that map to narrow the list to one or more parts of the district',
      'Each shape has a name and a colour, set on the full-screen map where it is drawn, and the names show under the list’s map',
      'The create-list flow asks for those shapes too, between the filters and the name, and it can be skipped',
      'Shapes can be added, renamed, recoloured, redrawn or deleted until the list has been used for outreach',
      'Where the civic panel is on, a constituent’s record has a Their answers section once they have answered a priority by text, call or door. It lists each priority with their answer (Yes, No, Mixed or No clear answer) and how they answered, and the activity history says which priority a reply was to. The answers are read from what they said by an AI, so they are a first reading, not something they confirmed',
      'A constituent’s record carries an "Asked for follow-up" toggle, and the record’s activity history shows who set it and when',
      'The civic panel, being rolled out so not on every account yet, is the group of residents who said yes to being asked for their views',
      'Where the civic panel is on, a constituent’s record also carries an "On your civic panel" toggle, with the same history. Under it one line says how and when they last joined or left (for example "Joined by text on Oct 2" or "Removed by you on Oct 9") and when your office last asked them, by any text, call or door knock',
      'Where the civic panel is on, Create new list has a Civic panel filter (On your civic panel, Left, or Never invited, meaning nobody ever asked them to join by text, at the door or on a call), How they joined (By text, At the door, On a call, Added by you), When they joined (a From and To date), and Last asked (Not in the last 30 days, or a From and To date for the last time your office reached them). The joined filters only match current members. So the panel, or any part of it, can be saved as a list and sent outreach like any other',
      'Where the civic panel is on, a "Your civic panel" section on this page shows the same 100 seats as the panel’s own page (Who’s on your panel), its members, how many were reached in the last 30 days, and how many can be asked now. With nobody on it yet, Build your civic panel opens the panel’s own page to build it',
      'Where the civic panel is on, "See your panel" in that section opens the panel’s own page, whose "See members" button opens the built-in Civic panel list',
      'Where the civic panel is on, the panel’s own page opens with its milestones: a line for where it stands (for example Halfway there: 120 residents have said yes, and 36 of 42 tracts are keeping pace) and four steps, First yes, 30 members, Halfway and Full panel. Halfway and full follow the panel’s own goal. Once every seat is filled it shows Every seat is filled, with the members, places and how many groups are at their share (the same count as the petals, for example 11 of 11 groups at their share), and Ask your panel a question, which opens Priorities',
      'Where the civic panel is on, Who’s on your panel shows the district as 100 seats split by census tract (by precinct where tract data is missing), filling as people join. A tract’s seats fill only up to its share. From 30 members the tracts falling behind are outlined and listed under Furthest behind; near the goal it shows the empty seats instead, and Every tract has its share of seats filled once all are',
      'Where the civic panel is on, How your panel compares with your district also draws each group (age, gender and, where the data allows, race) as a petal once the panel has 30 members: past the ring is more than its share, short petals are fewer, and each says About its share or a percent of its share, with how many groups are at their share in the middle',
      'Where the civic panel is on, the panel’s own page builds it, and keeps it fresh past its goal. The goal is the members it takes, at about 4 in 10 answering, for every group making up 3% or more of the district (by age, gender, neighborhood and, where the data allows, race) to be expected to answer at least 3 times: 250 members at most, fewer where every group is larger. A group is covered once it has about 8 members. With no plan yet it asks one question, How much time can you give each week? (1, 2, 3, or 4 or more hours a week, an hour picked to start; there is no texts-only option, since your own calls and doors reach the residents a text misses), and Make my plan makes a plan from it. Your plan is one checklist, such as Text 7,817 residents, Call 30 residents and Knock on 100 doors in a walkable area. The next step comes first and larger, with one button (Start the text, Start the calls or Start door knocking) and Skip; other steps not started have Get started, and calls and walks in progress have Keep calling or Keep knocking. Either opens the usual text, phone banking or door knocking flow on that step’s own list of residents, with the Invite to your civic panel purpose picked, at the message, script or talking points, already being drafted; Back still reaches the list and the purpose. Door knocking also opens with the step’s walkable area drawn as the first turf, so you name the campaign and create it without drawing. Done steps are checked at the bottom: a text checks itself once it is sent (Sent Oct 20. Replies come in by Oct 23., later how many joined), and calls and doors check themselves once everyone on the list was reached (Called 30. 2 joined.); you can also tick or untick a call or door step yourself. Skipped steps drop off the list. Beside the plan (below it on a phone), Your time shows your weekly hours with Change, which sizes the next batch (the batch in progress stays as it is), and under it the members, reached in the last 30 days and can be asked now, with See members. Once a batch is done, or its unstarted steps sat for two weeks, the next batch appears, sized to the members still missing',
      "Where the civic panel is on, the panel page also has How your panel compares with your district: one status, Too few members yet under 30 members (We'll compare your panel with your district once 30 people join.), then Missing some groups or Every group on your panel, and while groups are missing one line naming who to invite next, such as Invite more people 65 and over next. That line is the page’s only next step: it names the group the next batch leans toward, and neither the seats nor the petals name another. Once the panel has reached its goal it is also judged on who has answered lately: a member counts as active when they answered a priority’s text, call or door knock in the last 90 days, and every group should keep about 8 active members. The status then reads, for example, Every group on your panel · 3 groups need fresh voices, with Invite more {group} next naming the group with the fewest, and Every group has fresh voices once all have enough. Past the goal the plan, Keep your panel fresh, has no member target: it runs on your weekly hours and invites toward the groups short of active members, and with none short it keeps a light trickle of calls and door knocking at your hours. The Chief of Staff’s Grow your civic panel and the panel card on the home tab say the same, such as 250 members. 3 groups need fresh voices. It checks age, gender, neighborhood and race against the census, and names a race group only when enough members have one on file, such as Invite more Hispanic or Latino residents next. Each new batch leans its invites toward that group: a text step says so (This batch invites more people 18 to 24.), a door step walks a part of the district the panel has not reached (Knock on doors in a part of your district we haven't reached), and calls stop putting landlines first once the panel has its share of people 65 and over. It never shows a weight, a quota or a target, and never shows anyone's race. The Chief of Staff's next step card shows the same status and line",
      'Where the civic panel is on and it has at least one member, Constituent lists has a built-in "Civic panel" row under All constituents with the live member count and when the panel was last reached. Its Details opens the same detail as any other list: a map of where members live (no drawing shapes), their demographics, how they can be reached and outreach history, with a Download. Its outreach history is every text, call or door knock the office sent that reached someone on the panel now, such as the invite, priority asks and report backs. It is always the current members, is never a saved list, and cannot be edited or deleted. It is the panel’s one list: the lists saved for a civic panel invite (a panel plan step’s residents, the first panel text’s draw) stay with the outreach that used them and do not show among Constituent lists',
      'Where the civic panel is on, a constituent’s record can carry What they told us once they have replied by text to a priority: their reply, the issue it raises, where they stand on it and what they want, marked By text, beside what they said at the door or on the phone. The issue is read from their words by an AI, so it is a first reading. What they told us is being rolled out account by account',
      'Where the civic panel is on, a text can ask people to join it with a checkbox, and door knocking and phone banking ask it as their last question, on screen and on the printed sheets',
      'Where the civic panel is on, residents leave it in four ways: replying LEAVE to any text from your office, saying no at the door or on a call when asked whether they want to stay on it, you switching it off on their record, or replying STOP. LEAVE only takes them off the panel and they still get your other texts; STOP also ends every text from your office',
      'Where the civic panel is on, outreach to a list of panel members only offers a way off it instead of asking them to join: a text carries "Reply LEAVE to leave my civic panel." in the message, and door knocking and phone banking ask "Do they want to stay on your civic panel?", where No takes them off',
      'A finished phone banking campaign’s results show how many constituents are still owed a follow-up, and can turn them into a call list or a saved list',
      'Party is not a filter in this product',
    ],
  },
  {
    navId: 'public-profile-dashboard',
    name: 'Public Profile',
    path: '/dashboard/public-profile',
    modes: ['serve'],
    does: 'Edit the public page constituents see, including its own "What I’m working on" and priorities.',
  },
]

// Reached from inside another area rather than from a tab, and shared by both
// products. Declared last so neither product's map opens on it.
const CROSS_PRODUCT_AREAS: ProductArea[] = [
  {
    navId: null,
    name: 'Door knocking',
    path: '/dashboard/door-knocking',
    modes: ['win', 'serve'],
    does: 'GoodParty.org’s own canvassing tool: build a walk list, get turf on a map, and log what happened at each door.',
    inside: [
      'Reached from the Door knocking card on the outreach hub, not from a tab of its own',
      'A campaign can hold several turfs. Mark the whole campaign done, or one turf at a time, from its row in outreach history. Done does not require every door to have been knocked',
      'Creating a campaign ends at drawing the turfs. The walking route is planned the first time somebody starts knocking a turf, which is also when they are asked whether they are walking or driving',
      'Each turf can be handed to a different person, from its card in the campaign’s row in outreach history',
    ],
  },
  {
    navId: null,
    name: 'What we heard',
    path: '/dashboard/issue-capture/[outreachId]',
    modes: ['win', 'serve'],
    does: 'Read what people said on one door knocking turf, phone banking list or, for an elected official, text send, grouped into themes ranked by how many conversations raised them.',
    inside: [
      'Reached from What we heard in outreach history: open a phone banking row, or a door knocking campaign of one turf, at any status. A campaign of several turfs carries it on each turf’s card once somebody there has answered. An elected official’s text send shows it once constituents have replied',
      'On a text send the notes are the replies themselves, listed as each person’s own words with no review step. Themes appear after enough replies, and a theme made of replies shows no Where people stand split',
      'Two counts under the title: how many people answered and how many left a note. A text send says how many replies came from how many people instead',
      'A note is confirmed at the door or on the call: Looks right saves the issues it found, and Skip saves the note with no issues. Either way its words go into the summary',
      'Every note is listed. Themes appear once there are enough confirmed notes, and the page says how many that is',
      'The Summarize notes button groups the confirmed notes into themes. It takes a few minutes, and the page fills in when it is done. Finishing a turf or a call list starts one too, once there are enough confirmed notes',
      'Each theme opens to its details, where people stand, what people want (the most asked first), and the notes behind it',
      'A note is checked and saved where it is taken, at the door or on the call. The page only lists notes: they cannot be edited or deleted there',
      'All notes shows the newest ten, with Show more for the rest. A theme’s own page lists its notes the same way',
      'Each note links to the record of the person it is about, which opens in a side panel without leaving the page',
      'Download, next to All notes, saves every note on the effort as a spreadsheet file, not just the ones listed on the page',
    ],
    gate: 'Being rolled out account by account, so not every account has it yet.',
  },
]

export const PRODUCT_AREAS: ProductArea[] = [
  ...WIN_AREAS,
  ...SERVE_AREAS,
  ...CROSS_PRODUCT_AREAS,
  ...SHARED_AREAS,
]

export const areasForMode = (mode: ProductMode): ProductArea[] =>
  PRODUCT_AREAS.filter((a) => a.modes.includes(mode))

// The area a dashboard URL is on, by the most specific path that holds it.
// Only real routes take part, never an alias (its label never renders), a
// bracketed segment matches any one segment, and the home tab matches only
// exactly, since every page sits under it.
export const areaForPath = (
  mode: ProductMode,
  pathname: string,
): ProductArea | null => {
  const matches = (path: string): boolean => {
    const pattern = new RegExp(
      `^${path.replace(/\[[^/\]]+\]/g, '[^/]+')}${
        path === '/dashboard' ? '' : '(/.*)?'
      }$`,
    )
    return pattern.test(pathname)
  }
  return (
    areasForMode(mode)
      .filter(
        (area) =>
          !area.aliasOf && area.path.startsWith('/') && matches(area.path),
      )
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  )
}

// What chat cannot reach. Every line here is something a user has assumed the
// chat does. Stating them is what keeps the assistant from inventing a reason
// a save "did not go through" and sending someone to check a setting that had
// nothing to do with it.
export const CHAT_LINKAGE: Record<ProductMode, string[]> = {
  win: [
    'The Campaign Story you write with me is saved to Your Story. A campaign and outreach plan does not wait on it: every candidate gets one, and finishing the story is what personalizes it with your own answers.',
    'Your Public Profile is separate. It has its own "Why I’m running" on the Public Profile page, and writing your story here does not change it. If someone wants their story on their public page, say plainly that it has to be entered there and point them at the tab.',
    'Saved lists I create are real, and appear under Voter Data.',
    'I cannot edit the campaign and outreach plan, your public page, your website, your account, or your billing. I also cannot export a list, a script, or a draft to a file.',
  ],
  serve: [
    'Priorities I record are real and appear in the product.',
    'Saved lists I create are real, and appear under Constituents.',
    'I cannot edit your public page, your account, or your billing, and I cannot export anything to a file.',
  ],
}

// The other product, named in one line so an assistant asked about it can
// answer instead of guessing. The office/campaign boundary itself is a
// guardrail, and lives in each prompt.
export const OTHER_PRODUCT: Record<ProductMode, string> = {
  win: 'GoodParty.org has a separate product for people already in office, with a Chief of Staff, meeting briefings, and community issues. A candidate does not have it.',
  serve:
    'GoodParty.org has a separate product for people running for office, with a campaign and outreach plan and voter outreach tools. It is a different account from this one.',
}
