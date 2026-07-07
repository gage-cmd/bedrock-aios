import { Module } from '@nestjs/common';
import { ModuleManifestController } from './module-manifest.controller';
import { ModuleRegistryService } from './module-registry.service';

@Module({
  controllers: [ModuleManifestController],
  providers: [ModuleRegistryService],
  exports: [ModuleRegistryService],
})
export class ModuleRegistryModule {}
