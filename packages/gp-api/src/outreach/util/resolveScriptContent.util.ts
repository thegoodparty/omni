import sanitizeHtml from 'sanitize-html'

type AiContent = Record<string, { content?: string } | undefined>

/**
 * Resolves script content from aiContent if the script is a key,
 * otherwise returns the script as-is. CRLF is normalized to LF so the
 * P2P length check counts what the author's editor counted (stored
 * aiContent can carry pasted \r\n that sanitizeHtml does not strip).
 */
export function resolveScriptContent(
  script: string,
  aiContent: AiContent,
): string {
  const aiGeneratedScriptContent = aiContent[script]?.content
  const resolved = aiGeneratedScriptContent
    ? sanitizeHtml(aiGeneratedScriptContent, {
        allowedTags: [],
        allowedAttributes: {},
      })
    : script
  return resolved.replace(/\r\n/g, '\n')
}
