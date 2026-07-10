import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AvailableNumber } from '../../shared/messaging/sms-client.interface';
import { AdminGuard } from '../auth/admin.guard';
import {
  DuplicateTenantNameError,
  OnboardingService,
} from './onboarding.service';
import type {
  AvailableModule,
  CreatedTenant,
  CreateTenantInput,
  OnboardingState,
  OnboardingTenantSummary,
} from './onboarding.service';

// The Onboarding Console's entire backend surface. Guarded at the controller
// level so every route -- current and future -- in this group is platform-
// admin only; there is no per-route opt-in to forget. These routes are
// excluded from TenantResolverMiddleware in AppModule (an admin token carries
// no tenant_id claim and would be rejected there); AdminGuard is the sole and
// sufficient authorization boundary here, and it rejects tenant-scoped tokens
// outright.
//
// Expected errors from the service are surfaced as 400s with their message
// (same rationale as MissedCallTextbackController): the console needs to show
// the operator why a step failed, not an opaque 500.
@Controller('admin/onboarding')
@UseGuards(AdminGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  // The resume list: tenants still mid-onboarding, so an interrupted setup is
  // continued from the correct step instead of re-created.
  @Get('tenants')
  listOnboardingTenants(): Promise<OnboardingTenantSummary[]> {
    return this.wrap(() => this.onboarding.listOnboardingTenants());
  }

  // STEP 2 -- create the tenant (status 'onboarding'). A same-name tenant is
  // answered 409 with { code: 'duplicate_name' } (not a generic 400) so the
  // console can offer resume-or-confirm; every other failure stays a 400.
  @Post('tenants')
  async createTenant(@Body() body: CreateTenantInput): Promise<CreatedTenant> {
    try {
      return await this.onboarding.createTenant(body);
    } catch (err) {
      if (err instanceof DuplicateTenantNameError) {
        throw new ConflictException({
          code: 'duplicate_name',
          message: err.message,
          name: err.tenantName,
        });
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Request failed',
      );
    }
  }

  // STEP 3 -- what can be enabled, straight from the module registry.
  @Get('modules')
  listModules(): Promise<AvailableModule[]> {
    return this.onboarding.listAvailableModules();
  }

  // STEP 3 -- enable the selected modules for the tenant.
  @Post('tenants/:tenantId/modules')
  async enableModules(
    @Param('tenantId') tenantId: string,
    @Body() body: { moduleKeys: string[] },
  ): Promise<{ enabled: string[] }> {
    if (!Array.isArray(body.moduleKeys)) {
      throw new BadRequestException('moduleKeys must be an array');
    }
    await this.wrap(() =>
      this.onboarding.enableModules(tenantId, body.moduleKeys),
    );
    return { enabled: body.moduleKeys };
  }

  // STEP 4 -- save one module's settings where that module reads them.
  @Put('tenants/:tenantId/modules/:moduleKey/config')
  async saveModuleConfig(
    @Param('tenantId') tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: { config: Record<string, unknown> },
  ): Promise<{ saved: true }> {
    if (body.config === null || typeof body.config !== 'object') {
      throw new BadRequestException('config must be an object');
    }
    await this.wrap(() =>
      this.onboarding.saveModuleConfig(tenantId, moduleKey, body.config),
    );
    return { saved: true };
  }

  // STEP 5 (search) -- available local numbers for an area code. Read-only,
  // buys nothing; lets the admin pick a number local to the client.
  @Get('tenants/:tenantId/numbers')
  searchNumbers(
    @Param('tenantId') _tenantId: string,
    @Query('areaCode') areaCode: string,
  ): Promise<AvailableNumber[]> {
    return this.wrap(() => this.onboarding.searchNumbers(areaCode));
  }

  // STEP 5 (purchase) -- buy the selected number and make it the default. The
  // console always selects a number from the search first, so phoneNumber is
  // required here; this is the irreversible, deliberate purchase.
  @Post('tenants/:tenantId/number')
  provisionNumber(
    @Param('tenantId') tenantId: string,
    @Body() body: { phoneNumber?: string },
  ) {
    if (!body.phoneNumber) {
      throw new BadRequestException(
        'phoneNumber is required -- search and select a local number first',
      );
    }
    return this.wrap(() =>
      this.onboarding.provisionNumber(tenantId, body.phoneNumber),
    );
  }

  // STEP 6 -- invite the client's first user as owner.
  @Post('tenants/:tenantId/invite')
  inviteOwner(
    @Param('tenantId') tenantId: string,
    @Body() body: { email: string },
  ) {
    return this.wrap(() => this.onboarding.inviteOwner(tenantId, body.email));
  }

  // STEP 8 -- everything the confirmation summary shows.
  @Get('tenants/:tenantId/state')
  getState(@Param('tenantId') tenantId: string): Promise<OnboardingState> {
    return this.wrap(() => this.onboarding.getState(tenantId));
  }

  // STEP 7 -- the confirmed activation.
  @Post('tenants/:tenantId/activate')
  activate(@Param('tenantId') tenantId: string) {
    return this.wrap(() => this.onboarding.activate(tenantId));
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Request failed',
      );
    }
  }
}
