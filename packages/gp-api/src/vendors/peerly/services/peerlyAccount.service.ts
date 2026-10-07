import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import { AccountBalanceResponseDto } from '../schemas/peerlyAccount.schema'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'

export type PeerlyAccountBalance = {
  balance: number
  creditLimit: number
}

@Injectable()
export class PeerlyAccountService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly peerlyErrorHandling: PeerlyErrorHandlingService,
  ) {
    super(logger)
  }

  // The prepaid balance of OUR Peerly account (every candidate's job bills
  // against it). Negative means Peerly is extending credit, bounded by
  // creditLimit.
  async getBalance(): Promise<PeerlyAccountBalance> {
    try {
      const response = await this.peerlyHttpService.get(
        `/accounts/${this.accountNumber}/balance`,
      )
      const validated = this.peerlyHttpService.validateResponse(
        response.data,
        AccountBalanceResponseDto,
        'account balance',
      )
      return {
        balance: validated.balance,
        creditLimit: validated.credit_limit,
      }
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }
}
