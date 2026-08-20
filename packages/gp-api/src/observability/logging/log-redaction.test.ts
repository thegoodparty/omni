import { createServer, Server } from 'http'
import { AddressInfo } from 'net'
import { format } from '@redtea/format-axios-error'
import axios, { AxiosError } from 'axios'
import pino from 'pino'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { redactLine } from '@goodparty_org/nest-common'

// A regex unit test can't tell you what pino actually writes for an Axios
// error, which is how the JSON-serialized `"Authorization":"JWT ..."` form
// escaped redaction in the first place. This drives a real failing HTTP
// request through a real pino logger configured like logger-module.ts and
// asserts the credential is gone from every shape it lands in.
const FAKE_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.notreal.notasignature'

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ Error: 'Invalid credentials' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
})

const captureLogs = (log: (logger: pino.Logger) => void): string => {
  const lines: string[] = []
  const logger = pino(
    {
      base: null,
      hooks: { streamWrite: redactLine },
      formatters: {
        log: (obj) => {
          for (const key of Object.keys(obj)) {
            if (obj[key] instanceof Error) {
              obj[key] = pino.stdSerializers.err(obj[key])
            }
          }
          return obj
        },
      },
    },
    { write: (line: string) => lines.push(line) },
  )
  log(logger)
  return lines.join('')
}

const failingRequest = async (): Promise<AxiosError> => {
  try {
    await axios.post(
      `${baseUrl}/token-auth`,
      { username: 'someone' },
      { headers: { Authorization: `JWT ${FAKE_TOKEN}` } },
    )
    throw new Error('expected the request to fail')
  } catch (error) {
    if (!axios.isAxiosError(error)) {
      throw error
    }
    return error
  }
}

describe('log redaction against real pino output', () => {
  it('redacts the credential when the Axios error is logged directly', async () => {
    const error = await failingRequest()

    const output = captureLogs((logger) =>
      logger.error({ error }, 'Vendor API ERROR'),
    )

    expect(output).not.toContain(FAKE_TOKEN)
    expect(output).toContain('"Authorization":"JWT [REDACTED]"')
    expect(output).toContain('Authorization: JWT [REDACTED]')
  })

  it('redacts the credential when the error is stringified into the message', async () => {
    const error = await failingRequest()

    const output = captureLogs((logger) =>
      logger.error({}, `Vendor API ERROR: ${JSON.stringify(format(error))}`),
    )

    expect(output).not.toContain(FAKE_TOKEN)
    expect(output).toContain('Authorization\\":\\"JWT [REDACTED]')
  })

  it('redacts the credential when a stringified config is a log field', async () => {
    const error = await failingRequest()

    const output = captureLogs((logger) =>
      logger.error({ config: JSON.stringify(error.config, null, 2) }, 'failed'),
    )

    expect(output).not.toContain(FAKE_TOKEN)
    expect(output).toContain('Authorization\\": \\"JWT [REDACTED]')
  })

  it('leaves the rest of the serialized request intact', async () => {
    const error = await failingRequest()

    const output = captureLogs((logger) =>
      logger.error({ error }, 'Vendor API ERROR'),
    )

    expect(output).toContain('"Content-Type":"application/json"')
    expect(output).toContain('"status":401')
    expect(output).toContain('/token-auth')
  })
})
