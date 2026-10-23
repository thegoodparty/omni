import axios from 'axios'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'

const service = useTestService()

const PATH = '/v1/civic-panel/join/a1b2c3d4e5f6'
const BODY = {
  firstName: 'Test',
  lastName: 'Resident',
  phone: '3035550142',
  consent: true,
}

// Residents join a civic panel only by replying JOIN to a text.
describe('the old public civic panel join route', () => {
  it('404s GET and POST, signed in or not', async () => {
    const anonymous = axios.create({
      baseURL: service.client.defaults.baseURL,
      validateStatus: () => true,
    })

    for (const client of [service.client, anonymous]) {
      expect((await client.get(PATH)).status).toBe(HttpStatus.NOT_FOUND)
      expect((await client.post(PATH, BODY)).status).toBe(HttpStatus.NOT_FOUND)
    }
  })
})
