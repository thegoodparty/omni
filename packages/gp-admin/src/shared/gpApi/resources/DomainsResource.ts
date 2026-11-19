import type { DomainAuthCode, GetDomainAuthCodeOptions } from '../types/domain'
import { BaseResource } from './BaseResource'

export class DomainsResource extends BaseResource {
  protected readonly resourceBasePath = '/domains'

  /**
   * Issues the registrar auth code a candidate needs to transfer their domain
   * to another registrar.
   *
   * `actorEmail` is required and names the admin the call is being made for.
   * gp-api sees only a shared M2M token here and cannot derive who acted, and
   * issuing this code hands control of the domain to whoever receives it — so
   * the audit trail depends on the caller being honest about it. Use the
   * signed-in admin's email, never a service account.
   *
   * Callers are responsible for their own authorization: gp-api accepts the
   * machine token and records `actorEmail` without verifying it.
   */
  getAuthCode = ({
    domain,
    actorEmail,
  }: GetDomainAuthCodeOptions): Promise<DomainAuthCode> =>
    this.getRequest<DomainAuthCode>(`${this.resourceBasePath}/auth-code`, {
      domain,
      actorEmail,
    })
}
