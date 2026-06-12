import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { Headers, MimeTypes } from 'http-constants-ts'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { CampaignPlanSharesRateLimitGuard } from './guards/campaignPlanSharesRateLimit.guard'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

const CAMPAIGN_ID_PATTERN = /^\d{1,10}$/
const FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/

// Recipients are humans clicking a link in an email — a dead link must
// render something readable, not a JSON error body.
const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Link not found - GoodParty.org</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#f5f5f7">
    <main style="max-width:28rem;margin:18vh auto 0;padding:2rem;text-align:center">
      <h1 style="font-size:1.5rem;color:#1a2a5e">
        This link is no longer available
      </h1>
      <p style="color:#444;line-height:1.5">
        The campaign plan you're looking for may have been removed, or the
        link may have been copied incorrectly. Ask the sender for a fresh
        link.
      </p>
      <p>
        <a href="https://goodparty.org" style="color:#1a2a5e">
          Learn more at GoodParty.org
        </a>
      </p>
    </main>
  </body>
</html>`

@Controller('campaign-plan-shares')
export class CampaignPlanSharesController {
  constructor(private readonly shares: CampaignPlanSharesService) {}

  @PublicAccess()
  @UseGuards(CampaignPlanSharesRateLimitGuard)
  @Get(':campaignId/:fileName')
  async getSharePdf(
    @Param('campaignId') campaignId: string,
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile | string> {
    // The uuid in the path is a capability token — keep responses out of
    // shared caches so deleting the object actually revokes the link.
    reply.header(Headers.CACHE_CONTROL, 'private, no-store')
    const valid =
      CAMPAIGN_ID_PATTERN.test(campaignId) && FILE_NAME_PATTERN.test(fileName)
    const pdf = valid
      ? await this.shares.getSharePdf(campaignId, fileName)
      : null
    if (!pdf) {
      // http-constants-ts misnames its text/* constants as IMAGE_* —
      // IMAGE_HTML's value is 'text/html'.
      reply
        .status(HttpStatus.NOT_FOUND)
        .type(`${MimeTypes.IMAGE_HTML}; charset=utf-8`)
      return NOT_FOUND_HTML
    }
    return new StreamableFile(pdf, {
      type: MimeTypes.APPLICATION_PDF,
      disposition: 'inline; filename="campaign-plan.pdf"',
      length: pdf.length,
    })
  }
}
