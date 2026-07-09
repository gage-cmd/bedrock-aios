import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

// The Onboarding Console backend: platform-admin routes for standing up a new
// tenant end to end. AuthModule supplies AdminGuard (and its repository) for
// the controller-level guard; the registry supplies the dynamic module list;
// shared messaging owns number provisioning.
@Module({
  imports: [AuthModule, ModuleRegistryModule, MessagingModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
