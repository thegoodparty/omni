import { z } from 'zod'

// The single source of truth for "what env vars does gp-api read". Every
// name here is grepped straight from `process.env` reads under `src/`
// (plus a handful resolved through a `<PREFIX>SUFFIX` indirection — see the
// Databricks section below — that a literal grep can't see) and reconciled
// against `.env.example`. Bare Node import only: no Nest, no Prisma (the
// Prisma client loads `.env` on import and has broken env-gated tests
// before), so this can be required from a plain script or a CI check.
//
// Tiers describe what SHOULD gate boot. `./env.ts`'s `resolveEnvVar` is the
// resolution helper degradable vendor sites consume (ENG-11195) — see e.g.
// vendors/vercel/services/vercel.service.ts or
// voters/services/voters.service.ts for the pattern. A few `requireEnv()`
// import-time throws on `optional`/`degradable` vars remain outside that
// inventory (e.g. vendors/stripe/services/stripe.service.ts's own
// STRIPE_SECRET_KEY / STRIPE_WEBSOCKET_SECRET / WEBAPP_ROOT_URL checks) —
// migrating those is still a separate piece of work.
//
// - required    — boot should fail fast without it.
// - degradable  — missing/placeholder disables one named feature surface.
// - optional    — a setting, tunable, or vendor key with no boot dependency.
export type EnvVarTier = 'required' | 'degradable' | 'optional'

export type EnvVarSpec = {
  tier: EnvVarTier
  // Required on every `degradable` entry: the feature surface that goes
  // dark when this var is absent or left at its placeholder.
  feature?: string
  // The sentinel `.env.example` ships for this var, e.g. Amplitude's
  // `some_key` convention (features.service.ts) that a service can compare
  // its live value against to detect "never configured".
  placeholder?: string
  // The value the reading code falls back to when unset, where one exists.
  default?: string
}

export const ENV_VAR_CONTRACT: Record<string, EnvVarSpec> = {
  // --- Required: boot fails fast without these ------------------------
  DATABASE_URL: { tier: 'required' },
  CORS_ORIGIN: { tier: 'required' },
  AUTH_SECRET: { tier: 'required' },
  CLERK_PUBLISHABLE_KEY: { tier: 'required' },
  CLERK_SECRET_KEY: { tier: 'required' },
  GP_API_MACHINE_SECRET: { tier: 'required' },
  AGENT_MCP_TOKEN_SECRET: { tier: 'required' },

  // --- Degradable: vendor clusters, feature dark without them ----------
  VERCEL_TOKEN: { tier: 'degradable', feature: 'candidate-domains' },
  VERCEL_PROJECT_ID: { tier: 'degradable', feature: 'candidate-domains' },
  VERCEL_TEAM_ID: { tier: 'degradable', feature: 'candidate-domains' },

  FORWARDEMAIL_API_TOKEN: {
    tier: 'degradable',
    feature: 'campaign-email-forwarding',
  },
  FORWARDEMAIL_BASE_URL: {
    tier: 'degradable',
    feature: 'campaign-email-forwarding',
  },

  PEERLY_MD5_EMAIL: { tier: 'degradable', feature: 'peerly-texting' },
  PEERLY_MD5_PASSWORD: { tier: 'degradable', feature: 'peerly-texting' },
  PEERLY_API_BASE_URL: { tier: 'degradable', feature: 'peerly-texting' },
  PEERLY_ACCOUNT_NUMBER: { tier: 'degradable', feature: 'peerly-texting' },
  PEERLY_HTTP_TIMEOUT: {
    tier: 'degradable',
    feature: 'peerly-texting',
    default: '60000',
  },
  EXPLICITLY_LOG_PEERLY_TOKEN: {
    tier: 'degradable',
    feature: 'peerly-texting',
    default: 'false',
  },

  GOOGLE_API_KEY: { tier: 'degradable', feature: 'google-services' },
  GEMINI_API_KEY: { tier: 'degradable', feature: 'google-services' },

  SLACK_APP_ID: { tier: 'degradable', feature: 'slack-notifications' },
  SLACK_APP_BOT_TOKEN: { tier: 'degradable', feature: 'slack-notifications' },
  SLACK_BOT_DEV_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_DEV_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_AI_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_AI_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_POLITICS_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_POLITICS_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_FEEDBACK_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_FEEDBACK_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_USER_FEEDBACK_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_USER_FEEDBACK_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_10DLC_COMPLIANCE_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_10DLC_COMPLIANCE_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_DELETIONS_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_DELETIONS_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_TEVYN_API_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_BOT_TEVYN_API_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_CAS_CLICKUP_TASKS_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_CAS_CLICKUP_TASKS_CHANNEL_TOKEN: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },
  SLACK_SHARED_PEERLY_10DLC_CHANNEL_ID: {
    tier: 'degradable',
    feature: 'slack-notifications',
  },

  STRIPE_WEBSOCKET_SECRET: { tier: 'degradable', feature: 'stripe-webhooks' },

  AMPLITUDE_PROJECT_API_KEY: {
    tier: 'degradable',
    feature: 'feature-flags',
    placeholder: 'some_key',
  },

  // LlmService only checks presence, so the .env.example placeholder boots
  // fine and every chat then 401s. Declaring it lets setup name the gap.
  ANTHROPIC_API_KEY: {
    tier: 'degradable',
    feature: 'ai-chat',
    placeholder: 'your-anthropic-key',
  },

  // ballotReady.service throws at import when unset, so the placeholder is
  // what boots a laptop, and onboarding's office step then 401s on it.
  BALLOT_READY_KEY: {
    tier: 'degradable',
    feature: 'office-search',
    placeholder: 'key',
  },

  L2_DATA_KEY: { tier: 'degradable', feature: 'voter-file-l2' },

  // Secrets Manager id of the curated local-dev bundle POST /v1/dev-env/
  // bundle vends. Set on the dev deploy only; unset everywhere else, which
  // is what keeps vending dark rather than failing boot before the secret
  // exists.
  LOCAL_DEV_ENV_SECRET_ID: {
    tier: 'degradable',
    feature: 'dev-env-vending',
  },

  // The trio behind resolvePeopleDbxConfig(); PEOPLE_DATABRICKS_API_KEY is
  // the local personal-access-token alternative to the OAuth pair, same
  // feature. Read via a keyed-constant `process.env[WAREHOUSE_ID_ENV]`
  // indirection in peopleDb/databricks/peopleDbx.config.ts, not a literal
  // `process.env.X` — a plain grep misses these.
  PEOPLE_DATABRICKS_WAREHOUSE_ID: {
    tier: 'degradable',
    feature: 'voter-data-databricks',
  },
  PEOPLE_DATABRICKS_CLIENT_ID: {
    tier: 'degradable',
    feature: 'voter-data-databricks',
  },
  PEOPLE_DATABRICKS_CLIENT_SECRET: {
    tier: 'degradable',
    feature: 'voter-data-databricks',
  },
  PEOPLE_DATABRICKS_API_KEY: {
    tier: 'degradable',
    feature: 'voter-data-databricks',
  },

  // --- Optional: everything else ---------------------------------------
  NODE_ENV: { tier: 'optional' },
  LOG_LEVEL: { tier: 'optional', default: 'debug' },
  ENABLE_QUERY_LOGGING: { tier: 'optional', default: 'false' },
  PORT: { tier: 'optional', default: '3000' },
  HOST: { tier: 'optional', default: 'localhost' },
  GIT_SHA: { tier: 'optional' },
  IS_PREVIEW: { tier: 'optional' },
  MAX_STRING_LENGTH: { tier: 'optional' },

  WEBAPP_ROOT_URL: { tier: 'optional' },
  APP_ROOT_URL: { tier: 'optional' },
  ASSET_DOMAIN: { tier: 'optional' },
  PUBLIC_API_URL: { tier: 'optional' },
  API_PUBLIC_ROOT_URL: { tier: 'optional' },
  ELECTION_API_URL: { tier: 'optional' },
  GP_ADMIN_BASE_URL: { tier: 'optional' },
  MARKETING_REVALIDATE_SECRET: { tier: 'optional' },
  MARKETING_REVALIDATE_URL: { tier: 'optional' },

  CLERK_AUTHORIZED_PARTIES: { tier: 'optional' },
  CLERK_API_TIMEOUT_MS: { tier: 'optional' },

  AWS_REGION: { tier: 'optional', default: 'us-west-2' },
  // Not read via `process.env.X` in our own code — the AWS SDK's default
  // credential provider chain picks these up for every S3/SQS/Textract/
  // Polly client we construct. Documented here so `.env.example` stays
  // complete for local dev.
  AWS_ACCESS_KEY_ID: { tier: 'optional' },
  AWS_SECRET_ACCESS_KEY: { tier: 'optional' },
  SQS_QUEUE: { tier: 'optional' },
  SQS_QUEUE_BASE_URL: { tier: 'optional' },

  CONTENTFUL_SPACE_ID: { tier: 'optional' },
  CONTENTFUL_ACCESS_TOKEN: { tier: 'optional' },
  CONTENTFUL_CHAT_PROMPT_NAME: { tier: 'optional', default: 'General' },

  HUBSPOT_TOKEN: { tier: 'optional' },
  HUBSPOT_PIN_SENT_EMAIL_ID: { tier: 'optional' },
  HUBSPOT_FORM_SUBMITTED_EMAIL_ID: { tier: 'optional' },
  HUBSPOT_PIN_SUBMITTED_EMAIL_ID: { tier: 'optional' },
  HUBSPOT_COMPLIANCE_COMPLETED_EMAIL_ID: { tier: 'optional' },
  HUBSPOT_COMPLIANCE_REJECTED_EMAIL_ID: { tier: 'optional' },
  HUBSPOT_POLL_RESULTS_EMAIL_ID: { tier: 'optional' },
  HUBSPOT_BRIEFING_READY_EMAIL_ID: { tier: 'optional' },

  MAILGUN_API_KEY: { tier: 'optional' },
  MAILGUN_INTERCEPT_EMAIL: { tier: 'optional' },
  TRACK_MAILGUN_EMAILS: { tier: 'optional', default: 'false' },

  AI_MODELS: { tier: 'optional' },
  AI_FALLBACK_MODEL: { tier: 'optional' },
  // Not read directly by our code; the `ai` SDK's provider registry checks
  // this name automatically when resolving a together.ai-hosted model id
  // out of AI_MODELS. Stubbed out in llm.service tests to keep them
  // deterministic regardless of the host's ambient env.
  TOGETHER_AI_KEY: { tier: 'optional' },
  LLAMA_AI_ASSISTANT: { tier: 'optional' },
  BRAINTRUST_API_KEY: { tier: 'optional' },

  GEOAPIFY_API_KEY: { tier: 'optional' },
  BRAVE_API_KEY: { tier: 'optional' },
  SEGMENT_WRITE_KEY: { tier: 'optional' },

  STRIPE_SECRET_KEY: { tier: 'optional' },

  CALLHUB_API_KEY: { tier: 'optional' },
  CALLHUB_API_BASE_URL: {
    tier: 'optional',
    default: 'https://api-na1.callhub.io',
  },
  CALLHUB_HTTP_TIMEOUT: { tier: 'optional', default: '30000' },
  CALLHUB_VB_CALLS_PER_MINUTE: { tier: 'optional', default: '10' },

  ENABLE_DOMAIN_PURCHASE: { tier: 'optional', default: 'false' },

  CAMPAIGN_PLAN_RESULTS_BUCKET: { tier: 'optional' },
  CAMPAIGN_PLAN_SHARES_BUCKET: { tier: 'optional' },

  AGENT_DISPATCH_QUEUE_NAME: { tier: 'optional' },
  AGENT_RUN_INPUTS_BUCKET: { tier: 'optional' },
  AGENTIC_KICKOFF_SWEEP_INTERVAL: { tier: 'optional' },

  SCHEDULED_MESSAGING_INTERVAL_SECS: { tier: 'optional', default: '3600' },

  // Read only by seed/seed.ts, outside src/ — kept here so the contract
  // stays a complete match against .env.example.
  SKIP_MTFCC_SEED: { tier: 'optional', default: 'false' },

  // Read only by scripts/setup/lib/cli.ts, outside src/ — a dedicated
  // local-setup Clerk dev machine's secret, used to mint a per-run M2M token
  // for calling this package's own test-fixtures endpoints from
  // `npm run setup`. Kept here so the contract stays a complete match
  // against .env.example; absent = setup.sh's login-seeding step skips.
  LOCAL_SETUP_CLERK_MACHINE_SECRET: { tier: 'optional' },

  WINNERS_ELECTION_YEAR: { tier: 'optional', default: '2024' },

  ROBOCALL_AUDIO_BUCKET: { tier: 'optional' },
  ROBOCALL_TEST_OVERRIDE_NUMBER: { tier: 'optional' },
  SERVE_ANALYSIS_BUCKET_NAME: { tier: 'optional' },
  // Issue capture synthesis (constituentFeedback/). Unset means the
  // deployed pipeline; `mock` keeps everything in-process.
  FEEDBACK_SYNTHESIS_ENGINE: { tier: 'optional', default: 'pipeline' },
  FEEDBACK_SYNTHESIS_MOCK_GROUPING: { tier: 'optional', default: 'llm' },
  // Issue capture's offline memos (speech/services/transcribeFile.service.ts).
  // Unset means S3 and batch Transcribe; `mock` keeps both on the laptop.
  SPEECH_TRANSCRIBE_FILE_MODE: { tier: 'optional', default: 'aws' },
  TEVYN_POLL_CSVS_BUCKET: { tier: 'optional' },
  // Intentionally unset in every environment: falls back to
  // TEVYN_POLL_CSVS_BUCKET above (see outreachTextDelivery.service.ts).
  OUTREACH_TEXT_CSVS_BUCKET: { tier: 'optional' },
  ZIP_TO_AREA_CODE_BUCKET: { tier: 'optional' },
  MEETING_PIPELINE_BUCKET: { tier: 'optional' },
  ANNOTATION_ATTACHMENTS_BUCKET: { tier: 'optional' },
  CHAT_ATTACHMENTS_BUCKET: { tier: 'optional' },

  CAMPAIGN_TRACKER_AUTOMATION_ENABLED: { tier: 'optional' },
  MEETINGS_AUTOMATION_ENABLED: { tier: 'optional' },
  ORDINANCES_AUTOMATION_ENABLED: { tier: 'optional' },
  ORDINANCE_RESOLVE_TIMEOUT_MS: { tier: 'optional' },
  WIN_SMS_HOLD_BILLING: { tier: 'optional' },

  CV_SCAN_PROFILE_SPACING_MS: { tier: 'optional' },
  CV_SCAN_RETRIEVE_SPACING_MS: { tier: 'optional' },
  DETAIL_FAILED_RETRY_COOLDOWN_MS: { tier: 'optional' },
  DETAIL_OUTSTANDING_RETRY_COOLDOWN_MS: { tier: 'optional' },
  OWNER_CACHE_TTL_MS: { tier: 'optional' },
  QUEUE_JOBS_CACHE_TTL_MS: { tier: 'optional' },
  ROBOCALL_SEND_LAUNCH_SPACING_MS: { tier: 'optional' },
  ROBOCALL_SEND_MAX_PER_SWEEP: { tier: 'optional' },
  SESSIONS_FLUSH_INTERVAL_MS: { tier: 'optional' },
  TEST_SEND_COOLDOWN_MS: { tier: 'optional' },
  VENDOR_READ_TIMEOUT_MS: { tier: 'optional' },

  // Set per-deploy by deploy/index.ts to 'preview' | 'dev' | 'prod'. Also
  // drives IS_PROD_DEPLOY / IS_NON_PROD_DEPLOY in appEnvironment.util.ts —
  // the only reliable prod-vs-non-prod signal, since NODE_ENV is pinned to
  // 'production' in every Docker build.
  OTEL_SERVICE_ENVIRONMENT: { tier: 'optional', default: 'dev' },
  OTEL_EXPORTER_OTLP_HEADERS: { tier: 'optional' },
  OTEL_SERVICE_INSTANCE_ID: { tier: 'optional' },

  // The shared Serve credential (default prefix in
  // llm/tools/databricksConnection.ts's resolveDatabricksConnection()) and
  // Campaign Manager's dedicated identity (WIN_DATABRICKS_ prefix). Read via
  // `process.env[\`${prefix}SUFFIX\`]` template-literal indirection, not a
  // literal `process.env.X` — a plain grep misses these.
  DATABRICKS_SERVER_HOSTNAME: { tier: 'optional' },
  DATABRICKS_HTTP_PATH: { tier: 'optional' },
  DATABRICKS_CLIENT_ID: { tier: 'optional' },
  DATABRICKS_CLIENT_SECRET: { tier: 'optional' },
  DATABRICKS_API_KEY: { tier: 'optional' },
  WIN_DATABRICKS_SERVER_HOSTNAME: { tier: 'optional' },
  WIN_DATABRICKS_HTTP_PATH: { tier: 'optional' },
  WIN_DATABRICKS_CLIENT_ID: { tier: 'optional' },
  WIN_DATABRICKS_CLIENT_SECRET: { tier: 'optional' },
}

export const envSchema = z.object(
  Object.fromEntries(
    Object.entries(ENV_VAR_CONTRACT).map(([name, spec]) => [
      name,
      spec.tier === 'required' ? z.string().min(1) : z.string().optional(),
    ]),
  ),
)

export type EnvContract = z.infer<typeof envSchema>
