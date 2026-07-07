import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ModuleManifestController } from './core/module-registry/module-manifest.controller';
import { ModuleRegistryModule } from './core/module-registry/module-registry.module';
import { TenantResolverMiddleware } from './core/tenant-resolver/tenant-resolver.middleware';

@Module({
  imports: [ModuleRegistryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantResolverMiddleware)
      .forRoutes(ModuleManifestController);
  }
}
