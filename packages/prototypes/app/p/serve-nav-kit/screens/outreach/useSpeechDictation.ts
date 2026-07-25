import { useCallback, useEffect, useRef, useState } from 'react'

// Ported from the Lovable source (hooks/useSpeechDictation.ts). Real, backend-free
// voice dictation via the browser Web Speech API — no transcription server needed.

type SpeechResult = { isFinal: boolean; 0: { transcript: string } }
type SpeechEvent = {
  resultIndex: number
  results: { length: number } & Record<number, SpeechResult>
}
type SpeechErrorEvent = { error: string }
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechEvent) => void) | null
  onerror: ((e: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechCtor = new () => SpeechRecognitionLike

const getCtor = (): SpeechCtor | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor
    webkitSpeechRecognition?: SpeechCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const useSpeechDictation = ({
  onFinal,
  lang = 'en-US',
}: {
  onFinal: (chunk: string) => void
  lang?: string
}) => {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const supported = typeof window !== 'undefined' && getCtor() !== null
  const onFinalRef = useRef(onFinal)
  useEffect(() => {
    onFinalRef.current = onFinal
  }, [onFinal])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      setError("Voice input isn't supported in this browser.")
      return
    }
    recognitionRef.current?.abort()
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result?.isFinal) onFinalRef.current(result[0].transcript)
      }
    }
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted')
        setError(`Mic error: ${e.error}`)
    }
    rec.onend = () => {
      setRecording(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    setError(null)
    try {
      rec.start()
      setRecording(true)
    } catch {
      setRecording(false)
    }
  }, [lang])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { recording, error, supported, start, stop }
}
