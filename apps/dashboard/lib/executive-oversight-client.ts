import { supabase } from "@/lib/supabase/client";

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

async function backendGet<T>(path: string): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not signed in");
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

export function listReports(): Promise<ReportListItem[]> {
  return backendGet<ReportListItem[]>("/executive-oversight/reports");
}

export function getReport(id: string): Promise<WeeklyReport> {
  return backendGet<WeeklyReport>(`/executive-oversight/reports/${id}`);
}
