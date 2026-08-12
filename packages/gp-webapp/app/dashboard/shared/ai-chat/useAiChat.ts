import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { reportErrorToSentry } from '@shared/sentry'
import type {
  AiChatClient,
  ChatMessageDto,
  ChatMessageSegment,
  ChatStreamEvent,
} from './types'
import { HISTORY_QUERY_KEY } from './useAiChatHistory'
import { friendlyError, newClientMessageId } from '../agent-chat/chatHelpers'

// The conversation engine behind AiChatBody: deferred create, streaming,
// abort-on-inactive, error/retry, and history assembly. Kept UI-free so the
// component owns only rendering, the composer, intro animation, and dictation.

export type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | {
      kind: 'assistant'
      id: string
      content: string
      toolsUsed?: string[]
      segments?: ChatMessageSegment[]
    }

export type ErrorState = {
  message: string
  retryable: boolean
  lastUserContent: string
  lastClientMessageId: string
  kind: 'init' | 'stream'
}

const messageToItem = (msg: ChatMessageDto): ChatItem | null => {
  if (msg.role === 'user')
    return { kind: 'user', id: msg.id, content: msg.content }
  if (msg.role === 'assistant')
    return {
      kind: 'assistant',
      id: msg.id,
      content: msg.content,
      ...(msg.segments && msg.segments.length > 0
        ? { segments: msg.segments }
        : {}),
    }
  return null
}

interface UseAiChatArgs {
  chatApi: AiChatClient
  conversationIdOverride?: string
  active: boolean
  onConversationCreated?: (conversationId: string) => void
  // Names the surface for Sentry context and the history-list query key.
  surface: string
}

export interface UseAiChatResult {
  conversationId: string | null
  history: ChatItem[]
  streaming: string | null
  liveStatus: string
  activeTools: string[]
  error: ErrorState | null
  creating: boolean
  sending: boolean
  busy: boolean
  sendContent: (content: string) => Promise<boolean>
  onRetry: () => Promise<void>
}

export function useAiChat({
  chatApi,
  conversationIdOverride,
  active,
  onConversationCreated,
  surface,
}: UseAiChatArgs): UseAiChatResult {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatItem[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  // Polite SR announcement of generation status — set on transitions only, so
  // the whole streamed answer isn't re-read on every token.
  const [liveStatus, setLiveStatus] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [error, setError] = useState<ErrorState | null>(null)
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const loadRequestedRef = useRef(false)
  const creatingRef = useRef(false)
  const sendingRef = useRef(false)

  // Load an existing conversation when the override changes.
  const loadExisting = useCallback(async () => {
    if (!conversationIdOverride) return
    if (loadRequestedRef.current) return
    loadRequestedRef.current = true
    setCreating(true)
    try {
      setConversationId(conversationIdOverride)
      const msgs = await chatApi.listMessages(conversationIdOverride)
      const items: ChatItem[] = []
      for (const m of msgs) {
        const it = messageToItem(m)
        if (it) items.push(it)
      }
      setHistory(items)
    } catch (err) {
      reportErrorToSentry(err, {
        surface,
        phase: 'init',
        conversationIdOverride,
      })
      loadRequestedRef.current = false
      setError({
        message: 'Could not load this chat. Try again.',
        retryable: true,
        lastUserContent: '',
        lastClientMessageId: '',
        kind: 'init',
      })
    } finally {
      setCreating(false)
    }
  }, [conversationIdOverride, chatApi, surface])

  useEffect(() => {
    if (!active || !conversationIdOverride) return
    void loadExisting()
  }, [active, conversationIdOverride, loadExisting])

  // Abort in-flight stream when the surface closes.
  useEffect(() => {
    if (active) return
    abortRef.current?.abort()
    abortRef.current = null
    sendingRef.current = false
    setSending(false)
  }, [active])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const ensureConversationId = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId
    if (creatingRef.current) return null
    creatingRef.current = true
    setCreating(true)
    try {
      const { conversationId: id } = await chatApi.createConversation()
      setConversationId(id)
      onConversationCreated?.(id)
      void queryClient.invalidateQueries({
        queryKey: HISTORY_QUERY_KEY(surface),
      })
      return id
    } catch (err) {
      reportErrorToSentry(err, { surface, phase: 'init' })
      return null
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [conversationId, chatApi, onConversationCreated, queryClient, surface])

  const runStream = useCallback(
    async (targetId: string, content: string, clientMessageId: string) => {
      const controller = new AbortController()
      abortRef.current = controller
      sendingRef.current = true
      setSending(true)
      setStreaming('')
      setActiveTools([])
      setError(null)
      setLiveStatus('Generating response')

      try {
        const iter = chatApi.streamMessage({
          conversationId: targetId,
          content,
          clientMessageId,
          signal: controller.signal,
        })
        let assembled = ''
        let assistantId: string | undefined
        let errored: ChatStreamEvent | null = null
        const turnTools: string[] = []
        let breakBeforeNextText = false

        for await (const ev of iter) {
          if (ev.type === 'text') {
            if (
              breakBeforeNextText &&
              assembled.length > 0 &&
              !/\s$/.test(assembled) &&
              !/^\s/.test(ev.delta)
            ) {
              assembled += '\n\n'
            }
            breakBeforeNextText = false
            assembled += ev.delta
            setStreaming(assembled)
          } else if (ev.type === 'tool_call') {
            if (assembled.length > 0) breakBeforeNextText = true
            if (!turnTools.includes(ev.toolName)) {
              turnTools.push(ev.toolName)
              setActiveTools([...turnTools])
            }
          } else if (ev.type === 'done') {
            assistantId = ev.assistantMessageId
            break
          } else if (ev.type === 'error') {
            errored = ev
            break
          }
        }

        if (errored && errored.type === 'error') {
          if (errored.code === 'aborted') {
            setStreaming(null)
          } else {
            setError({
              message: friendlyError(errored.code),
              retryable: errored.retryable,
              lastUserContent: content,
              lastClientMessageId: clientMessageId,
              kind: 'stream',
            })
            setStreaming(null)
          }
        } else {
          setHistory((prev) => [
            ...prev,
            {
              kind: 'assistant',
              id: assistantId ?? `local_assistant_${clientMessageId}`,
              content: assembled,
              ...(turnTools.length > 0 && { toolsUsed: [...turnTools] }),
            },
          ])
          setStreaming(null)
          setLiveStatus('Response ready')
        }
      } catch (err) {
        reportErrorToSentry(err, {
          surface,
          phase: 'stream',
          conversationId: targetId,
        })
        setError({
          message: 'Stream interrupted. Try again.',
          retryable: true,
          lastUserContent: content,
          lastClientMessageId: clientMessageId,
          kind: 'stream',
        })
        setStreaming(null)
      } finally {
        sendingRef.current = false
        setSending(false)
        setActiveTools([])
        abortRef.current = null
      }
    },
    [chatApi, surface],
  )

  const executeUserTurn = useCallback(
    async (content: string, clientMessageId: string) => {
      setSending(true)
      setStreaming('')
      let id = conversationId
      if (!id) {
        id = await ensureConversationId()
        if (!id) {
          setError({
            message: 'Could not start chat. Try again.',
            retryable: true,
            lastUserContent: content,
            lastClientMessageId: clientMessageId,
            kind: 'init',
          })
          setStreaming(null)
          setSending(false)
          sendingRef.current = false
          return
        }
      }
      await runStream(id, content, clientMessageId)
    },
    [conversationId, ensureConversationId, runStream],
  )

  const sendContent = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed || sendingRef.current || creatingRef.current) return false
      sendingRef.current = true
      const clientMessageId = newClientMessageId()
      setHistory((prev) => [
        ...prev,
        { kind: 'user', id: `local_${clientMessageId}`, content: trimmed },
      ])
      await executeUserTurn(trimmed, clientMessageId)
      return true
    },
    [executeUserTurn],
  )

  const onRetry = useCallback(async () => {
    if (!error) return
    const { lastUserContent, lastClientMessageId } = error
    setError(null)
    if (!lastUserContent || !lastClientMessageId) {
      loadRequestedRef.current = false
      await loadExisting()
      return
    }
    await executeUserTurn(lastUserContent, lastClientMessageId)
  }, [error, executeUserTurn, loadExisting])

  return {
    conversationId,
    history,
    streaming,
    liveStatus,
    activeTools,
    error,
    creating,
    sending,
    busy: sending || creating,
    sendContent,
    onRetry,
  }
}
