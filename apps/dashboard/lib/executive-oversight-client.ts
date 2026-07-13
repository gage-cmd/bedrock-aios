import { apiFetch } from "@/lib/api";

// executive_oversight lives in its own Postgres schema, not exposed via
// PostgREST -- reads go through the backend's tenant-JWT-guarded routes
// instead of a direct supabase.from() call (same pattern as the modules).

export interface ReportListItem {
  id: string;
  week_of: string;
  generated_at: string | null;
  status: string;
}

export interface ReportSections {
  performance_summary: string;
  wins: string;
  issues: string;
  opportunities: string;
  recommendations: string;
}

export interface WeeklyReport {
  id: string;
  week_of: string;
  generated_at: string | null;
  status: string;
  report_data: {
    weekOf?: string;
    sections?: ReportSections;
    model?: string;
    error?: string;
  };
}

export function listReports(): Promise<ReportListItem[]> {
  return apiFetch<ReportListItem[]>("/executive-oversight/reports");
}

export function getReport(id: string): Promise<WeeklyReport> {
  return apiFetch<WeeklyReport>(`/executive-oversight/reports/${id}`);
}
