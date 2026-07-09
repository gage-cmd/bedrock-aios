import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './core/auth/auth.module';
import { ExecutiveOversightModule } from './core/executive-oversight/executive-oversight.module';
import { ModuleRegistryModule } from './core/module-registry/module-registry.module';
import { OnboardingModule } from './core/onboarding/onboarding.module';
import { OrchestratorModule } from './core/orchestrator/orchestrator.module';
import { TenantResolverMiddleware } from './core/tenant-resolver/tenant-resolver.middleware';
import { MissedCallTextbackModule } from './modules/missed-call-textback/missed-call-textback.module';
import { ReviewGenerationModule } from './modules/review-generation/review-generation.module';

@Module({
  imports: [
    AuthModule,
    OnboardingModule,
    ModuleRegistryModule,
    OrchestratorModule,
    ExecutiveOversightModule,
    ReviewGenerationModule,
    MissedCallTextbackModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantResolverMiddleware)
      // Deny-by-default: TenantResolverMiddleware guards EVERY route unless it
      // is explicitly listed below. A newly added route is authenticated
      // until someone deliberately opens it here, rather than exposed until
      // someone remembers to guard it. Anything added to this allow-list is a
      // conscious "this route is reachable without a tenant JWT" decision.
      .exclude(
        // The public review funnel (Step 6). Reachable by anyone with the
        // link; access is scoped entirely by the unguessable token, never a
        // tenant JWT. See PublicReviewController / PublicReviewService.
        { path: 'public/review/:token', method: RequestMethod.ALL },
        // Twilio Voice webhooks (Step 3). Machine-to-machine: called by
        // Twilio's infrastructure, never a browser with a JWT. They carry no
        // tenant token; authenticity is enforced instead by TwilioSignatureGuard
        // (X-Twilio-Signature verification) on VoiceController. Listed
        // explicitly here so they are a deliberate allow-list decision, not
        // reachable-by-omission.
        { path: 'public/voice/incoming', method: RequestMethod.POST },
        { path: 'public/voice/status', method: RequestMethod.POST },
        // Root health check -- unauthenticated by design (hosting hits it).
        { path: '/', method: RequestMethod.GET },
        // The Onboarding Console (Phase 5). NOT unauthenticated: these routes
        // are guarded by AdminGuard on OnboardingController instead. They are
        // excluded here because platform-admin tokens carry no tenant_id
        // claim, so TenantResolverMiddleware would reject every admin request
        // before the guard ever ran. Tenant tokens die inside AdminGuard
        // (rejected outright for carrying tenant_id), so excluding the routes
        // from tenant middleware opens nothing to tenant users.
        { path: 'admin/onboarding', method: RequestMethod.ALL },
        { path: 'admin/onboarding/{*splat}', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
