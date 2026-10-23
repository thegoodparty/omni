import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DistrictsService } from 'src/districts/districts.service'
import { useTestService } from 'src/test-service'

// The interceptor reads its TTL when the app boots, so set it for this suite's
// boot only and restore it once the app is up.
const previousTtl = process.env.RESPONSE_CACHE_TTL_SECONDS
process.env.RESPONSE_CACHE_TTL_SECONDS = '300'

const service = useTestService()

beforeAll(() => {
  if (previousTtl === undefined) {
    delete process.env.RESPONSE_CACHE_TTL_SECONDS
  } else {
    process.env.RESPONSE_CACHE_TTL_SECONDS = previousTtl
  }
})

const DISTRICT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_DISTRICT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const MISSING_DISTRICT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const seedDistrict = (id: string, name: string) =>
  service.prisma.district.create({
    data: { id, state: 'CA', L2DistrictType: 'City', L2DistrictName: name },
  })

describe('response cache', () => {
  it('answers a repeated GET from memory until the URL changes', async () => {
    await seedDistrict(DISTRICT_ID, 'Before')

    const first = await service.client.get(`/v1/districts/${DISTRICT_ID}`)
    expect(first.status).toBe(200)
    expect(first.data.L2DistrictName).toBe('Before')

    await service.prisma.district.update({
      where: { id: DISTRICT_ID },
      data: { L2DistrictName: 'After' },
    })

    const repeat = await service.client.get(`/v1/districts/${DISTRICT_ID}`)
    expect(repeat.status).toBe(200)
    expect(repeat.headers['content-type']).toContain('application/json')
    expect(repeat.data).toEqual(first.data)

    const otherUrl = await service.client.get(
      `/v1/districts/${DISTRICT_ID}?fresh=1`,
    )
    expect(otherUrl.data.L2DistrictName).toBe('After')
  })

  it('does not cache an error', async () => {
    const missing = await service.client.get(
      `/v1/districts/${MISSING_DISTRICT_ID}`,
    )
    expect(missing.status).toBe(404)

    await seedDistrict(MISSING_DISTRICT_ID, 'Now here')

    const found = await service.client.get(
      `/v1/districts/${MISSING_DISTRICT_ID}`,
    )
    expect(found.status).toBe(200)
    expect(found.data.L2DistrictName).toBe('Now here')
  })

  it('still requires M2M auth for a cached URL', async () => {
    await seedDistrict(OTHER_DISTRICT_ID, 'Cached')
    const authed = await service.client.get(
      `/v1/districts/${OTHER_DISTRICT_ID}`,
    )
    expect(authed.status).toBe(200)

    const unauthed = await service.unauthedClient.get(
      `/v1/districts/${OTHER_DISTRICT_ID}`,
    )
    expect(unauthed.status).toBe(401)
  })

  it('runs the handler once for concurrent identical GETs', async () => {
    await seedDistrict(DISTRICT_ID, 'Shared')
    const districts = service.app.get(DistrictsService)
    const original = districts.findUnique
    // Hold the first lookup open so the other requests arrive while it is in
    // flight.
    const delayed = async (args: Parameters<typeof original>[0]) => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return original(args)
    }
    // A Prisma promise carries model accessors a plain Promise lacks; the
    // controller only awaits it.
    const spy = vi
      .spyOn(districts, 'findUnique')
      .mockImplementation(delayed as unknown as typeof original)

    const url = `/v1/districts/${DISTRICT_ID}?concurrent=1`
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => service.client.get(url)),
    )

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(responses.every((r) => r.data.L2DistrictName === 'Shared')).toBe(
      true,
    )
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
