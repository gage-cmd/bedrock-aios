import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  EnabledModule,
  ModuleRegistryService,
} from './module-registry.service';

@Controller('module-manifest')
export class ModuleManifestController {
  constructor(private readonly moduleRegistry: ModuleRegistryService) {}

  @Get()
  getEnabledModules(@Req() req: Request): Promise<EnabledModule[]> {
    return this.moduleRegistry.getEnabledModules(req.tenantContext!.tenantId);
  }
}
