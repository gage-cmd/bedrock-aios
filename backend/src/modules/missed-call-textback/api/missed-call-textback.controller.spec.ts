/**
 * Unit test of the HTTP surface the dashboard calls (client lib ->
 * /modules/missed-call-textback/actions and the GET endpoints). The service
 * is mocked, so no database is touched: this covers only the controller's own
 * job -- pull the tenant id off req.tenantContext, dispatch, and translate an
 * expected service Error into a 400 whose message the dashboard can surface.
 */
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { MissedCallTextbackController } from './missed-call-textback.controller';
import { MissedCallTextbackService } from '../missed-call-textback.service';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';

function reqForTenant(tenantId: string): Request {
  return { tenantContext: { tenantId, role: 'owner' } } as unknown as Request;
}

describe('MissedCallTextbackController', () => {
  let controller: MissedCallTextbackController;
  let service: jest.Mocked<
    Pick<
      MissedCallTextbackService,
      'handleRequest' | 'getSnapshot' | 'getStatus' | 'getCapabilities'
    >
  >;

  beforeEach(() => {
    service = {
      handleRequest: jest.fn(),
      getSnapshot: jest.fn(),
      getStatus: jest.fn(),
      getCapabilities: jest.fn(),
    };
    controller = new MissedCallTextbackController(
      service as unknown as MissedCallTextbackService,
    );
  });

  describe('handleAction', () => {
    it('dispatches to the service with the tenant id from the request context', async () => {
      const rows = [{ id: 'a' }];
      service.handleRequest.mockResolvedValue(rows);

      const result = await controller.handleAction(reqForTenant(TENANT_ID), {
        intent: 'get-recent-missed-calls',
        payload: { limit: 5 },
      });

      expect(service.handleRequest).toHaveBeenCalledWith(
        TENANT_ID,
        'get-recent-missed-calls',
        { limit: 5 },
      );
      expect(result).toBe(rows);
    });

    it('wraps an expected service Error in a 400 that preserves the message', async () => {
      service.handleRequest.mockRejectedValue(
        new Error('Unknown missed-call-textback intent: bogus'),
      );

      await expect(
        controller.handleAction(reqForTenant(TENANT_ID), { intent: 'bogus' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        controller.handleAction(reqForTenant(TENANT_ID), { intent: 'bogus' }),
      ).rejects.toThrow('Unknown missed-call-textback intent: bogus');
    });

    it('falls back to a generic message when a non-Error is thrown', async () => {
      service.handleRequest.mockRejectedValue('boom');

      await expect(
        controller.handleAction(reqForTenant(TENANT_ID), { intent: 'x' }),
      ).rejects.toThrow('Request failed');
    });
  });

  describe('read endpoints', () => {
    it('getSnapshot delegates to the service for the current tenant', async () => {
      const snapshot = {
        metric: 'Missed calls recovered this week',
        value: '3 text-backs sent',
      };
      service.getSnapshot.mockResolvedValue(snapshot);

      await expect(
        controller.getSnapshot(reqForTenant(TENANT_ID)),
      ).resolves.toBe(snapshot);
      expect(service.getSnapshot).toHaveBeenCalledWith(TENANT_ID);
    });

    it('getStatus delegates to the service for the current tenant', async () => {
      const status = { status: 'connected' as const };
      service.getStatus.mockResolvedValue(status);

      await expect(controller.getStatus(reqForTenant(TENANT_ID))).resolves.toBe(
        status,
      );
      expect(service.getStatus).toHaveBeenCalledWith(TENANT_ID);
    });

    it('getCapabilities returns the static list without needing a tenant', () => {
      const caps = ['How many missed calls did we recover this week'];
      service.getCapabilities.mockReturnValue(caps);

      expect(controller.getCapabilities()).toBe(caps);
      expect(service.getCapabilities).toHaveBeenCalledTimes(1);
    });
  });
});
