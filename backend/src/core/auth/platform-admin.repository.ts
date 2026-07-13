import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { getSharedPool, closeSharedPool } from '../../shared/db/pg-pool';

// The single point that reads the platform_admins table. It connects with the
// pooler's default role (the same unrestricted connection every service uses),
// which bypasses RLS -- so it can check membership even though no tenant
// session can read the table at all (see migration 0015). Kept separate from
// AdminGuard so the guard's decision logic can be unit-tested without a
// database, and so nothing else ever learns how admin membership is stored.
@Injectable()
export class PlatformAdminRepository implements OnModuleDestroy {
  private readonly pool = getSharedPool();

  // True iff this Supabase Auth user id has a row in platform_admins. The
  // lookup is keyed ONLY on the user id -- never on a tenant_id -- because an
  // admin belongs to no tenant.
  async isPlatformAdmin(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'select 1 from platform_admins where user_id = $1 limit 1',
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  onModuleDestroy(): Promise<void> {
    return closeSharedPool();
  }
}
