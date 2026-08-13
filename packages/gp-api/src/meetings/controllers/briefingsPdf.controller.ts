import {
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { BriefingPdfService } from '../services/briefingPdf.service'
import { BriefingsPdfRateLimitGuard } from './briefingsPdfRateLimit.guard'

/**
 * Public PDF endpoint for briefings. Mounted at `/v1/briefings/:uuid`.
 *
 * Intentionally lives outside the elected-office-scoped meetings controller
 * because share links must work for unauthenticated recipients (the briefing
 * UUID is the share secret). gp-webapp's middleware proxies `/api/v1/*` on
 * the app origin (`app.goodparty.org`) through to this handler, so that is
 * the origin the share URL is built on. It must NOT be the marketing origin
 * (`goodparty.org`) — that host is a separate deployment with no such proxy,
 * so every share link and QR scan pointed there 404s.
 *
 * Hardening notes:
 * - `ParseUUIDPipe({ version: '7' })` rejects anything that doesn't match the
 *   row's `uuid(7)` primary-key format, narrowing the brute-force search
 *   space and tying the validation to the format we actually issue.
 * - `BriefingsPdfRateLimitGuard` puts a per-IP token bucket in front of the
 *   handler. This is a stopgap; real production rate limiting belongs at
 *   the edge (Vercel/Cloudflare WAF).
 * - Every hit is logged with a *truncated* briefing-id prefix so operators
 *   can correlate abuse patterns without the full share token landing in
 *   any log sink. The NestJS request-id (injected by the global logger)
 *   already provides per-request correlation if more precision is needed.
 */
@Controller('briefings')
@UseGuards(BriefingsPdfRateLimitGuard)
export class BriefingsPdfController {
  private readonly logger = new Logger(BriefingsPdfController.name)

  constructor(private readonly briefingPdf: BriefingPdfService) {}

  @PublicAccess()
  @Get(':uuid')
  async getBriefingPdf(
    @Param('uuid', new ParseUUIDPipe({ version: '7' })) uuid: string,
  ): Promise<StreamableFile> {
    // The full UUID is the share secret — anyone who reads the logs would
    // otherwise harvest valid share tokens, bypassing the rate-limit guard.
    // The 8-character prefix is enough to disambiguate adjacent requests
    // when triaging together with the global request-id.
    this.logger.log(`getBriefingPdf: serving briefing ${uuid.slice(0, 8)}…`)
    // The QR code on the cover targets the public share URL so it works for
    // unauthenticated recipients of a forwarded PDF. `APP_ROOT` is the only
    // correct base here: it is app.goodparty.org in prod and the per-env
    // webapp origin elsewhere. A PDF outlives the session that produced it,
    // so a wrong base here keeps 404ing long after it is fixed.
    const { buffer, filename } = await this.briefingPdf.renderById(
      uuid,
      APP_ROOT,
    )
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      // RFC 6266: emit the filename with URI-encoded UTF-8 so the parser owns
      // escaping. The fallback ASCII `filename=` retains compatibility for
      // legacy mail clients that don't grok `filename*=`.
      disposition: `inline; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      length: buffer.length,
    })
  }
}

/**
 * Strip non-ASCII codepoints from a filename so the legacy `filename=`
 * portion of a Content-Disposition header parses safely on clients that
 * ignore `filename*`. `buildSlug` already restricts the slug to ASCII for
 * city-council briefings today, but `slugify` is configurable and this
 * fallback is cheap insurance.
 */
function asciiFallback(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, '_')
}
