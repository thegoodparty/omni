import { INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'
import { ServiceReadConcurrencyInterceptor } from '@/elections/interceptors/serviceReadConcurrency.interceptor'
import { PublicPersonProfilesController } from './public-person-profiles.controller'

describe('PublicPersonProfilesController', () => {
  it('caps machine reads, which share the election-db pool with /v1/elections', () => {
    const interceptors: unknown[] = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      PublicPersonProfilesController,
    )
    expect(interceptors).toContain(ServiceReadConcurrencyInterceptor)
  })
})
