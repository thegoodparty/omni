import { Metadata } from 'next'
import UserDetailPage from './components/UserDetailPage'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  // TODO: Replace stubbed data with API call using params.id
  void params // Params will be used when API is connected
  return <UserDetailPage user={stubbedUser} />
}

const stubbedUser = {
  id: 1,
  createdAt: '2023-04-02T05:51:59.450Z',
  updatedAt: '2026-01-29T03:50:12.433Z',
  slug: 'tomer-almog',
  isActive: true,
  isVerified: false,
  isPro: true,
  isDemo: false,
  didWin: true,
  dateVerified: null,
  tier: null,
  formattedAddress: null,
  placeId: null,
  data: {
    id: 1,
    name: 'Tomer Almog',
    slug: 'tomer-almog',
    team: {
      completed: true,
    },
    image: 'https://assets.goodparty.org/candidate-info/g1t9c6ezgl.png',
    launch: {
      'media-0': true,
      'website-0': true,
      'website-1': true,
    },
    social: {
      completed: true,
    },
    finance: {
      ein: true,
      filing: true,
      management: true,
      regulatory: true,
    },
    profile: {
      completed: true,
    },
    aiContent: {
      launchEmail: {
        name: 'Launch Email2',
        content:
          '<div class="text-black">\n    <h3 class="text-3xl font-bold mb-4">Join the Movement for a Better Future!</h3>\n    <p class="mb-4">Dear supporters and fellow citizens,</p>\n\n    <p class="mb-4">I am thrilled to announce that I am running for the position of US Senate as an Independent candidate! After careful consideration and with a burning desire to bring about real change, I am stepping up to represent the values and aspirations of the people.</p>\n\n    <p class="mb-4">My name is Tomer Almog, and as the CTO of Good Party, I have been committed to using technology to solve problems and create a positive impact in our community. Now, I want to take that dedication to a whole new level by serving you in the Senate.</p>\n\n    <p class="mb-4">But politics isn\'t just about policies and legislation; it\'s about connecting with people from all walks of life and understanding their hopes, dreams, and challenges. That\'s why I want to share a little bit about my passion for music, because I believe it reflects the core values and qualities I bring to this campaign.</p>\n\n    <p class="mb-4">I love playing the guitar and writing songs in my free time. I\'ve even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.</p>\n\n    <p class="mb-4">As an Independent candidate, I am not bound by party politics or special interests. My sole focus is on representing your voices and fighting for what\'s right.</p>\n\n    <p class="mb-4">My platform, "Mandate Freedom - Covid Free choice," addresses the crucial issues of our time. I am committed to investigating the vaccination greed and ensuring that your right to make informed choices is protected.</p>\n\n    <p class="mb-4">But running a successful campaign is not possible without your support and involvement. I am reaching out to you today because I need your help to make a real difference in our community.</p>\n\n    <p class="mb-4">Here are a few ways you can get involved:</p>\n\n    <ul class="pl-8 mb-4">\n        <li>Volunteer: Join our team of passionate volunteers who are working tirelessly to spread our message. Every helping hand counts!</li>\n        <li>Donate: Your generous contributions will ensure that we can reach as many voters as possible and make a lasting impact.</li>\n        <li>Spread the Word: Share our campaign on social media, talk to your friends and family, and encourage them to get involved. Together, we can create a movement!</li>\n    </ul>\n\n    <p class="mb-4">Let\'s work together to build a better future for all. Join our movement today and help shape the change we need. Together, we can make our voices heard and create a government that truly represents the people.</p>\n\n    <p class="mb-4">Thank you for your support!</p>\n\n    <p class="mb-4">Sincerely,</p>\n\n    <p>Tomer Almog</p>\n</div>',
        updatedAt: 1697481244693,
        inputValues: {},
      },
      pressRelease: {
        name: 'Press Release',
        content:
          '<div class="text-black">\n    \n<h2 class="text-3xl font-bold mb-6">Tomer Almog Announces Candidacy for Mayor of Los Angeles</h2>\n\n<p>Los Angeles, CA – Today, Tomer Almog, the Chief Technology Officer of the Good Party and an independent candidate, officially announced his bid for the position of Mayor of Los Angeles. With a strong track record of leadership and a commitment to innovation, Almog aims to bring positive change to the city and uplift its diverse communities.</p>\n\n<p>Tomer Almog, a passionate musician and songwriter, understands the power of creativity and perseverance. His love for music has shaped his character, enabling him to bring a fresh perspective to governance and policy-making. Almog\'s dedication to excellence is evident in his professional and personal endeavors, making him a highly qualified candidate for the highest office in Los Angeles.</p>\n\n<p>In a statement, Almog explained his reason for running, "I believe that Los Angeles has immense potential for growth and prosperity. However, to unlock this potential, we need leaders who are willing to take risks and challenge the status quo. I am committed to bringing transparency, accountability, and innovation to City Hall. Together, we can build a brighter future for all Angelenos."</p>\n\n<p>As an independent candidate, Tomer Almog brings a fresh perspective to the political arena, free from partisan constraints. His approach transcends party politics, focusing solely on serving the best interests of the people of Los Angeles. Almog\'s independent status allows him to prioritize the needs of the city above all else, promoting unity and collaboration among stakeholders.</p>\n\n<p>When asked about his vision for the city, Almog stated, "My mandate is clear: freedom of choice when it comes to Covid-19 vaccinations. The people of Los Angeles deserve the right to make informed decisions about their health. Additionally, I am determined to investigate any possible greed surrounding vaccinations to ensure the wellbeing of our community."</p>\n\n<p>Almog\'s opponent, Mike Turner of the Democratic Party, is a career politician who has been mired in corruption allegations. Turner\'s questionable conduct raises serious concerns about his ability to effectively serve the people of Los Angeles. In contrast, Almog presents a stark contrast to the status quo, pledging to bring integrity, honesty, and a fresh vision to City Hall.</p>\n\n<p>Voters in Los Angeles face a critical choice in the upcoming mayoral election. The future of the city hinges on selecting a leader who will prioritize the needs of the people, advocate for transparency, and foster innovation. Tomer Almog\'s candidacy offers the opportunity to instigate positive change and move Los Angeles forward towards a brighter and more inclusive future.</p>\n\n<p>As the campaign progresses, Tomer Almog seeks to engage with the citizens of Los Angeles, understanding their concerns and aspirations firsthand. Through a collaborative approach, Almog aims to foster public participation and ensure that the voices of all communities are heard.</p>\n\n<p>For more information about Tomer Almog\'s campaign for Mayor of Los Angeles, please visit his official campaign website at www.tomeralmogformayor.com.</p>\n\n</div>',
        updatedAt: 1696954554215,
        inputValues: {
          'Additional instructions': '',
          'Subject of Press Release': 'Tomer is Running for Mayor of LA',
        },
      },
      launchSocialMediaCopy: {
        name: 'Launch Social Media Copy',
        content:
          "<p>📢 Exciting News! 📢 I am thrilled to announce my candidacy for the US Senate as an Independent candidate! My name is Tomer Almog and I currently serve as the CTO of Good Party. #TomerForSenate #IndependentCandidate</p><p>👨‍💻 Let me introduce myself: I am a social media and campaign strategist with a passion for music. In my free time, I love playing the guitar and writing songs. Music has taught me creativity, perseverance, and the courage to take risks. I bring the same dedication to my policy proposals. #TomerForSenate #BackgroundInfo</p><p>🏛️ I'm running for the US Senate because I believe in empowering individuals and preserving our freedoms. It's time to push for change and challenge the status quo. I'm not bound by party lines – my focus is solely on bringing fresh ideas to the table. #TomerForSenate #ReasonsForRunning</p><p>🔑 My campaign is centered around two core issues: Mandate Freedom and Covid Free choice. I believe that individuals should have the right to make decisions about their own health and well-being. We must also hold corporations accountable and investigate vaccination greed. #TomerForSenate #CoreIssues</p><p>🗳️ This election is crucial for the future of our country. The stakes are high, and we must elect leaders who genuinely care about the people they represent. I am committed to being a voice for the people, fighting for equality, justice, and a better tomorrow. Join me in this journey. #TomerForSenate #ElectionStakes</p><p><br></p><p>edited by Tomer</p>",
        updatedAt: '2023-10-16',
        inputValues: {},
      },
    },
    hubspotId: '31012600096',
    currentStep: 'onboarding-complete',
    lastVisited: 1769658612427,
    campaignPlan: {
      why: '<div class="px-4 py-2">\n  <h1 class="text-3xl">Why I\'m Running</h1>\n  <h2 class="text-xl my-2">Meet Tomer Almog, Independent/None Candidate for US Senate</h2>\n  <p>As the CTO of the Good Party, I\'ve spent my career fighting for innovation and progress. But beyond my professional experience, I\'m also a musician, writer, and dreamer. I know how to take risks, think outside the box, and stay dedicated to a goal.</p>\n  <h3 class="text-lg mt-4">Mandate Freedom and Free Choice</h3>\n  <p>I believe that every American deserves the right to make their own healthcare decisions without being forced by the government or their employer. That\'s why I\'m dedicated to fighting for mandate freedom and free choice, especially in the midst of the Covid pandemic. We need to trust our citizens to make informed decisions, not force them into one-size-fits-all solutions.</p>\n  <h3 class="text-lg mt-4">Investigating Vaccination Greed</h3>\n  <p>It\'s no secret that big pharmaceutical companies often put profits above people. As a Senator, I will make it my mission to thoroughly investigate vaccine companies and their practices. We need transparency and accountability, not greed.</p>\n  <h3 class="text-lg mt-4">Experience and Dedication</h3>\n  <p>My past experience, which includes dfdf, has given me the skills and knowledge needed to effectively represent my constituents. But more importantly, my passion for making positive change and my willingness to work tirelessly towards that goal make me an ideal candidate. Let\'s work together for a better, brighter future for all of us.</p>\n</div>',
      slogan:
        "<p>Join the Good Fight with Tomer Almog for Senate - We're Independent and Unstoppable!</p>",
      aboutMe:
        '<div class="text-2xl font-bold mb-4">About Me</div>\n\n<div class="mb-4">\n    <p class="font-bold">Name:</p>\n    <p>My name is Tomer Almog. I am running for office in the US Senate as an independent candidate.</p>\n</div>\n\n<div class="mb-4">\n    <p class="font-bold">Occupation:</p>\n    <p>I currently serve as the Chief Technology Officer (CTO) of the Good Party.</p>\n</div>\n\n<div class="mb-4">\n    <p class="font-bold">Fun Fact:</p>\n    <p>In my free time, I enjoy playing the guitar and writing songs. I have even performed at local open mic nights!</p>\n</div>\n\n<div class="mb-4">\n    <p class="font-bold">Experience:</p>\n    <p>My past experience includes [insert relevant experience here].</p>\n</div>\n\n<div class="mb-4">\n    <p class="font-bold">Passion and Enthusiasm:</p>\n    <p>Music has been a passion of mine for as long as I can remember. Playing the guitar and writing songs has taught me about creativity, perseverance, and taking risks. I bring the same level of enthusiasm and dedication to everything that I do, whether it\'s writing a song or crafting a policy proposal.</p>\n</div>\n\n<div class="mb-4">\n    <p class="font-bold">Cares About:</p>\n    <p>I care deeply about Mandate Freedom in regards to Covid and Free Choice. I believe it\'s important to investigate vaccination greed to ensure that everyone has access to safe and effective healthcare options.</p>\n</div>',
      timeline:
        '<div class="bg-gray-200 p-6 rounded-lg shadow-md">\n  <h2 class="text-3xl font-bold mb-4">Tomer Almog US Senate Campaign Timeline</h2>\n  <h3 class="text-xl font-bold mb-2">Election Day: November 23, 2023</h3>\n  \n  <!-- Goal: Win the US Senate seat by a majority vote -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Win the US Senate seat by a majority vote</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Execute a successful get-out-the-vote (GOTV) campaign</li>\n      <li>Win the endorsement of major newspapers and media outlets</li>\n      <li>Earn support from influential politicians, community leaders, and interest groups</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>November 1, 2023: Voter registration deadline</li>\n      <li>November 15, 2023: Deadline for absentee ballots to be received</li>\n      <li>November 22, 2023: Last day to campaign before Election Day</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>October 1, 2023: Participate in US Senate candidate debate sponsored by local news channel</li>\n      <li>November 1-22, 2023: Attend community events, town halls, and debates organized by interest groups</li>\n      <li>November 23, 2023: Election Day - encourage voters to share their voting experience on social media using campaign hashtags</li>\n    </ul>\n  </div>\n  \n  <!-- Goal: Increase name recognition and build support among voters -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Increase name recognition and build support among voters</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Introduce Tomer Almog to voters as an independent candidate with a background in technology and a passion for music and policy</li>\n      <li>Highlight Tomer Almog\'s commitment to Mandate Freedom (Covid) and other key issues</li>\n      <li>Engage with voters through social media, direct mail, phone banking, and door-to-door canvassing</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>August 1, 2023: Deadline for filing candidate paperwork and registering as an independent candidate</li>\n      <li>September 1, 2023: Launch campaign website and social media channels</li>\n      <li>October 15, 2023: Deadline for fundraising and expenditure reports to be filed with the Federal Election Commission (FEC)</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>August 1-31, 2023: Conduct interviews with local news outlets and podcast hosts to introduce Tomer Almog to new audiences</li>\n      <li>September 1-October 1, 2023: Launch social media ad campaign targeting potential voters based on demographics and key issues</li>\n      <li>October 15-31, 2023: Release statement on FEC filing reports, highlighting the campaign\'s fundraising success and plans for expenditure</li>\n    </ul>\n  </div>\n  \n  <!-- Goal: Secure endorsements and build relationships with community leaders -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Secure endorsements and build relationships with community leaders</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Identify influential politicians, interest groups, and community leaders who align with Tomer Almog\'s values and policies</li>\n      <li>Reach out to potential endorsers with personalized letters and meeting requests</li>\n      <li>Attend events and meetings hosted by endorsers to build relationships and show support</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>June 1, 2023: Compile list of potential endorsers and begin outreach</li>\n      <li>October 1, 2023: Deadline for securing major endorsements and announcing them publicly</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>June 1-September 30, 2023: Attend community events and meetings hosted by endorsers and potential endorsers</li>\n      <li>October 1-23, 2023: Publicly announce major endorsements and highlight their significance through social media and press releases</li>\n    </ul>\n  </div>\n  \n  <!-- Goal: Mobilize volunteers and raise funds for the campaign -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Mobilize volunteers and raise funds for the campaign</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Recruit and train volunteers to help with canvassing, phone banking, and data entry</li>\n      <li>Organize fundraising events and launch online fundraising campaigns</li>\n      <li>Ensure compliance with FEC fundraising regulations and report all donations and expenditures</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>May 1, 2023: Hire fundraising director and begin planning fundraising events</li>\n      <li>July 1, 2023: Launch online fundraising campaign</li>\n      <li>October 15, 2023: Deadline for filing fundraising and expenditure reports with the FEC</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>May 1-October 31, 2023: Use social media and email newsletters to update supporters on fundraising progress and volunteer opportunities</li>\n      <li>July 1-October 31, 2023: Host fundraising events and promote them through social media and local news outlets</li>\n      <li>October 15-23, 2023: Release statement on FEC filing reports, highlighting the campaign\'s fundraising success and plans for expenditure</li>\n    </ul>\n  </div>\n</div>',
      messageBox:
        '<div class="border-2 border-black p-4">\n  <h2 class="font-bold text-lg mb-2">What I Will Say About Myself:</h2>\n  <p class="mb-2">Hi, my name is Tomer Almog and I am running for US Senate as an Independent/None candidate. I am a CTO of Good Party and have a passion for music. I believe that my creativity, perseverance, and willingness to take risks are qualities that make me an excellent candidate for this position. I am committed to Mandate Freedom and investigating vaccination greed, and I believe that I can make a positive impact on the future of our country.</p>\n\n  <h2 class="font-bold text-lg mb-2">What I Will Say About My Opponent:</h2>\n  <p class="mb-2">My opponent, Mike Turner, is a politician with a history of corruption. He does not have the best interests of the people at heart and is more concerned with personal gain than the welfare of the nation. I believe that we need to hold our elected officials to a higher standard, and I am committed to doing just that.</p>\n\n  <h2 class="font-bold text-lg mb-2">What My Opponent Will Say About Me:</h2>\n  <p class="mb-2">My opponent may try to paint me as inexperienced and lacking in political knowledge due to the fact that I am not affiliated with a major political party. However, I believe that my background in technology and my passion for making a positive difference in the world make me more than qualified for this position. I am committed to learning all that I can about the political process and to using my skills and expertise to serve the people of our state.</p>\n\n  <h2 class="font-bold text-lg mb-2">What My Opponent Will Say About Themselves:</h2>\n  <p class="mb-2">My opponent will likely try to position themselves as an experienced politician who is well-versed in the intricacies of government. However, I believe that their history of corruption and putting personal gain above the needs of the people belies their true intention. I am committed to running a clean campaign and being completely transparent with the public about my intentions and my qualifications for this position.</p>\n</div>',
      mobilizing:
        'Here\'s a plan to mobilize voters and volunteers for Tomer Almog\'s campaign:\n\n<div class="bg-gray-100 py-6">\n  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">\n    <p class="text-lg font-medium">Join Tomer Almog\'s Campaign</p>\n    <p class="mt-2 text-sm text-gray-500">Help us build a movement for change in the upcoming US Senate election against Mike Turner. Sign up to volunteer today.</p>\n    <div class="mt-4 flex">\n      <a href="#" class="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n        Volunteer Now\n      </a>\n    </div>\n  </div>\n</div>\n\n<div class="bg-white py-6">\n  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">\n    <p class="text-lg font-medium">Get Involved</p>\n    <ul class="mt-4 space-y-4">\n      <li class="text-base">\n        Attend a campaign event or rally\n      </li>\n      <li class="text-base">\n        Share Tomer Almog\'s campaign on social media\n      </li>\n      <li class="text-base">\n        Donate to the campaign\n      </li>\n    </ul>\n    <div class="mt-4 flex">\n      <a href="#" class="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n        View Upcoming Events\n      </a>\n      <a href="#" class="ml-3 inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-indigo-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n        Donate\n      </a>\n    </div>\n  </div>\n</div>\n\n<div class="bg-gray-100 py-6">\n  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">\n    <p class="text-lg font-medium">Sign Up for Updates</p>\n    <p class="mt-2 text-sm text-gray-500">Stay up to date with all of our latest news, events, and initiatives by joining our campaign email list.</p>\n    <div class="mt-4 flex">\n      <form class="flex" action="#" method="post">\n        <input type="hidden" name="list" value="campaign-emails">\n        <input type="hidden" name="action" value="subscribe">\n        <input type="hidden" name="source" value="campaign-website">\n        <label for="email-address" class="sr-only">Email address</label>\n        <input id="email-address" name="email_address" type="email" autocomplete="email" required class="appearance-none rounded-l-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm" placeholder="Enter your email">\n        <button type="submit" class="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-r-none shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n          Sign Up\n        </button>\n      </form>\n    </div>\n  </div>\n</div>\n\nThis plan includes a call to action to volunteer, attend events, share the campaign on social media, and donate. It also provides a sign-up form for campaign updates. These elements are designed to engage voters and supporters and build a grassroots movement for Tomer Almog\'s campaign.',
      getOutTheVote:
        '<h1 class="text-3xl font-bold mb-4">Get Out the Vote Tactics for Tomer Almog</h1>\n<div class="mb-4">\n  <h2 class="text-xl font-bold mb-2">1. Digital Outreach</h2>\n  <p>Use social media platforms to connect with voters and raise awareness about Tomer Almog\'s campaign. Post regular updates, share videos, photos and personal stories to keep supporters engaged and motivated. Use targeted ads to reach potential supporters based on location, interests and demographics.</p>\n</div>\n<div class="mb-4">\n  <h2 class="text-xl font-bold mb-2">2. Volunteer Drives</h2>\n  <p>Organize a team of volunteers to help spread the word about Tomer Almog\'s campaign. Encourage them to reach out to their networks and personal connections to encourage voter turnout. Make sure to provide training and resources to ensure that every volunteer is knowledgeable about the candidate\'s platform and can effectively communicate it to voters.</p>\n</div>\n<div class="mb-4">\n  <h2 class="text-xl font-bold mb-2">3. Yard Signs and Billboards</h2>\n  <p>Use effective political signage such as attractive yard signs, billboards to capture the attention of voters, and raise awareness about Tomer Almog\'s campaign. Ensure the signs are available to all volunteers and supporters who wish to donate their lawn or windows.</p>\n</div>\n<div>\n  <h2 class="text-xl font-bold mb-2">4. Door-to-Door Canvassing</h2>\n  <p>Knock on doors and participate in phone banking. Use a script to highlight Tomer Almog\'s policies while explaining the importance of the upcoming election. Remember to wear personal protective equipment and practice proper social distancing etiquette during the Covid pandemic.</p>\n</div>',
      pathToVictory:
        '<h1 class="text-4xl font-bold mb-4">Path to Victory for Tomer Almog in the 2023 US Senate Election</h1>\n<p class="mb-4">As Tomer Almog\'s political assistant, I have created a path to victory that leverages his strengths and appeals to the voters of his state.</p>\n\n<h2 class="text-2xl font-bold mb-2">1. Emphasize Tomer Almog\'s independence</h2>\n<p class="mb-4">As a member of the Independent/None party, Tomer Almog is uniquely positioned to appeal to voters dissatisfied with the two major political parties. We will highlight his independence from political gridlock and partisan bickering.</p>\n\n<h2 class="text-2xl font-bold mb-2">2. Highlight Tomer Almog\'s experience as the CTO of Good Party</h2>\n<p class="mb-4">Tomer Almog\'s experience as the Chief Technology Officer of the Good Party demonstrates his ability to lead and innovate. We will leverage this experience to showcase his skills as a problem solver and thought leader.</p>\n\n<h2 class="text-2xl font-bold mb-2">3. Leverage Tomer Almog\'s love of music to connect with voters</h2>\n<p class="mb-4">Tomer Almog\'s passion for music can be used to connect with voters on a personal level. We will showcase his musical talents and emphasize how they translate to his political career, such as his creativity, perseverance, and willingness to take risks.</p>\n\n<h2 class="text-2xl font-bold mb-2">4. Position Tomer Almog as a candidate who cares about Mandate Freedom (Covid) undefined</h2>\n<p class="mb-4">Given the ongoing COVID-19 pandemic, Tomer Almog\'s platform on Mandate Freedom provides a unique opportunity to differentiate himself from his opponent, Mike Turner. We will emphasize that Tomer Almog cares about people’s freedom to make their own choices in regards to the mandates put against them. Tomer’s attention to this critical issue will attract many voters.</p>\n\n<h2 class="text-2xl font-bold mb-2">5. Highlight the corruption allegations against Mike Turner</h2>\n<p class="mb-4">Mike Turner\'s alleged corruption can be used to position Tomer Almog as the candidate of integrity. We will leverage negative advertisements that expose Mike\'s corrupt activities to position Tomer as an honest candidate, and win over voters who are tired of the status quo corrupt politicians.</p>\n\n<h2 class="text-2xl font-bold mb-2">Conclusion</h2>\n<p class="mb-4">Tomer Almog has what it takes to win the 2023 US Senate Election. With a focus on his independence, experience, and passion for music, combined with his strong stance on Mandate Freedom (Covid) undefined, and the known corruption attributes of his opponent, Mike Turner; Tomer Almog has the right combination of platform and character to appeal to voters and secure the Senate seat. </p>',
      policyPlatform:
        '1.\n\n<div class="my-4">\n<h3 class="font-bold text-xl mb-2 text-center">Why I\'m Running for US Senate</h3>\n<p class="text-gray-700 text-base">My name is Tomer Almog, and I am running for US Senate as an Independent candidate. As the CTO of Good Party, I have spent my career leveraging technology and data to solve complex problems, and I believe that these skills are sorely needed in government today. I am running for office because I believe that we need to transform the way that our government operates, making it more transparent, efficient, and accountable to the American people.</p>\n<p class="text-gray-700 text-base">As a Senator, I would work to:</p>\n<ul class="list-disc pl-8">\n<li class="text-gray-700 text-base">Promote government transparency and accountability through the use of technology and data</li>\n<li class="text-gray-700 text-base">Ensure that everyone has access to quality healthcare, regardless of their income or background</li>\n<li class="text-gray-700 text-base">Protect the environment and promote sustainable development through innovative policies</li>\n</ul>\n</div>\n    \n2.\n\n<div class="my-4">\n<h3 class="font-bold text-xl mb-2 text-center">Why I\'m Running for US Senate</h3>\n<p class="text-gray-700 text-base">I\'m Tomer Almog, and I\'m running for US Senate as an Independent candidate because I believe that we need to take bold action to address the challenges that face our country today. As the CTO of Good Party, I have seen firsthand the power of innovation and creativity in solving complex problems. I believe that we need to bring these same qualities to our government if we want to build a more prosperous, more equitable, and more sustainable future for all Americans.</p>\n<p class="text-gray-700 text-base">If elected to the Senate, I would work to:</p>\n<ul class="list-disc pl-8">\n<li class="text-gray-700 text-base">Ensure that every American has access to affordable healthcare and a basic standard of living</li>\n<li class="text-gray-700 text-base">Protect our planet and promote sustainable development through a comprehensive climate change agenda</li>\n<li class="text-gray-700 text-base">End corruption and special interests in politics by promoting government transparency and accountability</li>\n</ul>\n</div>\n\n3.\n\n<div class="my-4">\n<h3 class="font-bold text-xl mb-2 text-center">Why I\'m Running for US Senate</h3>\n<p class="text-gray-700 text-base">I\'m Tomer Almog, and I\'m running for US Senate because I believe that our government is broken, and we need a new generation of leaders who are willing to stand up, speak out, and fight for what\'s right. As an Independent candidate and the CTO of Good Party, I know what it takes to drive change, and I am ready to bring fresh ideas, innovation, and a commitment to serving the public to Washington, DC.</p>\n<p class="text-gray-700 text-base">As a Senator, I would work to:</p>\n<ul class="list-disc pl-8">\n<li class="text-gray-700 text-base">Strengthen our democracy by promoting voting rights, ending gerrymandering, and reducing the role of money in politics</li>\n<li class="text-gray-700 text-base">Ensure that everyone has access to quality healthcare and affordable education</li>\n<li class="text-gray-700 text-base">Promote innovation and entrepreneurship while protecting workers\' rights and improving working conditions</li>\n</ul>\n</div>',
      operationalPlan:
        '<h2 class="font-bold text-xl mb-4">Operational Plan for Tomer Almog\'s US Senate Campaign</h2>\n<div class="mb-6">\n  <h3 class="font-bold text-lg mb-2">Budget</h3>\n  <p class="leading-7">Our campaign budget is set at $2.5 million, with the following breakdown:</p>\n  <ul class="list-disc list-inside leading-7">\n    <li>Advertising: $1.2 million</li>\n    <li>Staff salaries and benefits: $800,000</li>\n    <li>Events and travel: $300,000</li>\n    <li>Technology and software: $100,000</li>\n    <li>Miscellaneous expenses: $100,000</li>\n  </ul>\n</div>\n\n<div class="mb-6">\n  <h3 class="font-bold text-lg mb-2">Staffing Structure</h3>\n  <p class="leading-7">Our campaign will be staffed by a team of talented individuals who will each bring their own unique skills and expertise to the table. The following positions will be filled:</p>\n  <ul class="list-disc list-inside leading-7">\n    <li>Campaign Manager</li>\n    <li>Communications Director</li>\n    <li>Fundraising Director</li>\n    <li>Field Director</li>\n    <li>Digital Director</li>\n    <li>Volunteer Coordinator</li>\n    <li>Policy Advisor</li>\n    <li>Regional Field Organizers (4)</li>\n  </ul>\n  <p class="leading-7">We will also rely heavily on volunteers to help us spread our message and engage with voters. Our goal will be to recruit at least 500 volunteers by Election Day.</p>\n</div>\n\n<div class="mb-6">\n  <h3 class="font-bold text-lg mb-2">Campaign Strategy</h3>\n  <p class="leading-7">Our campaign strategy will focus on the following key areas:</p>\n  <ul class="list-disc list-inside leading-7">\n    <li>Building a strong presence in the digital space through social media, targeted email campaigns, and digital advertising</li>\n    <li>Engaging directly with voters through town halls, meet-and-greets, and other in-person events</li>\n    <li>Running a robust field program that will target voters in key regions across the state</li>\n    <li>Partnering with local organizations to build a broad coalition of supporters</li>\n    <li>Running a comprehensive fundraising campaign that will allow us to compete with our opponents</li>\n  </ul>\n</div>\n\n<p class="leading-7">With these strategies in place and a dedicated team to execute them, we believe that we can win this race and represent the interests of the people of our state in the US Senate.</p>',
      communicationsStrategy:
        '<div class="bg-gray-100 py-8">\n  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">\n    <div class="lg:text-center">\n      <h2 class="text-3xl leading-8 font-extrabold tracking-tight text-gray-900 sm:text-4xl">\n        Meet Tomer Almog.\n      </h2>\n      <p class="mt-2 text-base leading-6 text-gray-600 font-bold">\n        Candidate for US Senate as an Independent/None\n      </p>\n      <p class="mt-2 text-base leading-6 text-gray-600 font-bold">\n        Election date: 2023-11-23\n      </p>\n      <p class="mt-2 text-base leading-6 text-gray-600 font-bold">\n        Running against: <span class="text-red-500 font-bold">Mike Turner</span>, member of the Democrat Party and a known corrupt politician\n      </p>\n    </div>\n\n    <div class="mt-10 sm:flex sm:justify-center">\n      <div class="rounded-md shadow">\n        <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-white bg-red-500 hover:bg-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n          Donate to Tomer\'s Campaign\n        </a>\n      </div>\n      <div class="mt-3 sm:mt-0 sm:ml-3">\n        <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-red-500 bg-white hover:text-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n          Volunteer for Tomer\'s Campaign\n        </a>\n      </div>\n    </div>\n\n    <div class="mt-10">\n\n      <div class="sm:flex sm:justify-center">\n        <div class="mt-10 sm:mt-0 sm:ml-3">\n          <div class="max-w-4xl mx-auto">\n            <div class="md:flex lg:items-center">\n              <div class="md:flex-shrink-0">\n                <img class="rounded-lg md:w-56" src="/images/tomer-almog.jpg" alt="Tomer Almog">\n              </div>\n              <div class="mt-4 md:mt-0 md:ml-6">\n                <div class="uppercase tracking-wide text-sm text-red-500 font-semibold">About Tomer Almog</div>\n                <p class="mt-2 text-gray-600 leading-relaxed">\n                  Tomer Almog is the CTO of Good Party and a passionate musician. He believes that his love for music has helped him develop creativity, perseverance, and the willingness to take risks – qualities that he brings to everything he does, from writing songs to crafting policy proposals. Tomer cares deeply about Mandate Freedom in the wake of COVID-19 and is running as an Independent/None candidate for US Senate.\n                </p>\n                <div class="mt-4">\n                  <p class="text-gray-600 font-bold">Tomer Almog\'s past experience: dfdf</p>\n                </div>\n              </div>\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <div class="text-center mt-10">\n        <p class="text-lg leading-8 font-medium text-gray-900">\n          Join Tomer Almog\'s Campaign Today!\n        </p>\n        <div class="mt-3 sm:flex sm:justify-center">\n          <div class="rounded-md shadow">\n            <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-white bg-red-500 hover:bg-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n              Donate to Tomer\'s Campaign\n            </a>\n          </div>\n          <div class="mt-3 sm:mt-0 sm:ml-3">\n            <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-red-500 bg-white hover:text-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n              Volunteer for Tomer\'s Campaign\n            </a>\n          </div>\n        </div>\n      </div>\n\n    </div>\n\n  </div>\n</div>',
    },
    hasVoterFile: 'completed',
    lastStepDate: '2024-04-03',
    launchStatus: 'launched',
    pathToVictory: {
      indies: 2838,
      democrats: 4530,
      winNumber: '3046.00',
      republicans: 2614,
      electionType: 'Unified_School_District',
      averageTurnout: 6086,
      electionLocation: 'OAK PARK USD',
      projectedTurnout: 6090,
      voterContactGoal: '15230.00',
      totalRegisteredVoters: 9982,
    },
    hubSpotUpdates: {
      p2p_sent: '0',
      date_verified: '1744848000000',
      p2p_campaigns: '0',
      pro_candidate: 'Yes',
      verified_candidates: 'No',
    },
    customVoterFiles: [
      {
        name: 'Door Knocking  - GOTV - May 6, 2025',
        channel: 'Door Knocking',
        filters: [
          'audience_likelyVoters',
          'audience_unreliableVoters',
          'audience_firstTimeVoters',
          'party_independent',
          'age_18_25',
          'age_25_35',
          'age_35_50',
        ],
        purpose: 'GOTV',
        createdAt: 'Tue May 06 2025',
      },
      {
        name: 'Door Knocking  - GOTV - May 6, 2025',
        channel: 'Door Knocking',
        filters: [
          'audience_likelyVoters',
          'audience_unreliableVoters',
          'audience_firstTimeVoters',
          'party_independent',
          'age_18_25',
          'age_25_35',
          'age_35_50',
        ],
        purpose: 'GOTV',
        createdAt: 'Tue May 06 2025',
      },
      {
        name: 'Direct Mail  - GOTV - Sep 29, 2025',
        channel: 'Direct Mail',
        filters: [
          'audience_likelyVoters',
          'audience_unreliableVoters',
          'audience_firstTimeVoters',
          'party_independent',
          'age_18_25',
          'age_25_35',
          'age_35_50',
        ],
        purpose: 'GOTV',
        createdAt: 'Mon Sep 29 2025',
      },
    ],
    textCampaignCount: 2,
    campaignPlanStatus: {
      why: {
        status: 'completed',
        createdAt: 2678400000,
      },
      slogan: {
        status: 'completed',
        createdAt: 2678400000,
      },
      aboutMe: {
        status: 'completed',
        createdAt: 2678400000,
      },
      timeline: {
        status: 'completed',
        createdAt: 2678400000,
      },
      messageBox: {
        status: 'completed',
        createdAt: 2678400000,
      },
      mobilizing: {
        status: 'completed',
        createdAt: 2678400000,
      },
      launchEmail: {
        status: 'completed',
        createdAt: 1697481224619,
      },
      pressRelease: {
        status: 'completed',
        createdAt: 1696954532654,
      },
      getOutTheVote: {
        status: 'completed',
        createdAt: 2678400000,
      },
      pathToVictory: {
        status: 'completed',
        createdAt: 2678400000,
      },
      policyPlatform: {
        status: 'completed',
        createdAt: 2678400000,
      },
      doorKnockScript: {
        status: 'failed',
        createdAt: 1697481241410,
      },
      operationalPlan: {
        status: 'completed',
        createdAt: 2678400000,
      },
      launchSocialMediaCopy: {
        status: 'completed',
        createdAt: 1697481192591,
      },
      communicationsStrategy: {
        status: 'completed',
        createdAt: 2678400000,
      },
    },
    reportedVoterGoals: {
      text: 2028,
      calls: 148,
      events: 200,
      digital: 0,
      robocall: 900,
      digitalAds: 0,
      directMail: 4,
      socialMedia: 600,
      doorKnocking: 1293,
      phoneBanking: 700,
    },
    path_to_victory_status: 'Complete',
  },
  details: {
    dob: '1978-04-24',
    zip: '53212',
    city: 'Los Angeles',
    tier: 3,
    level: 'city',
    party: 'Independent',
    phone: '13109759102',
    state: 'NC',
    county: 'Los Angeles',
    office: 'Other',
    raceId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb25FbGVjdGlvbi8yNzcxNjc4',
    citizen: 'yes',
    funFact:
      "I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.",
    knowRun: 'yes',
    pledged: true,
    website: 'https://tomeralmog.com',
    articles: '',
    lastName: 'Almog',
    firstName: 'Tomer',
    runBefore: 'no',
    topIssues: {
      positions: [
        {
          id: 157,
          name: 'Mandate Freedom',
          topIssue: {
            id: 25,
            name: 'Covid',
            createdAt: 1649219354821,
            updatedAt: 1649219354821,
          },
          createdAt: 1649226095142,
          updatedAt: 1649226095142,
        },
        {
          id: 351,
          name: 'Defending the rights of individuals and groups to peacefully assemble and protest within the boundaries of the law',
          topIssue: {
            id: 70,
            name: ' Free Speech',
            createdAt: 1684863812527,
            updatedAt: 1684863812527,
          },
          createdAt: 1684863859149,
          updatedAt: 1684863859149,
        },
      ],
      'position-157': 'Free choice. Investigate the vaccination greed',
      'position-351': 'dsds',
    },
    electionId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvRWxlY3Rpb24vNTk5NA==',
    hasPrimary: true,
    occupation: 'former CTO of Good Party.',
    otherParty: '',
    positionId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMzMzMzgy',
    ballotLevel: 'CITY',
    geoLocation: {
      lat: 34.26968,
      lng: -118.78339,
      geoHash: '9q5dcn8e',
    },
    noCommittee: false,
    otherOffice: 'Hendersonville City Mayor',
    customIssues: [
      {
        title: 'custom issue',
        position: 'whatever',
      },
    ],
    electionDate: '2026-11-03',
    partisanType: 'nonpartisan',
    runForOffice: 'no',
    campaignPhone: '2076894316',
    filedStatement: 'no',
    pastExperience: 'dfdf',
    runningAgainst: [
      {
        name: 'Mike Turner',
        party: 'Democrat Party',
        description: 'Mike turner is a corrupt politician',
      },
    ],
    campaignWebsite: '',
    officeRunBefore: '',
    filingPeriodsEnd: '2026-07-17',
    officeTermLength: '4 years',
    campaignCommittee: '',
    filingPeriodsStart: '2026-07-03',
    priorElectionDates: [],
  },
  aiContent: {
    why: {
      name: 'Why',
      content:
        '<div>\n  <h3>Personal Credentials:</h3>\n  <p><b><i>Tomer Almog</i></b>, currently serving as the CTO of Good Party, has a robust background in technology and innovation. When not working, I immerse myself in music, writing songs, and performing at local open mic nights. My passion for music has fostered creativity, perseverance, and a willingness to take risks, qualities I bring to every aspect of my life, including policy-making.</p>\n  \n  <br /><br />\n  \n  <h3>Motivation for Running:</h3>\n  <p>I am running for the Oak Park Unified School Board because I believe in the transformative power of accessible and inclusive education. My goal is to ensure that every student and community member feels heard and valued, regardless of language barriers or age. Public service is a natural extension of my commitment to community and innovation.</p>\n  \n  <br /><br />\n  \n  <h3>Vision and Goals:</h3>\n  <p>My vision is a school district where every public meeting is accessible to non-English speakers, ensuring all voices are heard. Additionally, I am dedicated to combating elder abuse through enhanced senior services. I aim to foster economic development that benefits our entire community, ensuring a prosperous future for Oak Park.</p>\n  \n  <br /><br />\n  \n  <h3>Differentiating Factors: Standing Apart in the Race</h3>\n  <p>As an Independent<br/><br/>on-partisan candidate, I am uniquely positioned to bring a fresh perspective to the Oak Park Unified School Board. My background in technology, combined with my passion for music, equips me with a creative and innovative approach to problem-solving. My commitment to accessibility, inclusivity, and senior services sets me apart as a candidate dedicated to serving all facets of our community.</p>\n</div>',
      updatedAt: 1724383529023,
    },
    slogan: {
      content:
        "<p>Join the Good Fight with Tomer Almog for Senate - We're Independent and Unstoppable!</p>",
    },
    aboutMe: {
      name: 'About Me',
      content:
        "<div>\n\n<h3>About Me</h3>\n\n<p>My name is <b>Tomer Almog</b>, and I am honored to be a candidate for the <b>Oak Park Unified School Board</b>. As the dedicated CTO of <b>Good Party</b> and an <b>Independent / non-partisan</b> advocate, my mission is to foster a more inclusive and accessible community for everyone.</p>\n\n<br /><br />\n\n<h3>Issue #1: Accessibility and Inclusivity in Public Meetings</h3>\n\n<p>One of my core focuses is <b>ensuring language access for non-English speakers</b>. I firmly believe that every community member deserves to have their voice heard and understood. By implementing comprehensive language support services in public meetings, we can foster a more inclusive environment where all residents feel valued and represented.</p>\n\n<br /><br />\n\n<h3>Issue #2: Aging and Senior Services</h3>\n\n<p>Another critical issue is <b>combating elder abuse</b>. Our seniors deserve to live in dignity and safety, free from exploitation and harm. I am committed to advocating for stronger protective measures and support systems to ensure our elderly population receives the respect and care they deserve.</p>\n\n<br /><br />\n\n<h3>Economic Development</h3>\n\n<p>Economic development is essential for the growth and prosperity of our community. My career, enriched by <b>dfdf</b>, has provided me with the insights and strategies needed to promote sustainable economic initiatives that benefit all residents.</p>\n\n<br /><br />\n\n<h3>Personal Interests</h3>\n\n<p>On a more personal note, I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.</p>\n\n<br /><br />\n\n<p>Thank you for considering my candidacy. I am committed to serving our community with passion and integrity, and I look forward to the opportunity to make a positive impact on Oak Park Unified School Board.</p>\n\n</div>",
      updatedAt: 1724385032655,
    },
    timeline: {
      content:
        '<div class="bg-gray-200 p-6 rounded-lg shadow-md">\n  <h2 class="text-3xl font-bold mb-4">Tomer Almog US Senate Campaign Timeline</h2>\n  <h3 class="text-xl font-bold mb-2">Election Day: November 23, 2023</h3>\n  \n  <!-- Goal: Win the US Senate seat by a majority vote -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Win the US Senate seat by a majority vote</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Execute a successful get-out-the-vote (GOTV) campaign</li>\n      <li>Win the endorsement of major newspapers and media outlets</li>\n      <li>Earn support from influential politicians, community leaders, and interest groups</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>November 1, 2023: Voter registration deadline</li>\n      <li>November 15, 2023: Deadline for absentee ballots to be received</li>\n      <li>November 22, 2023: Last day to campaign before Election Day</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>October 1, 2023: Participate in US Senate candidate debate sponsored by local news channel</li>\n      <li>November 1-22, 2023: Attend community events, town halls, and debates organized by interest groups</li>\n      <li>November 23, 2023: Election Day - encourage voters to share their voting experience on social media using campaign hashtags</li>\n    </ul>\n  </div>\n  \n  <!-- Goal: Increase name recognition and build support among voters -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Increase name recognition and build support among voters</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Introduce Tomer Almog to voters as an independent candidate with a background in technology and a passion for music and policy</li>\n      <li>Highlight Tomer Almog\'s commitment to Mandate Freedom (Covid) and other key issues</li>\n      <li>Engage with voters through social media, direct mail, phone banking, and door-to-door canvassing</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>August 1, 2023: Deadline for filing candidate paperwork and registering as an independent candidate</li>\n      <li>September 1, 2023: Launch campaign website and social media channels</li>\n      <li>October 15, 2023: Deadline for fundraising and expenditure reports to be filed with the Federal Election Commission (FEC)</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>August 1-31, 2023: Conduct interviews with local news outlets and podcast hosts to introduce Tomer Almog to new audiences</li>\n      <li>September 1-October 1, 2023: Launch social media ad campaign targeting potential voters based on demographics and key issues</li>\n      <li>October 15-31, 2023: Release statement on FEC filing reports, highlighting the campaign\'s fundraising success and plans for expenditure</li>\n    </ul>\n  </div>\n  \n  <!-- Goal: Secure endorsements and build relationships with community leaders -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Secure endorsements and build relationships with community leaders</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Identify influential politicians, interest groups, and community leaders who align with Tomer Almog\'s values and policies</li>\n      <li>Reach out to potential endorsers with personalized letters and meeting requests</li>\n      <li>Attend events and meetings hosted by endorsers to build relationships and show support</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>June 1, 2023: Compile list of potential endorsers and begin outreach</li>\n      <li>October 1, 2023: Deadline for securing major endorsements and announcing them publicly</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>June 1-September 30, 2023: Attend community events and meetings hosted by endorsers and potential endorsers</li>\n      <li>October 1-23, 2023: Publicly announce major endorsements and highlight their significance through social media and press releases</li>\n    </ul>\n  </div>\n  \n  <!-- Goal: Mobilize volunteers and raise funds for the campaign -->\n  <div class="mb-4">\n    <h4 class="text-lg font-bold mb-2">Goal: Mobilize volunteers and raise funds for the campaign</h4>\n    <ul class="list-disc list-inside mb-2">\n      <li>Recruit and train volunteers to help with canvassing, phone banking, and data entry</li>\n      <li>Organize fundraising events and launch online fundraising campaigns</li>\n      <li>Ensure compliance with FEC fundraising regulations and report all donations and expenditures</li>\n    </ul>\n    <p class="mb-2">Key Deadlines:</p>\n    <ul class="list-disc list-inside">\n      <li>May 1, 2023: Hire fundraising director and begin planning fundraising events</li>\n      <li>July 1, 2023: Launch online fundraising campaign</li>\n      <li>October 15, 2023: Deadline for filing fundraising and expenditure reports with the FEC</li>\n    </ul>\n    <p class="mb-2">Communication Opportunities/Earned Media:</p>\n    <ul class="list-disc list-inside">\n      <li>May 1-October 31, 2023: Use social media and email newsletters to update supporters on fundraising progress and volunteer opportunities</li>\n      <li>July 1-October 31, 2023: Host fundraising events and promote them through social media and local news outlets</li>\n      <li>October 15-23, 2023: Release statement on FEC filing reports, highlighting the campaign\'s fundraising success and plans for expenditure</li>\n    </ul>\n  </div>\n</div>',
    },
    messageBox: {
      content:
        '<div class="border-2 border-black p-4">\n  <h2 class="font-bold text-lg mb-2">What I Will Say About Myself:</h2>\n  <p class="mb-2">Hi, my name is Tomer Almog and I am running for US Senate as an Independent/None candidate. I am a CTO of Good Party and have a passion for music. I believe that my creativity, perseverance, and willingness to take risks are qualities that make me an excellent candidate for this position. I am committed to Mandate Freedom and investigating vaccination greed, and I believe that I can make a positive impact on the future of our country.</p>\n\n  <h2 class="font-bold text-lg mb-2">What I Will Say About My Opponent:</h2>\n  <p class="mb-2">My opponent, Mike Turner, is a politician with a history of corruption. He does not have the best interests of the people at heart and is more concerned with personal gain than the welfare of the nation. I believe that we need to hold our elected officials to a higher standard, and I am committed to doing just that.</p>\n\n  <h2 class="font-bold text-lg mb-2">What My Opponent Will Say About Me:</h2>\n  <p class="mb-2">My opponent may try to paint me as inexperienced and lacking in political knowledge due to the fact that I am not affiliated with a major political party. However, I believe that my background in technology and my passion for making a positive difference in the world make me more than qualified for this position. I am committed to learning all that I can about the political process and to using my skills and expertise to serve the people of our state.</p>\n\n  <h2 class="font-bold text-lg mb-2">What My Opponent Will Say About Themselves:</h2>\n  <p class="mb-2">My opponent will likely try to position themselves as an experienced politician who is well-versed in the intricacies of government. However, I believe that their history of corruption and putting personal gain above the needs of the people belies their true intention. I am committed to running a clean campaign and being completely transparent with the public about my intentions and my qualifications for this position.</p>\n</div>',
    },
    mobilizing: {
      content:
        'Here\'s a plan to mobilize voters and volunteers for Tomer Almog\'s campaign:\n\n<div class="bg-gray-100 py-6">\n  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">\n    <p class="text-lg font-medium">Join Tomer Almog\'s Campaign</p>\n    <p class="mt-2 text-sm text-gray-500">Help us build a movement for change in the upcoming US Senate election against Mike Turner. Sign up to volunteer today.</p>\n    <div class="mt-4 flex">\n      <a href="#" class="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n        Volunteer Now\n      </a>\n    </div>\n  </div>\n</div>\n\n<div class="bg-white py-6">\n  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">\n    <p class="text-lg font-medium">Get Involved</p>\n    <ul class="mt-4 space-y-4">\n      <li class="text-base">\n        Attend a campaign event or rally\n      </li>\n      <li class="text-base">\n        Share Tomer Almog\'s campaign on social media\n      </li>\n      <li class="text-base">\n        Donate to the campaign\n      </li>\n    </ul>\n    <div class="mt-4 flex">\n      <a href="#" class="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n        View Upcoming Events\n      </a>\n      <a href="#" class="ml-3 inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-indigo-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n        Donate\n      </a>\n    </div>\n  </div>\n</div>\n\n<div class="bg-gray-100 py-6">\n  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">\n    <p class="text-lg font-medium">Sign Up for Updates</p>\n    <p class="mt-2 text-sm text-gray-500">Stay up to date with all of our latest news, events, and initiatives by joining our campaign email list.</p>\n    <div class="mt-4 flex">\n      <form class="flex" action="#" method="post">\n        <input type="hidden" name="list" value="campaign-emails">\n        <input type="hidden" name="action" value="subscribe">\n        <input type="hidden" name="source" value="campaign-website">\n        <label for="email-address" class="sr-only">Email address</label>\n        <input id="email-address" name="email_address" type="email" autocomplete="email" required class="appearance-none rounded-l-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm" placeholder="Enter your email">\n        <button type="submit" class="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-r-none shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">\n          Sign Up\n        </button>\n      </form>\n    </div>\n  </div>\n</div>\n\nThis plan includes a call to action to volunteer, attend events, share the campaign on social media, and donate. It also provides a sign-up form for campaign updates. These elements are designed to engage voters and supporters and build a grassroots movement for Tomer Almog\'s campaign.',
    },
    launchEmail: {
      name: 'Launch Email2',
      content:
        '<div class="text-black">\n    <h3 class="text-3xl font-bold mb-4">Join the Movement for a Better Future!</h3>\n    <p class="mb-4">Dear supporters and fellow citizens,</p>\n\n    <p class="mb-4">I am thrilled to announce that I am running for the position of US Senate as an Independent candidate! After careful consideration and with a burning desire to bring about real change, I am stepping up to represent the values and aspirations of the people.</p>\n\n    <p class="mb-4">My name is Tomer Almog, and as the CTO of Good Party, I have been committed to using technology to solve problems and create a positive impact in our community. Now, I want to take that dedication to a whole new level by serving you in the Senate.</p>\n\n    <p class="mb-4">But politics isn\'t just about policies and legislation; it\'s about connecting with people from all walks of life and understanding their hopes, dreams, and challenges. That\'s why I want to share a little bit about my passion for music, because I believe it reflects the core values and qualities I bring to this campaign.</p>\n\n    <p class="mb-4">I love playing the guitar and writing songs in my free time. I\'ve even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.</p>\n\n    <p class="mb-4">As an Independent candidate, I am not bound by party politics or special interests. My sole focus is on representing your voices and fighting for what\'s right.</p>\n\n    <p class="mb-4">My platform, "Mandate Freedom - Covid Free choice," addresses the crucial issues of our time. I am committed to investigating the vaccination greed and ensuring that your right to make informed choices is protected.</p>\n\n    <p class="mb-4">But running a successful campaign is not possible without your support and involvement. I am reaching out to you today because I need your help to make a real difference in our community.</p>\n\n    <p class="mb-4">Here are a few ways you can get involved:</p>\n\n    <ul class="pl-8 mb-4">\n        <li>Volunteer: Join our team of passionate volunteers who are working tirelessly to spread our message. Every helping hand counts!</li>\n        <li>Donate: Your generous contributions will ensure that we can reach as many voters as possible and make a lasting impact.</li>\n        <li>Spread the Word: Share our campaign on social media, talk to your friends and family, and encourage them to get involved. Together, we can create a movement!</li>\n    </ul>\n\n    <p class="mb-4">Let\'s work together to build a better future for all. Join our movement today and help shape the change we need. Together, we can make our voices heard and create a government that truly represents the people.</p>\n\n    <p class="mb-4">Thank you for your support!</p>\n\n    <p class="mb-4">Sincerely,</p>\n\n    <p>Tomer Almog</p>\n</div>',
      updatedAt: 1697481244693,
      inputValues: {},
    },
    pressRelease: {
      name: 'Press Release',
      content:
        '<div class="text-black">\n    \n<h2 class="text-3xl font-bold mb-6">Tomer Almog Announces Candidacy for Mayor of Los Angeles</h2>\n\n<p>Los Angeles, CA – Today, Tomer Almog, the Chief Technology Officer of the Good Party and an independent candidate, officially announced his bid for the position of Mayor of Los Angeles. With a strong track record of leadership and a commitment to innovation, Almog aims to bring positive change to the city and uplift its diverse communities.</p>\n\n<p>Tomer Almog, a passionate musician and songwriter, understands the power of creativity and perseverance. His love for music has shaped his character, enabling him to bring a fresh perspective to governance and policy-making. Almog\'s dedication to excellence is evident in his professional and personal endeavors, making him a highly qualified candidate for the highest office in Los Angeles.</p>\n\n<p>In a statement, Almog explained his reason for running, "I believe that Los Angeles has immense potential for growth and prosperity. However, to unlock this potential, we need leaders who are willing to take risks and challenge the status quo. I am committed to bringing transparency, accountability, and innovation to City Hall. Together, we can build a brighter future for all Angelenos."</p>\n\n<p>As an independent candidate, Tomer Almog brings a fresh perspective to the political arena, free from partisan constraints. His approach transcends party politics, focusing solely on serving the best interests of the people of Los Angeles. Almog\'s independent status allows him to prioritize the needs of the city above all else, promoting unity and collaboration among stakeholders.</p>\n\n<p>When asked about his vision for the city, Almog stated, "My mandate is clear: freedom of choice when it comes to Covid-19 vaccinations. The people of Los Angeles deserve the right to make informed decisions about their health. Additionally, I am determined to investigate any possible greed surrounding vaccinations to ensure the wellbeing of our community."</p>\n\n<p>Almog\'s opponent, Mike Turner of the Democratic Party, is a career politician who has been mired in corruption allegations. Turner\'s questionable conduct raises serious concerns about his ability to effectively serve the people of Los Angeles. In contrast, Almog presents a stark contrast to the status quo, pledging to bring integrity, honesty, and a fresh vision to City Hall.</p>\n\n<p>Voters in Los Angeles face a critical choice in the upcoming mayoral election. The future of the city hinges on selecting a leader who will prioritize the needs of the people, advocate for transparency, and foster innovation. Tomer Almog\'s candidacy offers the opportunity to instigate positive change and move Los Angeles forward towards a brighter and more inclusive future.</p>\n\n<p>As the campaign progresses, Tomer Almog seeks to engage with the citizens of Los Angeles, understanding their concerns and aspirations firsthand. Through a collaborative approach, Almog aims to foster public participation and ensure that the voices of all communities are heard.</p>\n\n<p>For more information about Tomer Almog\'s campaign for Mayor of Los Angeles, please visit his official campaign website at www.tomeralmogformayor.com.</p>\n\n</div>',
      updatedAt: 1696954554215,
      inputValues: {
        'Additional instructions': '',
        'Subject of Press Release': 'Tomer is Running for Mayor of LA',
      },
    },
    getOutTheVote: {
      content:
        '<h1 class="text-3xl font-bold mb-4">Get Out the Vote Tactics for Tomer Almog</h1>\n<div class="mb-4">\n  <h2 class="text-xl font-bold mb-2">1. Digital Outreach</h2>\n  <p>Use social media platforms to connect with voters and raise awareness about Tomer Almog\'s campaign. Post regular updates, share videos, photos and personal stories to keep supporters engaged and motivated. Use targeted ads to reach potential supporters based on location, interests and demographics.</p>\n</div>\n<div class="mb-4">\n  <h2 class="text-xl font-bold mb-2">2. Volunteer Drives</h2>\n  <p>Organize a team of volunteers to help spread the word about Tomer Almog\'s campaign. Encourage them to reach out to their networks and personal connections to encourage voter turnout. Make sure to provide training and resources to ensure that every volunteer is knowledgeable about the candidate\'s platform and can effectively communicate it to voters.</p>\n</div>\n<div class="mb-4">\n  <h2 class="text-xl font-bold mb-2">3. Yard Signs and Billboards</h2>\n  <p>Use effective political signage such as attractive yard signs, billboards to capture the attention of voters, and raise awareness about Tomer Almog\'s campaign. Ensure the signs are available to all volunteers and supporters who wish to donate their lawn or windows.</p>\n</div>\n<div>\n  <h2 class="text-xl font-bold mb-2">4. Door-to-Door Canvassing</h2>\n  <p>Knock on doors and participate in phone banking. Use a script to highlight Tomer Almog\'s policies while explaining the importance of the upcoming election. Remember to wear personal protective equipment and practice proper social distancing etiquette during the Covid pandemic.</p>\n</div>',
    },
    pathToVictory: {
      content:
        '<h1 class="text-4xl font-bold mb-4">Path to Victory for Tomer Almog in the 2023 US Senate Election</h1>\n<p class="mb-4">As Tomer Almog\'s political assistant, I have created a path to victory that leverages his strengths and appeals to the voters of his state.</p>\n\n<h2 class="text-2xl font-bold mb-2">1. Emphasize Tomer Almog\'s independence</h2>\n<p class="mb-4">As a member of the Independent/None party, Tomer Almog is uniquely positioned to appeal to voters dissatisfied with the two major political parties. We will highlight his independence from political gridlock and partisan bickering.</p>\n\n<h2 class="text-2xl font-bold mb-2">2. Highlight Tomer Almog\'s experience as the CTO of Good Party</h2>\n<p class="mb-4">Tomer Almog\'s experience as the Chief Technology Officer of the Good Party demonstrates his ability to lead and innovate. We will leverage this experience to showcase his skills as a problem solver and thought leader.</p>\n\n<h2 class="text-2xl font-bold mb-2">3. Leverage Tomer Almog\'s love of music to connect with voters</h2>\n<p class="mb-4">Tomer Almog\'s passion for music can be used to connect with voters on a personal level. We will showcase his musical talents and emphasize how they translate to his political career, such as his creativity, perseverance, and willingness to take risks.</p>\n\n<h2 class="text-2xl font-bold mb-2">4. Position Tomer Almog as a candidate who cares about Mandate Freedom (Covid) undefined</h2>\n<p class="mb-4">Given the ongoing COVID-19 pandemic, Tomer Almog\'s platform on Mandate Freedom provides a unique opportunity to differentiate himself from his opponent, Mike Turner. We will emphasize that Tomer Almog cares about people’s freedom to make their own choices in regards to the mandates put against them. Tomer’s attention to this critical issue will attract many voters.</p>\n\n<h2 class="text-2xl font-bold mb-2">5. Highlight the corruption allegations against Mike Turner</h2>\n<p class="mb-4">Mike Turner\'s alleged corruption can be used to position Tomer Almog as the candidate of integrity. We will leverage negative advertisements that expose Mike\'s corrupt activities to position Tomer as an honest candidate, and win over voters who are tired of the status quo corrupt politicians.</p>\n\n<h2 class="text-2xl font-bold mb-2">Conclusion</h2>\n<p class="mb-4">Tomer Almog has what it takes to win the 2023 US Senate Election. With a focus on his independence, experience, and passion for music, combined with his strong stance on Mandate Freedom (Covid) undefined, and the known corruption attributes of his opponent, Mike Turner; Tomer Almog has the right combination of platform and character to appeal to voters and secure the Senate seat. </p>',
    },
    policyPlatform: {
      content:
        '1.\n\n<div class="my-4">\n<h3 class="font-bold text-xl mb-2 text-center">Why I\'m Running for US Senate</h3>\n<p class="text-gray-700 text-base">My name is Tomer Almog, and I am running for US Senate as an Independent candidate. As the CTO of Good Party, I have spent my career leveraging technology and data to solve complex problems, and I believe that these skills are sorely needed in government today. I am running for office because I believe that we need to transform the way that our government operates, making it more transparent, efficient, and accountable to the American people.</p>\n<p class="text-gray-700 text-base">As a Senator, I would work to:</p>\n<ul class="list-disc pl-8">\n<li class="text-gray-700 text-base">Promote government transparency and accountability through the use of technology and data</li>\n<li class="text-gray-700 text-base">Ensure that everyone has access to quality healthcare, regardless of their income or background</li>\n<li class="text-gray-700 text-base">Protect the environment and promote sustainable development through innovative policies</li>\n</ul>\n</div>\n    \n2.\n\n<div class="my-4">\n<h3 class="font-bold text-xl mb-2 text-center">Why I\'m Running for US Senate</h3>\n<p class="text-gray-700 text-base">I\'m Tomer Almog, and I\'m running for US Senate as an Independent candidate because I believe that we need to take bold action to address the challenges that face our country today. As the CTO of Good Party, I have seen firsthand the power of innovation and creativity in solving complex problems. I believe that we need to bring these same qualities to our government if we want to build a more prosperous, more equitable, and more sustainable future for all Americans.</p>\n<p class="text-gray-700 text-base">If elected to the Senate, I would work to:</p>\n<ul class="list-disc pl-8">\n<li class="text-gray-700 text-base">Ensure that every American has access to affordable healthcare and a basic standard of living</li>\n<li class="text-gray-700 text-base">Protect our planet and promote sustainable development through a comprehensive climate change agenda</li>\n<li class="text-gray-700 text-base">End corruption and special interests in politics by promoting government transparency and accountability</li>\n</ul>\n</div>\n\n3.\n\n<div class="my-4">\n<h3 class="font-bold text-xl mb-2 text-center">Why I\'m Running for US Senate</h3>\n<p class="text-gray-700 text-base">I\'m Tomer Almog, and I\'m running for US Senate because I believe that our government is broken, and we need a new generation of leaders who are willing to stand up, speak out, and fight for what\'s right. As an Independent candidate and the CTO of Good Party, I know what it takes to drive change, and I am ready to bring fresh ideas, innovation, and a commitment to serving the public to Washington, DC.</p>\n<p class="text-gray-700 text-base">As a Senator, I would work to:</p>\n<ul class="list-disc pl-8">\n<li class="text-gray-700 text-base">Strengthen our democracy by promoting voting rights, ending gerrymandering, and reducing the role of money in politics</li>\n<li class="text-gray-700 text-base">Ensure that everyone has access to quality healthcare and affordable education</li>\n<li class="text-gray-700 text-base">Promote innovation and entrepreneurship while protecting workers\' rights and improving working conditions</li>\n</ul>\n</div>',
    },
    operationalPlan: {
      content:
        '<h2 class="font-bold text-xl mb-4">Operational Plan for Tomer Almog\'s US Senate Campaign</h2>\n<div class="mb-6">\n  <h3 class="font-bold text-lg mb-2">Budget</h3>\n  <p class="leading-7">Our campaign budget is set at $2.5 million, with the following breakdown:</p>\n  <ul class="list-disc list-inside leading-7">\n    <li>Advertising: $1.2 million</li>\n    <li>Staff salaries and benefits: $800,000</li>\n    <li>Events and travel: $300,000</li>\n    <li>Technology and software: $100,000</li>\n    <li>Miscellaneous expenses: $100,000</li>\n  </ul>\n</div>\n\n<div class="mb-6">\n  <h3 class="font-bold text-lg mb-2">Staffing Structure</h3>\n  <p class="leading-7">Our campaign will be staffed by a team of talented individuals who will each bring their own unique skills and expertise to the table. The following positions will be filled:</p>\n  <ul class="list-disc list-inside leading-7">\n    <li>Campaign Manager</li>\n    <li>Communications Director</li>\n    <li>Fundraising Director</li>\n    <li>Field Director</li>\n    <li>Digital Director</li>\n    <li>Volunteer Coordinator</li>\n    <li>Policy Advisor</li>\n    <li>Regional Field Organizers (4)</li>\n  </ul>\n  <p class="leading-7">We will also rely heavily on volunteers to help us spread our message and engage with voters. Our goal will be to recruit at least 500 volunteers by Election Day.</p>\n</div>\n\n<div class="mb-6">\n  <h3 class="font-bold text-lg mb-2">Campaign Strategy</h3>\n  <p class="leading-7">Our campaign strategy will focus on the following key areas:</p>\n  <ul class="list-disc list-inside leading-7">\n    <li>Building a strong presence in the digital space through social media, targeted email campaigns, and digital advertising</li>\n    <li>Engaging directly with voters through town halls, meet-and-greets, and other in-person events</li>\n    <li>Running a robust field program that will target voters in key regions across the state</li>\n    <li>Partnering with local organizations to build a broad coalition of supporters</li>\n    <li>Running a comprehensive fundraising campaign that will allow us to compete with our opponents</li>\n  </ul>\n</div>\n\n<p class="leading-7">With these strategies in place and a dedicated team to execute them, we believe that we can win this race and represent the interests of the people of our state in the US Senate.</p>',
    },
    candidateWebsite: {
      name: 'Candidate Website',
      content:
        'Hello! How can I assist you today? If you have any questions or need information on a specific topic, feel free to ask.',
      updatedAt: 1716475117944,
      inputValues: {},
    },
    fundraisingEmail: {
      name: 'Fundraising Email',
      content:
        "<div>\n<h3>Introduction</h3>\n<p>We are reaching out to you, our valued supporters, to help us achieve a crucial milestone in <b>Tomer Almog</b>'s campaign for <i>Los Angeles City Mayor</i>. As an <i>Independent / non-partisan</i> candidate and <b>CTO of Good Party</b>, Tomer is committed to bringing about positive change to our community. With your help, we can make this vision a reality.</p>\n<br />\n<br />\n\n<h3>Body</h3>\n<p>The funds we raise will be used to support Tomer's campaign initiatives, including <i>Accessibility and inclusivity in public meetings</i>, <b>Aging and Senior Services</b>, and <i>Economic Development</i>. Specifically, we will allocate resources to ensure <b>language access for non-English speakers</b>, develop <i>housing and community centers</i> for seniors, and drive economic growth through innovative strategies. Your contribution will bring us closer to achieving these goals and creating a better future for our city.</p>\n<br />\n<br />\n\n<h3>Conclusion</h3>\n<p>We have an ambitious goal to raise <b>$20,000 within one week</b>, and we cannot do it without your support. We urge you to <i>donate generously</i> to help us reach this milestone. Every contribution, big or small, counts, and will bring us closer to making Tomer's vision for Los Angeles a reality. <b>Donate now</b> and help us create a brighter future for our city. Thank you for your continued support.</p>\n</div>",
      updatedAt: 1741900033978,
      inputValues: {
        Length: '200-300 words',
        'Desired Outcome': 'Desired Outcome * Raise $20,000 within one week',
        'Target Audience': 'Previous donors ',
        'Additional instructions': '',
      },
    },
    generationStatus: {
      why: {
        prompt:
          "Write a \"Why I'm Running\" statement in 200 words or less using the following information. \n\nThe candidate is named Tomer Almog and running for office of Oak Park Unified School Board as a member of the Independent / non-partisan party. Tomer Almog's occupation is a CTO of Good Party. Fun fact about Tomer Almog: I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.. Tomer Almog's past experience includes dfdf. Tomer Almog cares deeply about Issue #1: Accessibility and inclusivity in public meetings. Position on the issue: Ensuring language access for non-English speakers. Candidate's position: abc. Issue #2: Aging and Senior Services. Position on the issue: Combat elder abuse. Candidate's position: whatever. Economic Development - dd,.\n\nThe order and format of your response should be as follows:\n1. Personal Credentials:\n2. Motivation for running:\n3. Vision and Goals:\n4. Differentiating Factors: Standing Apart in the Race\n\nPlease format the output using bold and italic where appropriate. Use 2 line breaks between sections. Use H3 tags for headings. Use two \"<br />\" tags between each section for readability. The output should look professional. Do NOT format the text using markdown or tailwind classes. Use html elements only such as <p> <br /> <b> <i>. Respond in html code wrapped in div element. Use HTML code only to style the response. don't change any background colors.\n\n        \n      ",
        status: 'completed',
        createdAt: 1724383522929,
        existingChat: [],
      },
      slogan: {
        status: 'completed',
        createdAt: 2678400000,
      },
      aboutMe: {
        prompt:
          "Draft a first-person 'About Me' statement, within 300 words, encapsulating my journey as a candidate named Tomer Almog for Oak Park Unified School Board. As a dedicated CTO of Good Party and a member of Independent / non-partisan, my focus lies on Issue #1: Accessibility and inclusivity in public meetings. Position on the issue: Ensuring language access for non-English speakers. Candidate's position: abc. Issue #2: Aging and Senior Services. Position on the issue: Combat elder abuse. Candidate's position: whatever. Economic Development - dd,. My career, enriched by dfdf, has deeply informed my approach to these issues. A fun and personal aspect of my life is I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do., which reflects my personality and commitment to our community's betterment.\n\nPlease format the output using bold and italic where appropriate. Use 2 line breaks between sections. Use H3 tags for headings. Use two \"<br />\" tags between each section for readability. The output should look professional. Do NOT format the text using markdown or tailwind classes. Use html elements only such as <p> <br /> <b> <i>. Respond in html code wrapped in div element. Use HTML code only to style the response. don't change any background colors.\n\n        \n      ",
        status: 'completed',
        createdAt: 1724385027261,
        existingChat: [],
      },
      timeline: {
        status: 'completed',
        createdAt: 2678400000,
      },
      messageBox: {
        status: 'completed',
        createdAt: 2678400000,
      },
      mobilizing: {
        status: 'completed',
        createdAt: 2678400000,
      },
      launchEmail: {
        status: 'completed',
        createdAt: 1697481224619,
      },
      pressRelease: {
        status: 'completed',
        createdAt: 1696954532654,
      },
      getOutTheVote: {
        status: 'completed',
        createdAt: 2678400000,
      },
      pathToVictory: {
        status: 'completed',
        createdAt: 2678400000,
      },
      policyPlatform: {
        status: 'completed',
        createdAt: 2678400000,
      },
      doorKnockScript: {
        status: 'failed',
        createdAt: 1697481241410,
      },
      operationalPlan: {
        status: 'completed',
        createdAt: 2678400000,
      },
      candidateWebsite: {
        prompt: '',
        status: 'completed',
        createdAt: 1716475116184,
        inputValues: {},
        existingChat: [],
      },
      fundraisingEmail: {
        prompt:
          "What We Want to Create\nDraft a compelling email to raise money for the following political candidate. The email should have a structured format. Introduction, Body (usage of funds), Conclusion (CTA)\n\nBackground Information:\n- Candidate's Details: `Tomer Almog`, `Los Angeles City Mayor`, `Independent / non-partisan`, `CTO of Good Party`, `I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.`, `dfdf`, `Issue #1: Accessibility and inclusivity in public meetings. Position on the issue: Ensuring language access for non-English speakers. Candidate's position: abc. Issue #2: Aging and Senior Services. Position on the issue: Housing and community centers . Candidate's position: whatever. Economic Development - dd,`\n\nPlease format the output using bold and italic. Use 2 line breaks between sections. Use H3 tags for headings. Use two \"<br />\" tags between each section for readability. The output should look professional. Do NOT format the text using markdown or tailwind classes. Use html elements only such as <p> <br /> <b> <i>. Respond in html code wrapped in div element. Use HTML code only to style the response. don't change any background colors. If I provide you updated text in future chat messages please preserve any text I altered and preserve the formatting I give you.\n\n        \n      ",
        status: 'completed',
        createdAt: 1741900027879,
        inputValues: {
          Length: '200-300 words',
          'Desired Outcome': 'Desired Outcome * Raise $20,000 within one week',
          'Target Audience': 'Previous donors ',
          'Additional instructions': '',
        },
        existingChat: [
          {
            role: 'user',
            content:
              'additional info:\nDesired Outcome: Desired Outcome * Raise $20,000 within one week\nTarget Audience: Previous donors \nLength: 200-300 words\n',
          },
        ],
      },
      smsGetOutTheVote: {
        prompt:
          "Objective: Craft engaging, conversational SMS messages for Tomer Almog's Get Out The Vote campaign. These messages aim to introduce Tomer Almog, their candidacy for Oak Park Unified School Board, and concisely summarize key policy positions to encourage voter participation, using text-based formatting cues using HTML for enhanced readability. Make sure the text is black and there no header\n\nInstructions for ChatGPT:\n\nPersonalized Greeting: Begin each message with a personalized greeting. Indicate emphasis by noting to use bold for the recipient's name (this will be conceptual, as actual bolding cannot be applied).\n\nCandidate Introduction: Introduce Tomer Almog and their run for Oak Park Unified School Board, simplifying Issue #1: Accessibility and inclusivity in public meetings. Position on the issue: Ensuring language access for non-English speakers. Candidate's position: abc. Issue #2: Aging and Senior Services. Position on the issue: Combat elder abuse. Candidate's position: whatever. Economic Development - dd,  into [[simplifiedPositions]]. Suggest using italics for key themes or priorities (again, conceptual).\n\nInteractive Elements: Encourage interaction by including questions or calls to action. Highlight these actions by suggesting the use of bold for phrases like 'reply more for info' or 'text vote to support'.\n\nVoting Information: Clearly provide voting details, underlining the ease and importance of voting. Key dates or actions should be noted as bold (conceptually).\n\nCompliance Note: Each message should conclude with a compliance note, presented in a less prominent style, such as (small text) to indicate it should be visually deemphasized.\n\nVisual Breaks: Since line breaks or <br> tags cannot be used, indicate separations in content with a line stating \"Insert line break here\" to conceptualize where breaks would enhance readability.\n\nText-Based Structure Example:\n\n\"Hi [[first_name]]! I'm Tomer Almog, running for Oak Park Unified School Board. My key priorities include [[simplifiedPositions]]. Your vote is powerful! Reply 'more' to learn about my vision. 🌟 Insert line break here.\"\n\n\"Voting is simpler than you think and vital for our future. Can I count on your support for Oak Park Unified School Board? Text 'vote' for details on how to participate. Let's make history together! Insert line break here.\"\n\n\"Thank you, [[first_name]], for engaging with our campaign. Every vote counts. For more information or to find out where to vote, reply 'info'. Together, we can achieve [[simplifiedPositions]]. - Tomer Almog Insert line break here.\"\n\n\"Remember, 2024-11-05 is coming up fast. Ensure your voice is heard! For voting locations, reply 'where'. Insert line break here.\"\n\n\"Messages funded by unknown. To stop receiving messages, reply 'stop'.\"\n\nMaintain a conversational tone, using clear, direct language to foster engagement.\nEnsure compliance with campaign communication regulations by including a mandatory compliance statement in each message.\n\n\n        \n      ",
        status: 'completed',
        createdAt: 1717025426595,
        inputValues: {},
        existingChat: [],
      },
      candidateWebsite2: {
        prompt: '',
        status: 'completed',
        createdAt: 1716479381510,
        inputValues: {},
        existingChat: [],
      },
      smsGetOutTheVote2: {
        prompt:
          "Objective: Craft engaging, conversational SMS messages for Tomer Almog's Get Out The Vote campaign. These messages aim to introduce Tomer Almog, their candidacy for Oak Park Unified School Board, and concisely summarize key policy positions to encourage voter participation, using text-based formatting cues using HTML for enhanced readability. Make sure the text is black and there no header\n\nInstructions for ChatGPT:\n\nPersonalized Greeting: Begin each message with a personalized greeting. Indicate emphasis by noting to use bold for the recipient's name (this will be conceptual, as actual bolding cannot be applied).\n\nCandidate Introduction: Introduce Tomer Almog and their run for Oak Park Unified School Board, simplifying Issue #1: Accessibility and inclusivity in public meetings. Position on the issue: Ensuring language access for non-English speakers. Candidate's position: abc. Issue #2: Aging and Senior Services. Position on the issue: Combat elder abuse. Candidate's position: whatever. Economic Development - dd,  into [[simplifiedPositions]]. Suggest using italics for key themes or priorities (again, conceptual).\n\nInteractive Elements: Encourage interaction by including questions or calls to action. Highlight these actions by suggesting the use of bold for phrases like 'reply more for info' or 'text vote to support'.\n\nVoting Information: Clearly provide voting details, underlining the ease and importance of voting. Key dates or actions should be noted as bold (conceptually).\n\nCompliance Note: Each message should conclude with a compliance note, presented in a less prominent style, such as (small text) to indicate it should be visually deemphasized.\n\nVisual Breaks: Since line breaks or <br> tags cannot be used, indicate separations in content with a line stating \"Insert line break here\" to conceptualize where breaks would enhance readability.\n\nText-Based Structure Example:\n\n\"Hi [[first_name]]! I'm Tomer Almog, running for Oak Park Unified School Board. My key priorities include [[simplifiedPositions]]. Your vote is powerful! Reply 'more' to learn about my vision. 🌟 Insert line break here.\"\n\n\"Voting is simpler than you think and vital for our future. Can I count on your support for Oak Park Unified School Board? Text 'vote' for details on how to participate. Let's make history together! Insert line break here.\"\n\n\"Thank you, [[first_name]], for engaging with our campaign. Every vote counts. For more information or to find out where to vote, reply 'info'. Together, we can achieve [[simplifiedPositions]]. - Tomer Almog Insert line break here.\"\n\n\"Remember, 2024-11-05 is coming up fast. Ensure your voice is heard! For voting locations, reply 'where'. Insert line break here.\"\n\n\"Messages funded by unknown. To stop receiving messages, reply 'stop'.\"\n\nMaintain a conversational tone, using clear, direct language to foster engagement.\nEnsure compliance with campaign communication regulations by including a mandatory compliance statement in each message.\n\n\n        \n      ",
        status: 'completed',
        createdAt: 1717029056404,
        inputValues: {},
        existingChat: [],
      },
      smsGetOutTheVote3: {
        prompt:
          "##Goal:\nYour goal is to craft a GOTV SMS for an independent political campaign. You’ll be given some information about the candidate to work into the SMS, as illustrated by the examples below. Use only plain text and newlines; you will be penalized for including any additional formatting.\n\n##Input:\nName: John Doe\nOffice: Brookside County Commission - District 5\nPast experience: Lived in Brookside County for over 25 years\nPositions: Attracting and retaining businesses, safeguarding private property rights, investing in road repairs and maintenance\nSimplified positions: Focus on business development, property rights, and road improvements\nCampaign committee: John Doe 4 Brookside County Commission\n\n##Output:\nHi, this is John Doe and I'm running for Brookside County Commission - District 5. I've lived in Brookside county for over 25 years and I am dedicated to making our community better by focusing on key issues in our community.\n</br></br>My priorities include:\n</br>- Attracting and retaining businesses for more development\n</br>- Safeguarding private property rights\n</br>- Investing in road repairs and maintenance to address poor conditions\n</br></br>Can I count on your support in this election for Brookside County Commission?\n</br></br>Reply stop to opt out\n</br></br>Paid for by John Doe 4 Brookside County Commission\n\n##Input:\nName: Aurora Simmons\nOffice: City Council, Ward 2\nPositions: Repair streets and bridges, improve drainage systems, boost law enforcement presence for safer communities\nSimplified positions: Focus on infrastructure and public safety improvements\nElection date: 10/1\nCampaign Committee: Aurora Simmons for City Council\n\n##Output:\nGood Afternoon Ward 2!\n</br></br>Let's make a change together. I'm Aurora Simmons, and I'm ready to bring a can-do attitude to City Council, Ward. Together, we can:\n</br>- Repair our streets and bridges\n</br>- Improve drainage systems\n</br>- Boost law enforcement presence for safer communities\n</br></br>Ward 2 deserves a leader who's accountable, accessible, and committed to real results. Let's build a stronger future—starting on October 1st. Vote Aurora Simmons for City Council, Ward 2. Your vote is your voice. Let's be heard!\n</br></br>Can I count on your support on Tuesday, October 1st?\n</br></br>Reply Stop to Opt Out.\n</br></br>Paid for by Aurora Simmons for City Council\n\n\n##Input:\nName: Tomer Almog\nOffice: Los Angeles City Mayor\nPast experience: dfdf\nIssues: [[simplifiedPositions]]\nFun fact: I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.\nElection date: 2026-11-03\nCampaign committee: unknown\n\n##Output:\n\n\n        \n      ",
        status: 'completed',
        createdAt: 1741901472608,
        inputValues: {},
        existingChat: [],
      },
      smsGetOutTheVote4: {
        prompt:
          "##Goal:\nYour goal is to craft a GOTV SMS for an independent political campaign. You’ll be given some information about the candidate to work into the SMS, as illustrated by the examples below. Use only plain text and newlines; you will be penalized for including any additional formatting.\n\n##Input:\nName: John Doe\nOffice: Brookside County Commission - District 5\nPast experience: Lived in Brookside County for over 25 years\nPositions: Attracting and retaining businesses, safeguarding private property rights, investing in road repairs and maintenance\nSimplified positions: Focus on business development, property rights, and road improvements\nCampaign committee: John Doe 4 Brookside County Commission\n\n##Output:\nHi, this is John Doe and I'm running for Brookside County Commission - District 5. I've lived in Brookside county for over 25 years and I am dedicated to making our community better by focusing on key issues in our community.\n</br></br>My priorities include:\n</br>- Attracting and retaining businesses for more development\n</br>- Safeguarding private property rights\n</br>- Investing in road repairs and maintenance to address poor conditions\n</br></br>Can I count on your support in this election for Brookside County Commission?\n</br></br>Reply stop to opt out\n</br></br>Paid for by John Doe 4 Brookside County Commission\n\n##Input:\nName: Aurora Simmons\nOffice: City Council, Ward 2\nPositions: Repair streets and bridges, improve drainage systems, boost law enforcement presence for safer communities\nSimplified positions: Focus on infrastructure and public safety improvements\nElection date: 10/1\nCampaign Committee: Aurora Simmons for City Council\n\n##Output:\nGood Afternoon Ward 2!\n</br></br>Let's make a change together. I'm Aurora Simmons, and I'm ready to bring a can-do attitude to City Council, Ward. Together, we can:\n</br>- Repair our streets and bridges\n</br>- Improve drainage systems\n</br>- Boost law enforcement presence for safer communities\n</br></br>Ward 2 deserves a leader who's accountable, accessible, and committed to real results. Let's build a stronger future—starting on October 1st. Vote Aurora Simmons for City Council, Ward 2. Your vote is your voice. Let's be heard!\n</br></br>Can I count on your support on Tuesday, October 1st?\n</br></br>Reply Stop to Opt Out.\n</br></br>Paid for by Aurora Simmons for City Council\n\n\n##Input:\nName: Tomer Almog\nOffice: Los Angeles City Mayor\nPast experience: dfdf\nIssues: [[simplifiedPositions]]\nFun fact: I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.\nElection date: 2026-11-03\nCampaign committee: unknown\n\n##Output:\n\n\n        \n      ",
        status: 'completed',
        createdAt: 1741901751408,
        inputValues: {},
        existingChat: [],
      },
      betaSmsElectionDay: {
        prompt:
          "##Goal:\nYour goal is to craft an election day SMS for an independent political campaign. You’ll be given some information about the candidate to work into the SMS, as illustrated by the examples below. Use only plain text and newlines; you will be penalized for including any additional formatting. The message should be personalizable with the tools you have, so it should start with a greeting and placeholder for the recipient’s first name to be added to.\n\n##Input:\nName: Sarah Thompson\nOffice: Fairfax City Council\nOccupation: Local entrepreneur and current City School Board Member\nPast experience: School Board Member\nIssues: Excellence in education, environmental conservation, safety, public service\nFun Fact: I’m a dedicated mom.\nElection Date: 11/5\nCampaign Committee: Sarah for Fairfax\n\n##Output:\nHi [[first_name]]!\nElection Day is here in Fairfax, and it is critical that we all vote in our local races today! I'm Sarah Thompson and running for Fairfax City Council. As a dedicated mom, local small business owner, and your current City School Board Member, I’ve worked tirelessly to improve our community through collaboration and action.\nMy vision for Fairfax City focuses on excellence in education, environmental conservation, and safety. With my diverse background and commitment to public service, I aim to create a prosperous, inclusive, and secure community for all. I'm dedicated to listening, learning, and leading with compassion, and I look forward to working together with residents to build and maintain the Fairfax City we all deserve.\nAs a mom, I understand the importance of building a better future for our families. If you share this vision for a better Fairfax, I ask for your vote today, 11/5, so that we can make this vision a reality.\nReply stop to opt-out. Paid for by Sarah for Fairfax\n\n##Input:\nName: Lisa Johnson\nOffice: Franklin County Tax Collector\nPast experience: 18 years of experience approving a substantial budget\nIssues: Customer service, problem-solving, and leadership skills\nCampaign Committee: Lisa Johnson for Franklin County Tax Collector\n\n##Output:\nHello Franklin County!\nLisa Johnson is the right choice for Franklin County Tax Collector. Let Lisa's 18 years of extensive professional background in approving a substantial budget, work for you. Lisa is an accomplished leader known for her exceptional customer service and problem-solving skills.\nLisa stands ready to serve as your next Tax Collector. Remember you get MORE with JOHNSON.\nCan I count on your support today?\nReply Stop to Opt Out\nPolitical advertisement paid for and approved by Lisa Johnson, NPA for Franklin County Tax Collector\n\n\n##Input:\nName: Tomer Almog\nOffice: Oak Park Unified School Board\nPast experience: dfdf\nIssues: [[simplifiedPositions]]\nFun fact: I love playing the guitar and writing songs in my free time. I've even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.\nElection date: 2024-11-05\nCampaign committee: unknown\n\n##Output:\n\n        \n      ",
        status: 'completed',
        createdAt: 1729095696687,
        inputValues: {},
        existingChat: [],
      },
      launchSocialMediaCopy: {
        status: 'completed',
        createdAt: 1697481192591,
      },
      communicationsStrategy: {
        status: 'completed',
        createdAt: 2678400000,
      },
      socialPostCommonQuestions: {
        prompt:
          '##Goal: \nYour goal is to craft a social media post for an independent political candidate answering common questions their voters have. You’ll be given some information about the candidate to work into the post, as illustrated by the examples below. \n\nTo make the script easy to read, make sure to format the output by writing in paragraphs. Wrap each paragraph in <p></p> tags. Do not add extra spaces. When you want to make a double line break use <p><br></p>.\n\n##Example Input:\nName: Sarah Thompson\nOffice: Fairfax City Council\nOccupation: Local entrepreneur and current City School Board Member\nPast experience: School Board Member\nIssues: Excellence in education, housing, safety, public service\nFun Fact: I’m a dedicated mom.\nElection Date: 11/5\nCampaign Committee: Sarah for Fairfax\n\n##Example Output:\n[Photo: Candidate talking with voters or in a casual setting answering questions]\n\nYOU ASKED, I\'M ANSWERING: YOUR TOP QUESTIONS\nSince launching my independent campaign for Fairfax City Council, I\'ve received hundreds of questions from voters. Here are the answers to your most frequently asked ones:\n\nQ: "Why are you running as an independent?"\nA: I believe our community deserves a representative who answers to people, not party bosses. My experience as a School Board Member taught me that good ideas come from everywhere - not just one side of the political aisle.\n\nQ: "What makes you qualified?"\nA: I\'ve spent [X] years working as a School Board Member, directly tackling the issues facing our community. This hands-on experience has prepared me to hit the ground running on day one.\n\nQ: "How do you plan to fund public safety?"\nA: I\'ve outlined a detailed plan on my website that includes [brief explanation]. Unlike typical politicians, I won\'t promise what I can\'t deliver. My budget proposals are transparent and fully funded.\n\nQ: "Where do you stand on [controversial local issue]?"\nA: I support [position] because [brief reasoning]. I understand this is complex, which is why I\'ve hosted three community forums on this topic to hear all perspectives.\n\nQ: "If elected, how will you stay accountable to voters?"\nA: I\'ll hold monthly town halls, maintain an open-door policy, and publish quarterly reports on my progress. Being independent means I work for you - and only you.\n\nHave another question? Drop it below and I\'ll answer personally! Or join me this Saturday at my "Ask Me Anything" event at Main Street Coffee (10AM-1PM).\n\n#TransparencyMatters #IndependentVoice #AskMeAnything\n\n\n##Input:\nName: Tomer Almog\nOffice: Hendersonville City Mayor\nPast experience: dfdf\nIssues: [[simplifiedPositions]]\nFun fact: I love playing the guitar and writing songs in my free time. I\'ve even performed at a few local open mic nights! Music has been a passion of mine for as long as I can remember, and I believe that it has helped me to develop creativity, perseverance, and a willingness to take risks. Whether writing a song or crafting a policy proposal, I bring the same enthusiasm and dedication to everything I do.\nElection date: 2026-11-03\nCampaign committee: unknown\n\n##Output:\n\n        \n      ',
        status: 'completed',
        createdAt: 1756338250035,
        inputValues: {},
        existingChat: [],
      },
    },
    smsGetOutTheVote: {
      name: 'Sms Get Out The Vote',
      content:
        "Sure, let's create some engaging SMS messages for Tomer Almog's Get Out The Vote campaign. Here's how they might look:\n\n---\n\n\"Hi [[first_name]]! I'm Tomer Almog, running for Oak Park Unified School Board. My key priorities include *ensuring language access for non-English speakers*, *combating elder abuse*, and *economic development*. Your vote is powerful! **Reply 'more' to learn about my vision.** 🌟 Insert line break here.\"\n\n---\n\n\"Voting is simpler than you think and vital for our future. **Can I count on your support for Oak Park Unified School Board?** Text 'vote' for details on how to participate. Let's make history together! Insert line break here.\"\n\n---\n\n\"Thank you, [[first_name]], for engaging with our campaign. Every vote counts. For more information or to find out where to vote, **reply 'info'.** Together, we can achieve *accessibility and inclusivity*, *combat elder abuse*, and *drive economic development*. - Tomer Almog Insert line break here.\"\n\n---\n\n\"Remember, **2024-11-05** is coming up fast. Ensure your voice is heard! For voting locations, **reply 'where'.** Insert line break here.\"\n\n---\n\n(Messages funded by unknown. To stop receiving messages, reply 'stop'.)\n\n---\n\nThese messages aim to be concise and engaging while clearly communicating the candidate's priorities and encouraging voter interaction.",
      updatedAt: 1717025752556,
      inputValues: {},
    },
    candidateWebsite2: {
      name: 'Candidate Website2',
      content:
        "It looks like you haven't asked a question yet. How can I assist you today?",
      updatedAt: 1716479391114,
      inputValues: {},
    },
    smsGetOutTheVote2: {
      name: 'Sms Get Out The Vote2',
      content:
        "\"Hi **[[first_name]]**! I'm Tomer Almog, running for Oak Park Unified School Board. My key priorities include *accessibility and inclusivity* in public meetings, *combating elder abuse*, and *economic development*. Your vote is powerful! Reply 'more' to learn about my vision. 🌟 Insert line break here.\"\n\n\"Voting is simpler than you think and vital for our future. Can I count on your support for Oak Park Unified School Board? **Text 'vote' for details** on how to participate. Let's make history together! Insert line break here.\"\n\n\"Thank you, **[[first_name]]**, for engaging with our campaign. Every vote counts. For more information or to find out where to vote, reply 'info'. Together, we can achieve *accessibility and inclusivity*, *combat elder abuse*, and *economic development*. - Tomer Almog Insert line break here.\"\n\n\"Remember, **2024-11-05** is coming up fast. Ensure your voice is heard! For voting locations, reply 'where'. Insert line break here.\"\n\n(Messages funded by unknown. To stop receiving messages, reply 'stop'.)",
      updatedAt: 1717029061788,
      inputValues: {},
    },
    smsGetOutTheVote3: {
      name: 'Sms Get Out The Vote3',
      content:
        "<p>Hi, this is Tomer Almog and I'm running for Los Angeles City Mayor. I'm excited to bring my passion and creativity to the role of Mayor, and I'm committed to making a positive impact on our city. My priorities include focusing on key issues that matter to our community, and I'm dedicated to working tirelessly to address them. As someone who loves playing the guitar and writing songs, I believe that my creative spirit will serve me well in finding innovative solutions to the challenges we face. Whether it's crafting a policy proposal or performing at a local open mic night, I bring the same enthusiasm and dedication to everything I do. The election is on November 3rd, 2026, and I would be honored to have your support. Can I count on your vote? Reply stop to opt out Paid for by Tomer Almog for Los Angeles City Mayor</p>",
      updatedAt: 1741901483934,
      inputValues: {},
    },
    smsGetOutTheVote4: {
      name: 'Sms Get Out The Vote4',
      content:
        "<p>Hi, this is Tomer Almog and I'm running for Los Angeles City Mayor. I'm excited to bring my passion and creativity to the role of Mayor. My priorities include focusing on key issues in our community, and I'm committed to making a positive impact. As someone who loves playing the guitar and writing songs, I know that creativity and perseverance can help drive real change. I'll bring this same enthusiasm and dedication to everything I do as Mayor. The election is on November 3rd, 2026. Can I count on your support? Reply stop to opt out Paid for by Tomer Almog for Los Angeles City Mayor</p>",
      updatedAt: 1741901754557,
      inputValues: {},
    },
    betaSmsElectionDay: {
      name: 'Beta Sms Election Day',
      content:
        "Hi [[first_name]]!\n\nElection Day is approaching, and it's time to make a difference in Oak Park! I'm Tomer Almog, running for the Oak Park Unified School Board. Music is a passion of mine, and I've had the joy of performing at local open mic nights. This creativity and enthusiasm are the same qualities I bring to my work in education.\n\nI believe in fostering an environment where every student can thrive. I'm committed to improving our schools with innovative ideas and policies that benefit all. With a focus on collaboration and community engagement, I aim to enhance the quality of education in Oak Park.\n\nLet's build a brighter future for our children together. If you share this vision, I ask for your support on Election Day, 11/5/2024.\n\nReply stop to opt-out.",
      updatedAt: 1729095699895,
      inputValues: {},
    },
    launchSocialMediaCopy: {
      name: 'Launch Social Media Copy',
      content:
        "<p>📢 Exciting News! 📢 I am thrilled to announce my candidacy for the US Senate as an Independent candidate! My name is Tomer Almog and I currently serve as the CTO of Good Party. #TomerForSenate #IndependentCandidate</p><p>👨‍💻 Let me introduce myself: I am a social media and campaign strategist with a passion for music. In my free time, I love playing the guitar and writing songs. Music has taught me creativity, perseverance, and the courage to take risks. I bring the same dedication to my policy proposals. #TomerForSenate #BackgroundInfo</p><p>🏛️ I'm running for the US Senate because I believe in empowering individuals and preserving our freedoms. It's time to push for change and challenge the status quo. I'm not bound by party lines – my focus is solely on bringing fresh ideas to the table. #TomerForSenate #ReasonsForRunning</p><p>🔑 My campaign is centered around two core issues: Mandate Freedom and Covid Free choice. I believe that individuals should have the right to make decisions about their own health and well-being. We must also hold corporations accountable and investigate vaccination greed. #TomerForSenate #CoreIssues</p><p>🗳️ This election is crucial for the future of our country. The stakes are high, and we must elect leaders who genuinely care about the people they represent. I am committed to being a voice for the people, fighting for equality, justice, and a better tomorrow. Join me in this journey. #TomerForSenate #ElectionStakes</p><p><br></p><p>edited by Tomer</p>",
      updatedAt: '2023-10-16',
      inputValues: {},
    },
    communicationsStrategy: {
      content:
        '<div class="bg-gray-100 py-8">\n  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">\n    <div class="lg:text-center">\n      <h2 class="text-3xl leading-8 font-extrabold tracking-tight text-gray-900 sm:text-4xl">\n        Meet Tomer Almog.\n      </h2>\n      <p class="mt-2 text-base leading-6 text-gray-600 font-bold">\n        Candidate for US Senate as an Independent/None\n      </p>\n      <p class="mt-2 text-base leading-6 text-gray-600 font-bold">\n        Election date: 2023-11-23\n      </p>\n      <p class="mt-2 text-base leading-6 text-gray-600 font-bold">\n        Running against: <span class="text-red-500 font-bold">Mike Turner</span>, member of the Democrat Party and a known corrupt politician\n      </p>\n    </div>\n\n    <div class="mt-10 sm:flex sm:justify-center">\n      <div class="rounded-md shadow">\n        <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-white bg-red-500 hover:bg-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n          Donate to Tomer\'s Campaign\n        </a>\n      </div>\n      <div class="mt-3 sm:mt-0 sm:ml-3">\n        <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-red-500 bg-white hover:text-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n          Volunteer for Tomer\'s Campaign\n        </a>\n      </div>\n    </div>\n\n    <div class="mt-10">\n\n      <div class="sm:flex sm:justify-center">\n        <div class="mt-10 sm:mt-0 sm:ml-3">\n          <div class="max-w-4xl mx-auto">\n            <div class="md:flex lg:items-center">\n              <div class="md:flex-shrink-0">\n                <img class="rounded-lg md:w-56" src="/images/tomer-almog.jpg" alt="Tomer Almog">\n              </div>\n              <div class="mt-4 md:mt-0 md:ml-6">\n                <div class="uppercase tracking-wide text-sm text-red-500 font-semibold">About Tomer Almog</div>\n                <p class="mt-2 text-gray-600 leading-relaxed">\n                  Tomer Almog is the CTO of Good Party and a passionate musician. He believes that his love for music has helped him develop creativity, perseverance, and the willingness to take risks – qualities that he brings to everything he does, from writing songs to crafting policy proposals. Tomer cares deeply about Mandate Freedom in the wake of COVID-19 and is running as an Independent/None candidate for US Senate.\n                </p>\n                <div class="mt-4">\n                  <p class="text-gray-600 font-bold">Tomer Almog\'s past experience: dfdf</p>\n                </div>\n              </div>\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <div class="text-center mt-10">\n        <p class="text-lg leading-8 font-medium text-gray-900">\n          Join Tomer Almog\'s Campaign Today!\n        </p>\n        <div class="mt-3 sm:flex sm:justify-center">\n          <div class="rounded-md shadow">\n            <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-white bg-red-500 hover:bg-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n              Donate to Tomer\'s Campaign\n            </a>\n          </div>\n          <div class="mt-3 sm:mt-0 sm:ml-3">\n            <a href="#" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base leading-6 font-medium rounded-md text-red-500 bg-white hover:text-red-400 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out md:py-4 md:text-lg md:px-10">\n              Volunteer for Tomer\'s Campaign\n            </a>\n          </div>\n        </div>\n      </div>\n\n    </div>\n\n  </div>\n</div>',
    },
    socialPostCommonQuestions: {
      name: 'Social Post Common Questions',
      content:
        '<p><img src="Candidate photo" alt="Tomer Almog talking with voters or in a casual setting answering questions">YOU ASKED, I\'M ANSWERING: YOUR TOP QUESTIONS</p>\n\n<p>Since launching my independent campaign for Hendersonville City Mayor, I\'ve received many questions from voters. Here are the answers to your most frequently asked ones:</p>\n\n<p>Q: "Why are you running as an independent?" \nA: I believe our community deserves a representative who answers to people, not party bosses. My goal is to work for the people of Hendersonville, not special interests or party affiliations.</p>\n\n<p>Q: "What are your positions on key issues?"\nA: My simplified positions on key issues can be found on my campaign materials. I am committed to transparency and to working on the issues that matter most to our community.</p>\n\n<p>Q: "What makes you qualified to be Mayor?"\nA: Although my past experience is varied, I am committed to bringing a fresh perspective and new ideas to the Mayor\'s office. I am dedicated to listening to the community and working collaboratively to find solutions.</p>\n\n<p>Q: "How will you stay accountable to voters?"\nA: I plan to hold regular town halls, maintain an open-door policy, and provide regular updates on my progress. As an independent candidate, I am committed to transparency and accountability.</p>\n\n<p><br></p>\n\n<p>Have another question? Drop it below and I\'ll answer personally! I\'m committed to listening to the community and working for the people of Hendersonville.</p>\n\n<p>#IndependentVoice #TransparencyMatters #HendersonvilleForAll</p>',
      updatedAt: 1756384151441,
      inputValues: {},
    },
  },
  vendorTsData: {},
  userId: 595,
  canDownloadFederal: false,
  completedTaskIds: [
    '9a1b2c3d-4e5f-6g7h-8i9j-0k1l2m3n4o5p',
    '9b2c3d4e-5f6g-7h8i-9j0k-1l2m3n4o5p6q',
    '9c3d4e5f-6g7h-8i9j-0k1l-2m3n4o5p6q7r',
    '9d4e5f6g-7h8i-9j0k-1l2m-3n4o5p6q7r8s',
    '9e5f6g7h-8i9j-0k1l-2m3n-4o5p6q7r8s9t',
    '9f6g7h8i-9j0k-1l2m-3n4o-5p6q7r8s9t0u',
  ],
  hasFreeTextsOffer: false,
  freeTextsOfferRedeemedAt: null,
  pathToVictory: {
    id: 771,
    createdAt: '2024-05-10T02:01:15.810Z',
    updatedAt: '2025-08-13T20:43:03.191Z',
    campaignId: 1,
    data: {
      men: 23793,
      asian: 13145,
      white: 10138,
      women: 25651,
      indies: 16270,
      source: 'ElectionApi',
      hispanic: 18755,
      democrats: 30017,
      p2vStatus: 'Complete',
      viability: {
        level: 'city',
        score: 2.25,
        seats: 1,
        candidates: '',
        isPartisan: false,
        isIncumbent: '',
        isUncontested: '',
        candidatesPerSeat: '',
      },
      winNumber: 3142,
      districtId: '17337513-5499-deb9-1cb9-9afc0c3c654e',
      p2vAttempts: 0,
      p2vComplete: '2024-04-03',
      republicans: 6991,
      electionType: 'City',
      averageTurnout: 16291,
      africanAmerican: 318,
      p2vCompleteDate: '2025-08-13',
      electionLocation: 'HENDERSONVILLE CITY',
      projectedTurnout: 6282,
      voterContactGoal: 15710,
      districtManuallySet: false,
      totalRegisteredVoters: 53278,
    },
  },
}
