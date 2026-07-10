import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ModuleManifestController } from './module-manifest.controller';
import { ModuleRegistryService } from './module-registry.service';

// Unit-level proof of the settings write path's authorization: owner-only is
// enforced HERE (server-side), not just by a disabled input in the dashboard.
// The DB-level lockdown is proven separately in module-manifest-rls.spec.ts;
// the schema-validation itself in onboarding-validation.spec.ts. This test owns
// the controller's own decisions: who may write, and that it delegates to the
// single validated registry path rather than writing config itself.
describe('ModuleManifestController settings write authorization', () => {
  let registry: jest.Mocked<
    Pick<
      ModuleRegistryService,
      | 'saveModuleConfig'
      | 'getModuleSettings'
      | 'getEnabledModules'
      | 'getModuleMetadata'
    >
  >;
  let controller: ModuleManifestController;

  const tenantId = 'tenant-123';

  function reqWithRole(role: string): Request {
    return { tenantContext: { tenantId, role } } as unknown as Request;
  }

  beforeEach(() => {
    registry = {
      saveModuleConfig: jest.fn().mockResolvedValue(undefined),
      getModuleSettings: jest.fn(),
      getEnabledModules: jest.fn(),
      getModuleMetadata: jest.fn(),
    };
    controller = new ModuleManifestController(
      registry as unknown as ModuleRegistryService,
    );
  });

  it('rejects a non-owner (staff) with 403 and never touches the write path', async () => {
    await expect(
      controller.saveModuleConfig(reqWithRole('staff'), 'review-generation', {
        config: { businessName: 'Acme' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(registry.saveModuleConfig).not.toHaveBeenCalled();
  });

  it('rejects a read_only member with 403 as well', async () => {
    await expect(
      controller.saveModuleConfig(
        reqWithRole('read_only'),
        'review-generation',
        {
          config: {},
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(registry.saveModuleConfig).not.toHaveBeenCalled();
  });

  it('rejects a non-object config body with 400', async () => {
    await expect(
      controller.saveModuleConfig(reqWithRole('owner'), 'review-generation', {
        config: null as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(registry.saveModuleConfig).not.toHaveBeenCalled();
  });

  it('an owner save delegates to the validated registry path with the context tenantId', async () => {
    const config = {
      businessName: 'Acme',
      googleReviewUrl: 'https://g.page/r/x',
    };
    const result = await controller.saveModuleConfig(
      reqWithRole('owner'),
      'review-generation',
      { config },
    );
    expect(registry.saveModuleConfig).toHaveBeenCalledWith(
      tenantId,
      'review-generation',
      config,
    );
    expect(result).toEqual({ saved: true });
  });

  it('surfaces a registry validation/registration error as a 400 with its message', async () => {
    registry.saveModuleConfig.mockRejectedValueOnce(
      new Error('Unknown module: not-a-real-module'),
    );
    await expect(
      controller.saveModuleConfig(reqWithRole('owner'), 'not-a-real-module', {
        config: {},
      }),
    ).rejects.toMatchObject({
      response: { message: 'Unknown module: not-a-real-module' },
    });
  });

  it('getModuleSettings reads for the context tenant (any signed-in member may view)', async () => {
    const settings = {
      schema: {},
      config: {},
      status: { status: 'connected' as const },
      enabled: true,
    };
    registry.getModuleSettings.mockResolvedValueOnce(settings);
    const result = await controller.getModuleSettings(
      reqWithRole('read_only'),
      'review-generation',
    );
    expect(registry.getModuleSettings).toHaveBeenCalledWith(
      tenantId,
      'review-generation',
    );
    expect(result).toBe(settings);
  });
});
