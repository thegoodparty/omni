export const OPEN_UI_FIXTURES: { name: string; program: string }[] = [
  {
    name: 'District dashboard',
    program: [
      'root = Stack([title, stats, table, note])',
      'title = Heading("Your district at a glance")',
      'stats = Stack([residents, voters, turnout], "horizontal")',
      'residents = Stat("Residents", "48,200")',
      'voters = Stat("Registered voters", "31,050", "+4% since 2022")',
      'turnout = Stat("Turnout last election", "38%", null, "Municipal, 2023")',
      'table = Table(["Issue", "Share who rank it first", "Trend"], [["Housing costs", "34%", "Rising"], ["Road repair", "21%", "Flat"], ["Public safety", "17%", "Falling"]])',
      'note = Text("Sample numbers for the playground.", "muted")',
    ].join('\n'),
  },
  {
    name: 'Map',
    program: [
      'root = Stack([map])',
      'map = MapCard("City Hall and the main library", {lat: 40.5860, lng: -105.0810}, 15, [hall, library])',
      'hall = {lat: 40.5853, lng: -105.0844, label: "City Hall"}',
      'library = {lat: 40.5869, lng: -105.0769, label: "Old Town Library"}',
    ].join('\n'),
  },
  {
    name: 'Contact card',
    program: [
      'root = Stack([card, followUp])',
      'card = ContactCard("Jane Rivera", "City Clerk", "City of Fort Collins", "555-0142", "clerk@example.gov", "Handles agenda items and public records requests.")',
      'followUp = ActionButton("Draft an intro email", @ToAssistant("Draft a short intro email to Jane Rivera, the city clerk."))',
    ].join('\n'),
  },
  {
    name: 'Choice questions',
    program: [
      'root = Stack([channels, timing])',
      'channels = ChoiceQuestion("Which outreach channels do you want to use this month?", ["Text messages", "Phone calls", "Door knocking", "Social posts"], true)',
      'timing = ChoiceQuestion("When should it go out?", ["This week", "Next week"])',
    ].join('\n'),
  },
  {
    name: 'Outreach card',
    program: [
      'root = Stack([card])',
      'card = OutreachCard("text", "Seniors near the main library", 1240, "Hi, this is the city council office. Starting June 3 the main library opens at 9am on weekdays. Reply STOP to opt out.", "Start the text")',
    ].join('\n'),
  },
  {
    name: 'Buttons and actions',
    program: [
      'root = Stack([intro, buttons])',
      'intro = Text("Each button fires a different OpenUI action step.")',
      'buttons = Stack([ask, outreach, link], "horizontal", "small")',
      'ask = ActionButton("Summarize my week", @ToAssistant("Summarize my week"))',
      'outreach = ActionButton("Plan door knocking", @StartOutreach("door"))',
      'link = ActionButton("Open goodparty.org", @OpenUrl("https://goodparty.org"))',
    ].join('\n'),
  },
  {
    name: 'Invalid program',
    program: [
      'root = Stack([title, card])',
      'title = Heading()',
      'card = Card("Not in the catalog")',
    ].join('\n'),
  },
]
