// Mirrors gp-api's isTestUser (src/users/util/users.util.ts): e2e users live
// on @test.goodparty.org; QA fixture users are qa-<uuid>@goodparty.org so
// internal-targeted feature flags apply to them. Staff emails never take the
// qa-<uuid> shape.
export const isTestUser = (params: { email: string }) =>
  params.email.endsWith('@test.goodparty.org') ||
  /^qa-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}@goodparty\.org$/i.test(
    params.email,
  )
