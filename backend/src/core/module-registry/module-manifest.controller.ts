import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  EnabledModule,
  ModuleRegistryService,
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
}
