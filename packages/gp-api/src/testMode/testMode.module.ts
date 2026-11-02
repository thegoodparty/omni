import { ContactUploadFilesModule } from '@/contactUploads/contactUploadFiles.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { StateTransitionsModule } from '@/testFixtures/stateTransitions.module'
import { Module } from '@nestjs/common'
import { TestModeGuard } from './guards/TestMode.guard'
import { TestModeService } from './services/testMode.service'
import { TestModeController } from './testMode.controller'

@Module({
  imports: [
    ContactUploadFilesModule,
    OrganizationsModule,
    StateTransitionsModule,
  ],
  controllers: [TestModeController],
  providers: [TestModeService, TestModeGuard],
})
export class TestModeModule {}
