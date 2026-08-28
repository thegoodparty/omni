import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { BadGatewayException } from '@nestjs/common'
import { MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioTranscodeService } from './audioTranscode.service'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}))

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  kill = vi.fn()
}

const logger = {
  setContext: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as PinoLogger

let service: AudioTranscodeService

const nextChild = (): FakeChild => {
  const child = new FakeChild()
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess)
  return child
}

const spawnArgs = (): string[] =>
  (vi.mocked(spawn).mock.calls[0]?.[1] as string[] | undefined) ?? []

beforeEach(() => {
  service = new AudioTranscodeService(logger)
})

describe('AudioTranscodeService.toMp3', () => {
  it('pipes a webm recording through stdin and returns the mp3 bytes', async () => {
    const child = nextChild()
    const promise = service.toMp3(Buffer.from('webm'), MimeTypes.AUDIO_WEBM)

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(writeFile).not.toHaveBeenCalled()
    expect(spawnArgs()).toContain('pipe:0')
    expect(child.stdin.end).toHaveBeenCalledWith(Buffer.from('webm'))

    child.stdout.emit('data', Buffer.from('mp3-'))
    child.stdout.emit('data', Buffer.from('bytes'))
    child.emit('close', 0)

    await expect(promise).resolves.toEqual(Buffer.from('mp3-bytes'))
  })

  it('stages an mp4 recording through a temp input file', async () => {
    const child = nextChild()
    const promise = service.toMp3(Buffer.from('mp4'), MimeTypes.AUDIO_MP4)

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    // The MP4 family cannot be decoded from a pipe, so the input is a temp file
    // and stdin carries no bytes.
    expect(writeFile).toHaveBeenCalledTimes(1)
    const args = spawnArgs()
    expect(args).not.toContain('pipe:0')
    expect(args.some((a) => a.startsWith(tmpdir()))).toBe(true)
    expect(child.stdin.end).toHaveBeenCalledWith()

    child.stdout.emit('data', Buffer.from('mp3'))
    child.emit('close', 0)

    await expect(promise).resolves.toEqual(Buffer.from('mp3'))
    expect(rm).toHaveBeenCalledTimes(1)
  })

  it('rejects with a 502 on a non-zero ffmpeg exit', async () => {
    const child = nextChild()
    const promise = service.toMp3(Buffer.from('webm'), MimeTypes.AUDIO_WEBM)

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    child.stderr.emit('data', Buffer.from('boom'))
    child.emit('close', 1)

    await expect(promise).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('rejects with a 502 when ffmpeg fails to spawn', async () => {
    const child = nextChild()
    const promise = service.toMp3(Buffer.from('webm'), MimeTypes.AUDIO_WEBM)

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    child.emit('error', new Error('ENOENT'))

    await expect(promise).rejects.toBeInstanceOf(BadGatewayException)
    expect(child.kill).toHaveBeenCalled()
  })
})
