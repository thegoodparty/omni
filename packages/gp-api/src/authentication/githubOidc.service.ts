import { Injectable } from '@nestjs/common'
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose'
import { PinoLogger } from 'nestjs-pino'

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const GITHUB_OIDC_AUDIENCE = 'gp-api'
const GITHUB_JWKS_TIMEOUT_MS = 2_000
// A repository name can be freed and re-registered by someone else after a
// rename, transfer or delete; its numeric id never moves. Ids are global and
// not secret, so they live here rather than per environment.
const GITHUB_REPOSITORY_IDS: Record<string, string> = {
  'thegoodparty/gp-marketing': '975716809',
}

export type GithubOidcServiceReader = {
  source: 'github-oidc'
  repository: string
  repositoryId: string
  jobWorkflowRef: string
}

export const isGithubOidcToken = (token: string): boolean => {
  try {
    return decodeJwt(token).iss === GITHUB_OIDC_ISSUER
  } catch {
    return false
  }
}

@Injectable()
export class GithubOidcService {
  private readonly jwks = createRemoteJWKSet(
    new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`),
    { timeoutDuration: GITHUB_JWKS_TIMEOUT_MS },
  )

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GithubOidcService.name)
  }

  async verify(token: string): Promise<GithubOidcServiceReader | undefined> {
    const allowed = (process.env.GITHUB_OIDC_ALLOWED_WORKFLOWS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (allowed.length === 0) {
      this.logger.debug('GitHub OIDC token ignored: no workflows allowed')
      return undefined
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: GITHUB_OIDC_ISSUER,
        audience: GITHUB_OIDC_AUDIENCE,
        algorithms: ['RS256'],
      })
      const { repository, repository_id, job_workflow_ref } = payload
      if (
        typeof repository !== 'string' ||
        typeof repository_id !== 'string' ||
        typeof job_workflow_ref !== 'string'
      ) {
        throw new Error('GitHub OIDC token is missing repository claims')
      }
      if (GITHUB_REPOSITORY_IDS[repository] !== repository_id) {
        throw new Error(
          `GitHub repository ${repository} (${repository_id}) is not allowed`,
        )
      }
      const refAt = job_workflow_ref.lastIndexOf('@')
      const workflow = job_workflow_ref.slice(0, refAt)
      const workflowIsAllowed =
        refAt > 0 &&
        workflow.startsWith(`${repository}/`) &&
        allowed.some(
          (entry) => entry === job_workflow_ref || entry === `${workflow}@*`,
        )
      if (!workflowIsAllowed) {
        throw new Error(`GitHub workflow ${job_workflow_ref} is not allowed`)
      }
      return {
        source: 'github-oidc',
        repository,
        repositoryId: repository_id,
        jobWorkflowRef: job_workflow_ref,
      }
    } catch (err) {
      this.logger.warn({ err }, 'GitHub OIDC token verification failed')
      return undefined
    }
  }
}
