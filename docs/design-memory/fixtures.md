# Fixtures

Standard people, places, and data for GoodParty designs. Reuse these instead of
inventing new ones. Reviewers recognize them, so they can focus on the design
rather than re-reading the setup.

## Serve (elected officials)

**Persona: Sarah Chen.** City council member, City of Maplewood, population
32,000. Part-time, relatively new, not a policy expert, time-poor, politically
exposed. She is the default Serve user in every design and discussion. Use
"Sarah" in copy, and her full name only where a product would show it: name
fields, account cards, an email's To line.

**Her priorities:**

1. Speeding on Maple Ave near the elementary school. Source: community, 41 mentions
   in recent polling. Private.
2. Get the splash pad built at Lincoln Park. Source: ran on it, from her campaign
   platform. Public.
3. Bring down 911 call volume from the two largest apartment complexes. Source: her
   own. Involves confidential data. Private and sensitive.
4. Update the tree ordinance to add a canopy goal. Source: community. Public.

**What her community is asking for,** ranked: roads and infrastructure, public
safety, parks, affordable housing, stormwater.

**Sample constituent: Tom Alvarez.** A Maplewood resident. The recipient in a
message preview that fills a merge tag ("Hi Tom").

**Her office, for anything that sends:** the sender is "Council Member Sarah
Chen, City of Maplewood", replies go to `sarah.chen@maplewood.example`, and she
has imported 860 contacts with an email address. Use the reserved `.example`
domain, never a real-looking one.

**Her next council meeting:** City Council Regular Meeting, Tuesday,
December 8, 2026, 7:00 PM, Maplewood City Hall, 200 Main St. The agenda, in
order:

1. Consent agenda: minutes of November 24 and the monthly bills list.
2. Public comment.
3. Maple Ave traffic calming study, presentation by the city engineer
   (her priority 1).
4. Lincoln Park splash pad, award of the construction bid, $412,000
   (her priority 2).
5. Tree ordinance amendment adding a canopy goal, first reading (her
   priority 4).
6. Stormwater utility fee update, public hearing.

Maplewood is deliberately small and ordinary. If a design only works for a big
city, it does not work.

## Maplewood

A fictional city. ZIP 12345, City Hall at 200 Main St. Every date on a page is
in the future: when a fixture's date has passed, move it to the same weekday a
year later and say so in the brief.

## GoodParty team

**Candidate success: Jared.** The person who reaches out to a candidate or an
official, sends the emailed link, and answers when they ask for a human. First
name only, since he is a real teammate. Never put his email or phone number in
this repo.

## Win (candidates)

**Persona: Dana Ortiz.** Candidate for Maplewood City Council, Seat 3 (the
office reads "City Council, Maplewood", seat "Seat 3"). Election day is
Tuesday, November 2, 2027. She is the default Win user in every design and discussion. Use
"Dana" in copy, and her full name only where a product would show it: name
fields, account cards, an email's To line.

**Her voter file:** Maplewood, 12,480 registered voters.

**Sample voter: Linda Park.** A registered voter in Maplewood. The recipient in
a message preview that fills a merge tag ("Hi Linda").

**Her campaign, for anything that sends:** the committee is "Dana Ortiz for
City Council" (the "Paid for by" line), the campaign website is
`danaortiz.example`, and email replies go to `dana@danaortiz.example`. Use the
reserved `.example` domain, never a real-looking one. She has imported 1,240
contacts with an email address, so an email to everyone reaches 1,240 people;
the voter file itself has no email addresses.

Jared stays her candidate success contact, the same as for Serve.

## Scale

Design for a small local jurisdiction by default. Data should look like what a town
of 20,000 to 40,000 actually has: partial, a little messy, not a clean national
data set.
