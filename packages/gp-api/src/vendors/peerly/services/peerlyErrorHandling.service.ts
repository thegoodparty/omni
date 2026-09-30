import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common'
import { format } from '@redtea/format-axios-error'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { PeerlyApiErrorContext } from '../peerly.types'

interface PeerlyApiErrorResponseData {
  error?: string
  message?: string
  Error?: string
  details?: unknown
  [key: string]: unknown
}

// DRF-style template validation body Peerly returns for message-content
// rejections (banned URL shorteners, banned words), e.g.
// { Errors: { templates: [{ non_field_errors: ['Message cannot contain
// tinyurl.com links. Please correct your message.'] }] } }
const peerlyTemplateErrorsSchema = z.object({
  Errors: z.object({
    templates: z.array(z.record(z.string(), z.array(z.string()))),
  }),
})

type PeerlyApiErrorInfo = {
  error: unknown
  context?: PeerlyApiErrorContext
  logger?: PinoLogger
}

@Injectable()
export class PeerlyErrorHandlingService {
  async handleApiError(apiErrorInfo: PeerlyApiErrorInfo): Promise<never> {
    const { error, context, logger } = apiErrorInfo
    const formattedError = (isAxiosError(error) && format(error)) || error
    const genericMessage = 'Peerly API ERROR'
    const recoverySuffix = this.formatRecoverySuffix(context?.recoveryInfo)

    // Parsed before logging, not after, because it is one of the two things
    // that decide the severity of the line below. The throw path further down
    // reuses the same result rather than parsing twice.
    const templateMessages = this.templateRejectionMessages(error, context)

    // `win-peerly-warnings` counts error-level lines carrying this message, so
    // the level is what decides whether a firing pages win-bugs. Two shapes of
    // failure reach here having already been answered to the caller as a 4xx
    // they can act on, and neither is an incident:
    //
    //   - context.expectedRejection: the caller classified it, e.g. a wrong CV
    //     PIN (isPeerlyCvPinRejection). verifyCampaignVerifyPin already logs
    //     its own `warn` for exactly this, and this line used to override it.
    //   - templateMessages: a content rejection (banned word, URL shortener)
    //     surfaced below as a 400 carrying Peerly's own wording.
    //
    // A third shape is a fault, but cannot be one per line:
    //
    //   - context.retriedByCaller: a scheduled read the caller repeats minutes
    //     later. Left at `error` it pages once per record a sweep fails on;
    //     the sweep's own per-record `error` lines carry that signal instead.
    //
    // Everything else — nested 5xx, transport errors, anything unclassified —
    // stays at `error` and keeps paging. Over the 14 days to 2026-09-27 all 21
    // lines this alert matched were one of the first two cases above, so it
    // fired 18 times on non-incidents; the vendor being down was never among
    // them. It was on 2026-09-30, and it paged once per swept record.
    const logAtWarn =
      context?.expectedRejection === true ||
      context?.retriedByCaller === true ||
      !!templateMessages
    const logPayload = {
      data: !formattedError ? error : '',
      ...context?.recoveryInfo,
    }
    const logMessage = `${genericMessage}: ${formattedError ? JSON.stringify(formattedError) : ''}${recoverySuffix}`

    if (logAtWarn) {
      logger?.warn(logPayload, logMessage)
    } else {
      logger?.error(logPayload, logMessage)
    }

    if (error instanceof HttpException) {
      if (context?.customMessage) {
        const ExceptionClass = context.httpExceptionClass ?? BadGatewayException
        throw new ExceptionClass(context.customMessage + recoverySuffix, {
          cause: error,
        })
      }
      throw error
    }

    if (
      isAxiosError<PeerlyApiErrorResponseData>(error) &&
      error.response?.data
    ) {
      const responseData = error.response.data

      // Same reasoning as the line above: the detail line must not be the one
      // thing that keeps an expected rejection at error level.
      const detailPayload = { data: JSON.stringify(responseData, null, 2) }
      const detailMessage = 'Peerly API error response:'
      if (logAtWarn) {
        logger?.warn(detailPayload, detailMessage)
      } else {
        logger?.error(detailPayload, detailMessage)
      }

      // Content rejections are user-fixable — surface Peerly's own message
      // as a 400 so candidates can self-serve instead of hitting CS with an
      // opaque 502. Callers passing customMessage (e.g. list assignment)
      // keep their framing: downstream recovery matches on that message.
      if (templateMessages) {
        throw new BadRequestException(templateMessages.join(' '), {
          cause: error,
        })
      }

      const { error: errorField, message, Error: errorCapital } = responseData
      const parsedMessage =
        errorField || message || errorCapital || 'Unknown API error'

      const ExceptionClass = context?.httpExceptionClass ?? BadGatewayException
      const baseMessage =
        context?.customMessage ?? `Peerly API error: ${parsedMessage}`
      throw new ExceptionClass(baseMessage + recoverySuffix, { cause: error })
    }

    const ExceptionClass = context?.httpExceptionClass ?? BadGatewayException
    const baseMessage = context?.customMessage ?? genericMessage
    throw new ExceptionClass(baseMessage + recoverySuffix, { cause: error })
  }

  /**
   * Peerly's own wording for a content rejection, or null if this error is not
   * one.
   *
   * Pure, so it can be called before the log line decides its severity and
   * again on the throw path without parsing twice. Returns null — rather than
   * an empty array — for every case that must not be treated as a rejection:
   * a 5xx wearing a template-shaped body, an `Errors.templates` that carries no
   * messages, and a caller whose `customMessage` framing wins.
   */
  private templateRejectionMessages(
    error: unknown,
    context?: PeerlyApiErrorContext,
  ): string[] | null {
    if (context?.customMessage) return null
    if (!isAxiosError<PeerlyApiErrorResponseData>(error)) return null
    if (!error.response?.data) return null
    if ((error.response.status ?? 0) >= 500) return null

    const templateErrors = peerlyTemplateErrorsSchema.safeParse(
      error.response.data,
    )
    if (!templateErrors.success) return null

    const messages = templateErrors.data.Errors.templates.flatMap((template) =>
      Object.values(template).flat(),
    )
    return messages.length > 0 ? messages : null
  }

  private formatRecoverySuffix(
    recoveryInfo?: PeerlyApiErrorContext['recoveryInfo'],
  ): string {
    if (!recoveryInfo || Object.keys(recoveryInfo).length === 0) {
      return ''
    }
    const parts = Object.entries(recoveryInfo)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
    return parts.length === 0 ? '' : ` ${parts.join(' ')}`
  }
}
