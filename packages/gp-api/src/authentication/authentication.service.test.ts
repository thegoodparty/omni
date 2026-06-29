import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common'
import { JsonWebTokenError, JwtService, TokenExpiredError } from '@nestjs/jwt'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compare } from 'bcrypt'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { UsersService } from '@/users/services/users.service'
import { AuthenticationService } from './authentication.service'

vi.mock('bcrypt', () => ({ compare: vi.fn() }))

const EMAIL = 'e@goodparty.org'

describe('AuthenticationService', () => {
  let service: AuthenticationService
  let usersService: {
    findUserByResetToken: ReturnType<typeof vi.fn>
    updatePassword: ReturnType<typeof vi.fn>
  }
  let jwtService: {
    verify: ReturnType<typeof vi.fn>
    sign: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    usersService = {
      findUserByResetToken: vi.fn(),
      updatePassword: vi.fn(),
    }
    jwtService = {
      verify: vi.fn(),
      sign: vi.fn(),
    }
    service = new AuthenticationService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      createMockLogger(),
    )
  })

  describe('validatePassword', () => {
    it('delegates to bcrypt compare', async () => {
      vi.mocked(compare).mockImplementation((() =>
        Promise.resolve(true)) as never)

      await expect(service.validatePassword('plain', 'hash')).resolves.toBe(
        true,
      )
      expect(compare).toHaveBeenCalledWith('plain', 'hash')
    })
  })

  describe('generatePasswordResetToken', () => {
    it('signs a random token with a 1h expiry', () => {
      jwtService.sign.mockReturnValue('signed.jwt.token')

      expect(service.generatePasswordResetToken()).toBe('signed.jwt.token')
      expect(jwtService.sign).toHaveBeenCalledWith(
        { token: expect.any(String) },
        { expiresIn: '1h' },
      )
    })
  })

  describe('updatePasswordWithToken', () => {
    it('updates the password when the token verifies and matches a user', async () => {
      jwtService.verify.mockReturnValue({ token: 't' })
      usersService.findUserByResetToken.mockResolvedValue({ id: 7 })
      usersService.updatePassword.mockResolvedValue({ id: 7 })

      const result = await service.updatePasswordWithToken(
        'user@goodparty.org',
        'reset-token',
        'new-password',
      )

      expect(jwtService.verify).toHaveBeenCalledWith('reset-token')
      expect(usersService.findUserByResetToken).toHaveBeenCalledWith(
        'user@goodparty.org',
        'reset-token',
      )
      expect(result).toEqual({ id: 7 })
      expect(usersService.updatePassword).toHaveBeenCalledWith(
        7,
        'new-password',
        true,
      )
    })

    it('throws Forbidden "Token has expired" for an expired token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new TokenExpiredError('jwt expired', new Date())
      })

      await expect(
        service.updatePasswordWithToken(EMAIL, 'tok', 'pw'),
      ).rejects.toThrow('Token has expired')
      expect(usersService.updatePassword).not.toHaveBeenCalled()
    })

    it('throws Forbidden "Invalid token" for a malformed JWT', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new JsonWebTokenError('jwt malformed')
      })

      await expect(
        service.updatePasswordWithToken(EMAIL, 'tok', 'pw'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws Forbidden "Invalid token" when the token fails to parse', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new SyntaxError('unexpected token')
      })

      await expect(
        service.updatePasswordWithToken(EMAIL, 'tok', 'pw'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws Forbidden when the reset token matches no user (P2025)', async () => {
      jwtService.verify.mockReturnValue({ token: 't' })
      usersService.findUserByResetToken.mockRejectedValue({
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
      })

      await expect(
        service.updatePasswordWithToken(EMAIL, 'tok', 'pw'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('surfaces an unexpected failure as InternalServerError', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('database is down')
      })

      await expect(
        service.updatePasswordWithToken(EMAIL, 'tok', 'pw'),
      ).rejects.toThrow(InternalServerErrorException)
    })
  })
})
