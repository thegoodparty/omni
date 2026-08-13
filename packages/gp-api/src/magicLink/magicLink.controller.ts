import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { MagicLinkResolveRateLimitGuard } from './guards/magicLinkResolveRateLimit.guard'
import { MagicLinkService } from './magicLink.service'
import { ResolveMagicLinkDto } from './schemas/resolveMagicLink.schema'
import { computeMagicLinkStatus } from './util/magicLinkStatus.util'

@Controller('magic-link')
@UsePipes(ZodValidationPipe)
export class MagicLinkController {
  constructor(private readonly magicLink: MagicLinkService) {}

  /**
   * Public resolver behind the texted `/s/<slug>` short link, which exists
   * because the ticketed redemption URL runs to ~743 characters — five SMS
   * segments, and a query string that shape reads as phishing to carrier
   * filters.
   *
   * Only returns a URL while the link is still redeemable (`sent`), so a
   * consumed or expired ticket is never handed back out — the same gate the
   * admin `GET /admin/elected-office/magic-link` lookup applies.
   *
   * Resolving deliberately does NOT mark the link redeemed. The `/serve/welcome`
   * and `/win/welcome` pages keep their button gate, which is what stops a link
   * scanner from burning the one-time ticket before the lead arrives.
   */
  @Get('resolve/:slug')
  @PublicAccess()
  @UseGuards(MagicLinkResolveRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async resolve(@Param() { slug }: ResolveMagicLinkDto) {
    const link = await this.magicLink.getBySlug(slug)
    if (!link) {
      return { url: null, status: null }
    }
    const status = computeMagicLinkStatus(link)
    return { url: status === 'sent' ? link.url : null, status }
  }
}
