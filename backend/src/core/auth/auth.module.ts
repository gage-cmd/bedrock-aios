import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { PlatformAdminRepository } from './platform-admin.repository';

// The platform-admin authorization boundary. Provides AdminGuard (and the
// repository it depends on) so any future route group -- e.g. the onboarding
// console -- can protect itself with @UseGuards(AdminGuard) simply by
// importing this module. It registers no controllers and no middleware, so
// importing it changes no existing route's behaviour; it only makes the guard
// available where it is deliberately applied.
@Module({
  providers: [PlatformAdminRepository, AdminGuard],
  exports: [PlatformAdminRepository, AdminGuard],
})
export class AuthModule {}
