export const FIND_EXISTING_ORDINANCES = 'find_existing_ordinances'

export const MAX_QUALITY_LOOP_REVISIONS = 3
// The loop pins its judge: model fallback mid-loop would silently swap the
// grader and void iteration-to-iteration comparability, so no opus fallback.
export const QUALITY_LOOP_MODELS = ['claude-sonnet-4-6']
export const QUALITY_LOOP_LLM_RETRIES = 1
export const QUALITY_LOOP_STEP_TIMEOUT_MS = 240_000
export const QUALITY_LOOP_STALL_MINUTES = 30
export const SERVE_ORDINANCE_QUALITY_LOOP_FLAG = 'serve-ordinance-quality-loop'
export const ORDINANCE_QUALITY_LOOP_ENABLED_ENV =
  'ORDINANCE_QUALITY_LOOP_ENABLED'
