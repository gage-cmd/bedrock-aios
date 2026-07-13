import { Pool } from 'pg';

// The one Postgres pool for the whole process. Nine services used to each
// construct a private Pool from the same five env vars -- nine pools of ten
// connections against the transaction pooler for one backend. Every service
// now takes this shared instance instead.
//
// Deliberately a lazy module-level singleton rather than a Nest provider:
// ~30 places across the spec suite construct services manually (no DI
// container), and a constructor-injected pool would break every one of them
// for no behavioral gain. Discrete connection fields, never a URL -- the
// password contains characters the pg URL parser chokes on (see CLAUDE.md).
let sharedPool: Pool | undefined;

export function getSharedPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
  }
  return sharedPool;
}

// Idempotent, and self-healing on purpose: the first caller ends the pool,
// later callers no-op, and any later getSharedPool() lazily creates a fresh
// one. That keeps existing spec teardowns (several services' onModuleDestroy
// called in sequence, sometimes mid-file) working unchanged.
export async function closeSharedPool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  if (pool) await pool.end();
}
