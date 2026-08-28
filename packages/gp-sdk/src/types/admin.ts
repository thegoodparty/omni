export type ImpersonateUserInput = {
  actorEmail: string
}

export type ImpersonateUserOutput = {
  token: string
}

export type CreateSignInLinkInput = {
  actorEmail?: string
}

export type CreateSignInLinkOutput = {
  url: string
  expiresAt: string
}
