// The bucket the speech module keeps audio in: text-to-speech's cached
// Polly output under `speech/synth/`, and the offline memos' recordings with
// their Transcribe output.
export const SPEECH_BUCKET =
  process.env.MEETING_PIPELINE_BUCKET ?? 'meeting-pipeline-dev'
