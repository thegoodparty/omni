
## Deliverable 1: Meeting briefing runbook

### What it does

A runbook procedure that:

1. Accepts raw agenda packet PDFs as input  
2. Emits a `MeetingBriefing` JSON object

### Output structure

Discover the authoritative schema from the attached named source spec city-council-member-briefing-copy.md  
The briefing contains at minimum:
- `AgendaItems` — all the items on the agenda
- `PriorityItems` — prioritized items on the agenda
- `ConstituentItems` — related to constituents 
- `metadata` — meeting body, date, EO name and district
- `sources` — a bibliography of all input documents used, each with document name, type, and location
- `extracts` — verbatim source passages on which each factual claim is based  

### Non-negotiable generation rules

These are from the peer-reviewed tone and framing doc. They are hard constraints on every LLM generation step in the pipeline.

**Source discipline**
- Every factual claim must be traceable to a source document in context.
- If a claim cannot be traced to a source, omit it.
- If inference is required beyond what the source states, prefix with `"Inferred:"` and do not present as fact.
- Do not import background knowledge, general policy context, or plausible-sounding details not present in the provided materials.
- Identity fields (names, dates, roles, dollar amounts, vote counts, legal citations) must be copied exactly from source. Do not paraphrase, round, or infer these values.

**Constituent data**
- Sourced from haystaq
- language can be termed as critical ≥ 75, strong ≥ 60, moderate ≥ 50 depending on what the average score is in that district
- Always include provenance note when constituent data appears: *"Issue prioritization is based on modeled estimates of constituent sentiment and should be interpreted as directional, not precise."*
- If constituent data is unavailable, omit the section entirely. Do not substitute assumptions or national averages.
- Do not present constituent quotes unless drawn from a verified, sourced poll or feedback mechanism.

**Voice and register**
- Do not use imperative voice directed at the EO.
- Do not presuppose the EO's position, relationships, or political constraints.
- Do not generate scripted talking points or language for the EO to say on record.
- Prohibited phrases: "Push for...", "Ensure that...", "Frame your position as...", "Make clear that...", "Demand...", "Insist..."
- Acceptable: "You may want to consider...", "It may be worth asking..."

**Section header language**

See example meeting briefing spec

**Required disclosure**
Every briefing must include (header or footer):
> *Briefings are AI-generated and still in beta, so double-check anything you'll act on against the sources. Your feedback shapes how we can improve our product moving forward, and we enjoy hearing from all our users.*
 