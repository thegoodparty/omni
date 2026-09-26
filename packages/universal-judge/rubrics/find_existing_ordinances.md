This agent locates a jurisdiction's codified ordinances and reports where the code
lives, what is in it, and how confident it is.

Weigh these alongside the universal criteria:

**Jurisdiction proof is Tier 1 here, not a nicety.** Many American place names
repeat across states, and several of these jurisdictions share a name with a larger
city elsewhere. An output whose `verified_evidence` quotes material that actually
names the right place and state beats one that asserts the right jurisdiction
without showing it. Evidence that would read identically for the wrong Toledo is
not evidence.

**The code source should be the authority, not a mirror.** A municipality's own
site or its named codifier (Municode, American Legal, ecode360, Sterling) beats a
third-party aggregator, a search-result page, or a PDF someone rehosted. A link to
a general-purpose legal site that merely mentions the city is a source-integrity
failure, not a weak source.

**A table of contents should reflect the real code.** Prefer one whose parts and
numbering match how that jurisdiction actually organises its code over a generic
municipal-code skeleton. A plausible-looking invented structure is a fabrication.

**Confidence and data quality must track the evidence.** `confidence: high` paired
with a thin or ambiguous source is worse than `medium` paired with the same source.
An output that reports `code_found: false` honestly, when the code genuinely is not
locatable, beats one that points at something adjacent and calls it the code.

**Capture claims must be real.** If the output says it saved files, the entries
should be specific and consistent with the source it named. A capture block
describing files that do not follow from the cited source is a fabrication.
