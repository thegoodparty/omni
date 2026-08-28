import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'

// ffmpeg is bundled in the gp-api container (deploy/Dockerfile, `apk add
// ffmpeg`) for robocall audio transcode: browser recordings arrive as
// webm/mp4 (Chrome/Safari), but CallHub's media upload accepts only
// mp3/wav/ogg, so an unsupported recording is transcoded to mp3 in-process
// before upload. Clips are ≤60s, so a transcode is ~1-2s.
const FFMPEG_BIN = 'ffmpeg'

// The recorder caps a clip at 60s; truncate defensively so a corrupt or
// oversized input can never stream unbounded audio through the pipe.
const MAX_OUTPUT_SECONDS = 60

// Hard ceiling on the bytes we buffer back from ffmpeg's stdout. A 60s mp3 at
// a high bitrate is well under this; anything larger is a malformed input and
// is killed rather than buffered.
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024

// Container formats ffmpeg cannot decode from a non-seekable stdin pipe: the
// MP4 family stores its moov index at the end, so ffmpeg must seek back to it
// and fails against a pipe. These are staged through a temp input file;
// stream-seekable containers (webm/ogg) pipe straight through stdin. This is
// the MP4-family subset of the recorder/upload contract's
// ROBOCALL_AUDIO_ALLOWED_MIME_TYPES (audio/mp4 from Safari's recorder,
// audio/x-m4a from the file picker); raw audio/aac isn't an allowed input, so
// it's deliberately absent.
const TEMP_FILE_CONTENT_TYPES: readonly string[] = [
  MimeTypes.AUDIO_MP4,
  'audio/x-m4a',
]

const PIPE_INPUT = 'pipe:0'
const PIPE_OUTPUT = 'pipe:1'

@Injectable()
export class AudioTranscodeService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AudioTranscodeService.name)
  }

  async toMp3(input: Buffer, sourceContentType: string): Promise<Buffer> {
    const tempPath = TEMP_FILE_CONTENT_TYPES.includes(sourceContentType)
      ? join(tmpdir(), `robocall-transcode-${randomUUID()}`)
      : null
    try {
      if (tempPath) await writeFile(tempPath, input)
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        tempPath ?? PIPE_INPUT,
        '-vn',
        '-acodec',
        'libmp3lame',
        '-t',
        String(MAX_OUTPUT_SECONDS),
        '-f',
        'mp3',
        PIPE_OUTPUT,
      ]
      return await this.runFfmpeg(args, tempPath ? null : input)
    } finally {
      if (tempPath) {
        try {
          await rm(tempPath, { force: true })
        } catch (err) {
          this.logger.error({ err, tempPath }, 'failed to remove temp audio')
        }
      }
    }
  }

  private runFfmpeg(
    args: string[],
    stdinInput: Buffer | null,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(FFMPEG_BIN, args)
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let outputBytes = 0
      let settled = false

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        reject(err)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > MAX_OUTPUT_BYTES) {
          fail(new BadGatewayException('Transcoded audio is too large'))
          return
        }
        stdout.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

      child.on('error', (err) => {
        this.logger.error({ err }, 'ffmpeg failed to spawn')
        fail(new BadGatewayException('Audio transcode failed to start'))
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        if (code === 0) {
          resolve(Buffer.concat(stdout))
          return
        }
        this.logger.error(
          { code, stderr: Buffer.concat(stderr).toString() },
          'ffmpeg transcode exited non-zero',
        )
        reject(new BadGatewayException('Audio transcode failed'))
      })

      if (stdinInput) {
        // ffmpeg closes its stdin the moment it errors early; the resulting
        // EPIPE on our write is not the real failure (the close handler reports
        // that), so absorb it rather than crash the process on an unhandled
        // 'error' event.
        child.stdin.on('error', (err) =>
          this.logger.debug({ err }, 'ffmpeg stdin closed early'),
        )
        child.stdin.end(stdinInput)
      } else {
        child.stdin.end()
      }
    })
  }
}
