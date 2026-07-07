"use client";

import { useEffect, useState } from "react";
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
// in the Phase 1 shell.
export function useCurrentTenant() {
  const [tenant, setTenant] = useState<CurrentTenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (active) setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("users")
        .select("tenant_id, role, tenants(name, status)")
        .eq("id", user.id)
        .single<UsersRow>();

      if (!active) return;

      if (data) {
        setTenant({
          tenantId: data.tenant_id,
          tenantName: data.tenants?.name ?? "",
          tenantStatus: data.tenants?.status ?? "",
          role: data.role,
        });
      }
      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return { tenant, loading };
}
