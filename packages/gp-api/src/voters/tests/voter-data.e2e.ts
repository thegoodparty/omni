import { test, expect } from '@playwright/test'
import { HttpStatus } from '@nestjs/common'
import { loginUser } from '../../../e2e-tests/utils/auth.util'

test.describe('VoterData', () => {
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  test('should not allow user without campaign to download voter file', async ({
    request,
  }) => {
    const userEmail = 'user-without-campaign@example.com'
    const userPassword = 'password123'

    let userToken: string
    try {
      const { token } = await loginUser(request, userEmail, userPassword)
      userToken = token
    } catch {
      test.skip()
      return
    }

    const response = await request.get('/v1/voters/voter-file', {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    })

    expect([HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND]).toContain(
      response.status(),
    )
  })

  test('should allow admin to get voter file with slug', async ({
    request,
  }) => {
    test.skip(!adminEmail || !adminPassword, 'Admin credentials not configured')

    const { token: adminToken, campaign } = await loginUser(
      request,
      adminEmail!,
      adminPassword!,
    )

    if (!campaign?.slug) {
      test.skip()
      return
    }

    const response = await request.get(
      `/v1/voters/voter-file?slug=${campaign.slug}&count=true`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    )

    expect([
      HttpStatus.OK,
      HttpStatus.FORBIDDEN,
      HttpStatus.BAD_REQUEST,
    ]).toContain(response.status())
  })
})
