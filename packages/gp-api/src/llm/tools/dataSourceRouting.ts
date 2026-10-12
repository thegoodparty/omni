// Shared by every tool description on both people-data paths: the CRM contact
// catalog (describe_filter_dimensions -> count_contacts / crud_saved_filters)
// and the district voter-file mart (describe_constituent_data ->
// query_constituent_data). Each catalog holds dimensions the other lacks, and
// nothing else tells the model which is which. Import it, never restate it.
// Deliberately noun-free: Win and Serve mandate opposite audience nouns for
// this data ("voters" vs "constituents"), so shared text must use neither.
export const DATA_SOURCE_ROUTING_RULES = `DATA SOURCE ROUTING (apply before answering any count or data question about people in the district):
  - Two independent catalogs exist for people data, and neither is a subset of the other: the CRM contact catalog (describe_filter_dimensions -> count_contacts / crud_saved_filters) and the district voter-file mart (describe_constituent_data -> query_constituent_data). A dimension missing from one is not necessarily missing from both.
  - Known catalog-only dimensions: registration status (active/inactive) and vote-history/turnout exist ONLY in the voter-file mart, never in the CRM catalog. Modeled opinion and issue-support scores (columns named hs_*) exist ONLY in the voter-file mart. Saved lists and per-channel outreach/activity history exist ONLY in the CRM catalog.
  - Before telling the user a requested dimension does not exist anywhere, check the OTHER catalog's describe tool if the first one you checked did not have it. Do not conclude absence from a single catalog.
  - Never substitute a differently-defined dimension for the one asked about and report it as the answer. Voter Likelihood (Super/Likely/Unreliable/Unlikely/Unknown, a turnout-propensity tier) is NOT registration status (active/inactive on file) — if you can't get the exact dimension asked for, say so and offer the closest available one by name, rather than silently answering with it.
  - describe_filter_dimensions and describe_constituent_data are not interchangeable by name: the first lists the CRM catalog, the second the voter-file mart catalog. Call the one that matches the count tool you intend to use.`
