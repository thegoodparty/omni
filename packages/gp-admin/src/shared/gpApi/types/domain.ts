export type GetDomainAuthCodeOptions = {
  /** Apex domain, no scheme and no `www.` — e.g. `janeforsenate.run`. */
  domain: string
  /**
   * Email of the admin this call is being made for. Required: gp-api sees only
   * a shared M2M token and cannot derive who acted.
   */
  actorEmail: string
}

export type DomainAuthCode = {
  authCode: string
}
