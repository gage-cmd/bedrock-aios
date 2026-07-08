import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ExecutiveOversightService,
  ReportListItem,
  WeeklyReportRow,
} from './executive-oversight.service';

// Internal, read-only dashboard routes. Both are guarded by the tenant JWT
// (TenantResolverMiddleware) like every non-excluded route -- Executive
// Oversight has NO public/unauthenticated endpoint. The service also filters
// by tenant_id and Postgres RLS enforces it a second time.
@Controller('executive-oversight')
export class ExecutiveOversightController {
  constructor(private readonly service: ExecutiveOversightService) {}

  @Get('reports')
  listReports(@Req() req: Request): Promise<ReportListItem[]> {
    return this.service.listReports(req.tenantContext!.tenantId);
  }

  @Get('reports/:id')
  async getReport(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<WeeklyReportRow> {
    const report = await this.service.getReport(
      req.tenantContext!.tenantId,
      id,
    );
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }
}
