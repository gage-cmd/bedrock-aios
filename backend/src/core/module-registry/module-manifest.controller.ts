import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  EnabledModule,
  ModuleRegistryService,
  ModuleSettings,
} from './module-registry.service';

export interface EnabledModuleWithMetadata extends EnabledModule {
  name: string;
  description: string;
}

@Controller('module-manifest')
export class ModuleManifestController {
  constructor(private readonly moduleRegistry: ModuleRegistryService) {}

  // Enriches each enabled module with its display name/description (read
  // from config.json by moduleKey convention) so dashboard surfaces -- the
  // Installed Systems hub in particular -- never hardcode module names as
  // more modules ship.
  @Get()
  async getEnabledModules(
    @Req() req: Request,
  ): Promise<EnabledModuleWithMetadata[]> {
    const modules = await this.moduleRegistry.getEnabledModules(
      req.tenantContext!.tenantId,
    );

    return Promise.all(
      modules.map(async (m) => {
        const meta = await this.moduleRegistry.getModuleMetadata(m.moduleKey);
        return {
          ...m,
          name: meta?.name ?? m.moduleKey,
          description: meta?.description ?? '',
        };
      }),
    );
  }

  // One module's settings form payload -- schema, this tenant's current config,
  // enabled flag, and the module's own getStatus() verdict for the indicator.
  // Any signed-in tenant member may read (staff/read-only view the form
  // read-only, same as before); only the write below is owner-gated. tenantId
  // comes from the verified request context, never the client.
  @Get(':moduleKey/settings')
  getModuleSettings(
    @Req() req: Request,
    @Param('moduleKey') moduleKey: string,
  ): Promise<ModuleSettings> {
    return this.moduleRegistry.getModuleSettings(
      req.tenantContext!.tenantId,
      moduleKey,
    );
  }

  // The tenant dashboard's settings save. This route -- not a direct
  // supabase.from('module_manifest') write from the browser -- is now the only
  // way a tenant persists module config, and it enforces what the old
  // client-side write could not: owner-only (server-side, not just a disabled
  // input), the moduleKey being a registered module, and the payload validating
  // against that module's settings.schema.json. Direct table writes are revoked
  // from the `authenticated` role at the DB level (migration 0018), so this is a
  // real boundary, not a convention.
  @Put(':moduleKey/config')
  async saveModuleConfig(
    @Req() req: Request,
    @Param('moduleKey') moduleKey: string,
    @Body() body: { config: Record<string, unknown> },
  ): Promise<{ saved: true }> {
    if (req.tenantContext!.role !== 'owner') {
      throw new ForbiddenException(
        'Only account owners can change these settings',
      );
    }
    if (body.config === null || typeof body.config !== 'object') {
      throw new BadRequestException('config must be an object');
    }
    try {
      await this.moduleRegistry.saveModuleConfig(
        req.tenantContext!.tenantId,
        moduleKey,
        body.config,
      );
    } catch (err) {
      // saveModuleConfig throws plain Errors for expected failures (unknown
      // module, schema-validation message, module not enabled). Surface them as
      // 400s so the settings form can show the reason, not an opaque 500.
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Request failed',
      );
    }
    return { saved: true };
  }
}
