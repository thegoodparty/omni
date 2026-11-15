# Technical writing for a build shape

The reader is technical and knows our codebase in general, but may not know the
system this feature touches. They have two minutes. Every word on the page either helps
them decide or wastes their two minutes.

This file follows ISO 24495-1 (plain language): the reader can find what they need,
understand it the first time they read it, and act on it.

## Rules

1. **Complete sentences.** A subject and a verb. No telegraph-style fragments that
   pack three facts into five words. Short is good; cryptic is not.
2. **One idea per bullet.** No semicolons stacking two clauses. If a bullet needs
   "and" twice, split it.
3. **Plain words for what happens.** Say what the system does in words a person
   would use out loud: "sends", "stores", "checks", "waits". Not our internal
   nouns.
4. **No code names in prose.** Class names, constants, file names, route paths and
   env vars belong on the map, where a path labels a box. In the rail, say what the
   thing does. Use a code name in prose only when the reader must recognize it to
   decide, and then say what it is in the same sentence.
5. **No coined nouns.** If the page would need to define a word ("the spine", "a
   stamp", "lead changes"), use the plain description instead.
6. **Say the consequence, not the mechanism.** "A bad list cannot hurt password
   reset email" beats "separate configuration set on a dedicated subdomain."
7. **Questions only when they are real.** A risk phrased as a question must be one
   a reviewer has to answer. Never tack "Acceptable?" or "Close enough?" onto a
   statement.
8. **No ratings without reasons.** Not "Low:" or "Medium:". Say what you would
   throw away.
9. **Numbers over adjectives.** "Starts at 200 emails a day" beats "starts
   sandboxed at a low rate."
10. **No filler.** Cut: robust, seamless, leverage, ensure, streamline, scalable,
    comprehensive, critical, key, effectively, simply, just, "it's worth noting",
    "not only X but Y", and lists of three padded to reach three.

## Before and after

These come from earlier drafts. The "before" column is what to avoid.

| Before | After |
| --- | --- |
| Two runbooks, three credentials; same gp-api lead changes as A | The agent needs two new runbooks and three new logins. gp-api changes as in option A. |
| Builds on `TEXT_DELIVERY_HANDOFF_PORT`, made for a vendor swap | Builds on the text hand-off, which was built so another sender could replace ops. |
| M2M step route and a stamp on the send | A new gp-api route the agent calls after each step, which records the step on the send. |
| Misses the 1-hour scheduling target, and a Friday wave waits for Monday. Close enough? | Waves are scheduled the same day, not within an hour. A Friday wave waits until Monday. |
| Cost to back out: Low: hide the tile, drop two tables and a DNS record. | Cost to back out: hide the email tile, drop two tables and remove one DNS record. |
| SES starts sandboxed at a low rate; leaving needs AWS review. | SES starts limited to 200 emails a day. Raising the limit needs an AWS review that takes about a day. |
| Next send time, close on ingest | (cut: the reader cannot use it) |

## Self-edit

After drafting, read every bullet as if you had not written it. For each one ask:
would a staff engineer who has never seen this code understand it on the first
read? If not, rewrite it. Then cut every bullet the reader would not miss.
