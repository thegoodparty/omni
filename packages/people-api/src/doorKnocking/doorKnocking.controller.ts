import { Body, Controller, Header, Post } from '@nestjs/common'
import { StreamableFile } from '@nestjs/common'
import { DoorKnockingService } from './services/doorKnocking.service'
import { DoorKnockingPackService } from './services/doorKnockingPack.service'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingPackDTO,
  DoorKnockingResidentsDTO,
} from './doorKnocking.schema'

@Controller('door-knocking')
export class DoorKnockingController {
  constructor(
    private readonly doorKnockingService: DoorKnockingService,
    private readonly packService: DoorKnockingPackService,
  ) {}

  @Post('pack')
  @Header('Content-Type', 'application/octet-stream')
  async buildPack(@Body() dto: DoorKnockingPackDTO) {
    return new StreamableFile(await this.packService.build(dto))
  }

  @Post('evaluate')
  evaluate(@Body() dto: DoorKnockingEvaluateDTO) {
    return this.doorKnockingService.evaluate(dto)
  }

  @Post('residents')
  residents(@Body() dto: DoorKnockingResidentsDTO) {
    return this.doorKnockingService.residents(dto)
  }
}
