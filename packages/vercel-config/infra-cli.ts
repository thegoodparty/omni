import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STACK = 'organization/vercel-config/prod'

const [command, flag] = process.argv.slice(2)
if (command !== 'diff' && command !== 'deploy') {
  console.error(
    'Usage: npm run infra -w packages/vercel-config -- <diff [--json] | deploy>',
  )
  process.exit(1)
}

if (!process.env.VERCEL_API_TOKEN) {
  console.error('Error: VERCEL_API_TOKEN is not set')
  process.exit(1)
}

const capture = (cmd: string) =>
  execSync(cmd, {
    encoding: 'utf8',
    env: { ...process.env, AWS_REGION: 'us-west-2' },
  }).trim()

const passphrase = capture(
  'aws ssm get-parameter --name pulumi-state-config-passphrase --with-decryption --query Parameter.Value --output text',
)

// Only s3:ListBucket is needed to answer this, which the PR diff role holds
// even when it cannot read this project's checkpoint.
const listing: { Contents?: { Key: string }[] } = JSON.parse(
  capture(
    'aws s3api list-objects-v2 --bucket goodparty-iac-state --prefix .pulumi/stacks/vercel-config/ --output json',
  ) || '{}',
)
const stackExists = (listing.Contents ?? []).some(
  ({ Key }) => Key === '.pulumi/stacks/vercel-config/prod.json',
)

// Before the first deploy there is no stack to preview against, and the PR
// diff role cannot create one. An empty throwaway backend previews exactly
// what that first deploy will do.
const backendUrl =
  command === 'diff' && !stackExists
    ? `file://${mkdtempSync(join(tmpdir(), 'vercel-config-'))}`
    : 's3://goodparty-iac-state'

const run = (cmd: string) => {
  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: __dirname,
      env: {
        ...process.env,
        PULUMI_BACKEND_URL: backendUrl,
        PULUMI_CONFIG_PASSPHRASE: passphrase,
        PULUMI_SKIP_UPDATE_CHECK: 'true',
        VERCEL_TOKEN: process.env.VERCEL_API_TOKEN,
      },
    })
  } catch {
    process.exit(1)
  }
}

if (command === 'diff') {
  if (!stackExists) {
    console.error(
      `${STACK} does not exist yet, so this previews against empty state: the first deploy.`,
    )
    // A config file left by an earlier throwaway stack carries that stack's
    // salt, which the new one would reject as an incorrect passphrase.
    rmSync(join(__dirname, 'Pulumi.prod.yaml'), { force: true })
    run(`pulumi stack init ${STACK} --non-interactive > /dev/null`)
  } else {
    run(`pulumi stack select ${STACK} > /dev/null`)
  }
  run(flag === '--json' ? 'pulumi preview --json' : 'pulumi preview --diff')
} else {
  run(`pulumi stack select ${STACK} --create`)
  run(process.env.CI ? 'pulumi up --diff --yes' : 'pulumi up --diff')
}
