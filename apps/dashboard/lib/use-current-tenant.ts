"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

export interface CurrentTenant {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  role: string;
}

interface UsersRow {
  tenant_id: string;
  role: string;
  tenants: { name: string; status: string } | null;
}

// Reads the logged-in user's own row (RLS-scoped to their tenant) joined
// with their tenant's basic info. Core-table-only, same as everything else
// in the Phase 1 shell. Returns the same { tenant, loading, error } shape it
// always has; the query cache just means one read per session instead of one
// per mounting component.
export function useCurrentTenant() {
  const { data, isPending, isError } = useQuery<CurrentTenant | null>({
    queryKey: ["current-tenant"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data, error } = await supabase
        .from("users")
        .select("tenant_id, role, tenants(name, status)")
        .eq("id", user.id)
        .single<UsersRow>();

      if (error || !data) throw new Error("Could not load tenant");

      return {
        tenantId: data.tenant_id,
        tenantName: data.tenants?.name ?? "",
        tenantStatus: data.tenants?.status ?? "",
        role: data.role,
      };
    },
  });

  return { tenant: data ?? null, loading: isPending, error: isError };
}
