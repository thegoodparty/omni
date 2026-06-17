import { Inject, Injectable } from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import {
  CHAT_SCOPE_HANDLERS,
  ChatScopeHandler,
} from '../types/chatScopeHandler'

// A claude-* model id routes to Anthropic in LlmService.resolveChatModel;
// anything else routes to Together. A sensitive scope must be Anthropic-only.
const isClaudeRouted = (model: string): boolean => model.startsWith('claude')

@Injectable()
export class ChatScopeRegistry {
  private readonly byScope = new Map<ChatScope, ChatScopeHandler>()

  constructor(@Inject(CHAT_SCOPE_HANDLERS) handlers: ChatScopeHandler[]) {
    for (const handler of handlers) {
      // Fail closed at wiring time: a sensitive scope configured with any
      // non-claude (Together-routed) model would silently send sensitive
      // tool outputs to a provider outside the Anthropic agreement. Reject
      // the misconfiguration up front rather than at request time.
      if (handler.isSensitive) {
        const offending = handler.models.filter((m) => !isClaudeRouted(m))
        if (handler.models.length === 0 || offending.length > 0) {
          throw new Error(
            `Sensitive chat scope "${handler.scope}" must declare a ` +
              `non-empty Anthropic-only model chain; offending models: ` +
              `${offending.join(', ') || '(none configured)'}`,
          )
        }
      }
      this.byScope.set(handler.scope, handler)
    }
  }

  has(scope: ChatScope): boolean {
    return this.byScope.has(scope)
  }

  get(scope: ChatScope): ChatScopeHandler | undefined {
    return this.byScope.get(scope)
  }
}
