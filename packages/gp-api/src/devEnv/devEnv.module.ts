import { Module } from '@nestjs/common'
import { DevEnvController } from './devEnv.controller'
import { GithubOrgMemberGuard } from './guards/GithubOrgMember.guard'
import { DevEnvService } from './services/devEnv.service'

@Module({
  controllers: [DevEnvController],
  providers: [DevEnvService, GithubOrgMemberGuard],
})
export class DevEnvModule {}
