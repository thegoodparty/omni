import { Body, Controller, Post } from '@nestjs/common'
import { DoorKnockingService } from './services/doorKnocking.service'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from './doorKnocking.schema'

@Controller('door-knocking')
export class DoorKnockingController {
  constructor(private readonly doorKnockingService: DoorKnockingService) {}

  @Post('evaluate')
  evaluate(@Body() dto: DoorKnockingEvaluateDTO) {
    return this.doorKnockingService.evaluate(dto)
  }

  @Post('residents')
  residents(@Body() dto: DoorKnockingResidentsDTO) {
    return this.doorKnockingService.residents(dto)
  }
}
