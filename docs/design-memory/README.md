# Design memory

Shared context for GoodParty design sessions run in Claude Desktop and claude.ai.

- `learned.md` — design rules earned from real sessions. Every entry exists because
  someone had to give that correction at least once.
- `fixtures.md` — the standard people, places, and mock data used across designs.

These files are fetched at the start of every design session by the
`goodparty-design` skill, over their public raw URLs. The skill holds no copy of
them, so a merge here reaches everyone immediately with no re-upload.

Updates come out of a design session: the designer says "update design memory",
Claude returns a revised file, and it lands here as a PR.

**This repo is public.** These files carry design rules and fictional fixtures
only. Never add customer quotes, anything from the private product-os research
archive, unreleased strategy, or real voter, constituent, or CRM data.
