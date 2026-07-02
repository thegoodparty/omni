// Local shape of a community-issue agent artifact, matching the output_schema
// in packages/runbooks/experiments/{top_community_issues,trending_issues}/
// manifest.json. The generated agent-job-contracts types model `issues` as a
// fixed-length tuple union, which is awkward to render; this flat shape is the
// same data in a form the gallery can map over.

export type IssueSource = {
  id: string
  name: string
  source_type:
    | 'news'
    | 'government_website'
    | 'research'
    | 'poll'
    | 'advocacy_org'
  url?: string | null
  publisher?: string | null
  article_type?:
    | 'reporting'
    | 'opinion'
    | 'editorial'
    | 'press_release'
    | 'government_communication'
    | null
  article_date?: string | null
  retrieved_at: string
  retrieved_text_or_snapshot: string
}

export type IssueSubsection = {
  summary: string
  source_ids: string[]
}

export type IssueQuote = {
  text: string
  attribution?: string
  source_id: string
}

export type IssueDetail = {
  sources: IssueSource[]
  overview: IssueSubsection
  history?: IssueSubsection
  quotes?: { items: IssueQuote[] }
  research?: IssueSubsection
  legislation?: IssueSubsection
}

export type IssueCategory =
  | 'infrastructure_and_transportation'
  | 'public_safety'
  | 'education'
  | 'housing_and_development'
  | 'health_and_human_services'
  | 'economic_development'
  | 'quality_of_life'
  | 'government_operations'
  | 'other'

export type Issue = {
  existing_issue_id?: string
  title: string
  summary: string
  category: IssueCategory
  priority: 'low' | 'medium' | 'high'
  rank: number
  detail: IssueDetail
}

export type IssueArtifact = {
  schema_version: number
  list: 'top_community' | 'trending'
  organization_slug: string
  generated_for_run_id: string
  issues: Issue[]
  sources_used?: string[]
  data_quality: 'ok' | 'partial' | 'insufficient_signal'
  data_quality_reason?: string
  notes?: string
}

export type GalleryEntry = { runId: string; artifact: IssueArtifact }
