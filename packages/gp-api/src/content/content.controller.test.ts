import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { IS_PUBLIC_KEY } from '@/authentication/decorators/PublicAccess.decorator'
import { describe, expect, it } from 'vitest'
import { ContentController } from './content.controller'

const getGuards = (method: keyof ContentController) =>
  Reflect.getMetadata('__guards__', ContentController.prototype[method]) ?? []

describe('ContentController auth', () => {
  it('protects the destructive sync route with AdminOrM2MGuard', () => {
    expect(getGuards('sync')).toContain(AdminOrM2MGuard)
  })

  it('keeps the read-only findByType route public', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        ContentController.prototype.findByType,
      ),
    ).toBe(true)
  })

  it('does not mark the whole controller public (so sync is not exposed)', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, ContentController),
    ).toBeUndefined()
  })
})
