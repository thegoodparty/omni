# speech

Audio in and out, with no domain knowledge: text to speech for reading
aloud, and speech to text for dictation and for recordings. Callers own
whatever the words mean and where they are stored.

## Key files

| File                                      | Purpose                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `services/textToSpeech.service.ts`        | Polly audio, cached in S3, handed out as presigned GETs   |
| `ws/speechToText.gateway.ts`              | The dictation socket the browser streams PCM over         |
| `services/transcribeStreaming.service.ts` | Live dictation: PCM frames to Transcribe streaming        |
| `services/transcriptionTicket.service.ts` | One-use tickets that open the dictation socket            |
| `services/transcribeFile.service.ts`      | A stored recording to a transcript, via batch Transcribe  |
| `speechBucket.ts`                         | `SPEECH_BUCKET`, the one bucket the module keeps audio in |

## Two ways to transcribe

- **Live (dictation).** The browser streams 16 kHz PCM over the socket and
  gets partial and final transcripts back as it speaks. No audio is stored.
  This is what every mic button uses when the phone has signal.
- **A stored file (`TranscribeFileService`).** For a recording the phone
  made with no signal and uploaded later (issue capture's offline memos).
  `MediaRecorder` writes webm/opus on Chrome and mp4 on Safari, and
  Transcribe streaming takes neither, so this is a batch job:
  `transcribeFile(audioKey)` starts it on `s3://SPEECH_BUCKET/{audioKey}`
  (`en-US`, no `MediaFormat`, so Transcribe detects the container) with
  output under `constituent-feedback-transcripts/{jobName}.json`, and
  returns the job name. `fetchResult(jobName)` polls: `in_progress`,
  `failed` with Transcribe's reason, or `completed` with the transcript read
  back from S3. Asynchronous on purpose: a job takes seconds to a minute,
  so the caller keeps the job name and polls from a cron
  (`constituentFeedback/services/pendingTranscription.service.ts`).

## Mock mode

`SPEECH_TRANSCRIBE_FILE_MODE=mock|aws`, read at boot; unset is `aws`, and any
other value fails boot. In `mock`, `transcribeFile` touches nothing and
returns a job name carrying its start time and a sentence index, and
`fetchResult` answers `in_progress` for three seconds and then `completed`
with that sentence from issue capture's seed fixture
(`constituentFeedback/services/feedbackSeedMemos.ts`), picked by hashing the
key. The job name carries everything, so a restart or the other replica
polls the same answer. `.env.test` and `.env.example` set `mock`. The
upload side of mock mode (a dev-only sink in place of the bucket) belongs to
issue capture; see `constituentFeedback/AGENTS.md`.

## Gotchas

- **`SPEECH_BUCKET` is the meeting pipeline's bucket**
  (`MEETING_PIPELINE_BUCKET`). A browser PUT to a presigned URL on it needs a
  CORS rule allowing the webapp's origins. The prod bucket's Pulumi
  component (`deploy/components/meeting-pipeline-bucket.ts`) sets none, and
  the dev bucket is managed outside this repo.
- **The mock reaches into issue capture for its fixture.** It is the one
  place this module knows about a caller, and only in mock mode.
