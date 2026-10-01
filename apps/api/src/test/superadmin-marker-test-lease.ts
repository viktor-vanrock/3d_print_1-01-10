import type { Pool } from "pg";

const SUPERADMIN_MARKER_TEST_LOCK = 7_213_409_117;

export async function acquireSuperadminMarkerTestLease(pool: Pool): Promise<() => Promise<void>> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query("select pg_advisory_lock($1)", [SUPERADMIN_MARKER_TEST_LOCK]);
  } catch (error) {
    client.release();
    throw error;
  }
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("select pg_advisory_unlock($1)", [SUPERADMIN_MARKER_TEST_LOCK]);
    } finally {
      client.release();
    }
  };
}
