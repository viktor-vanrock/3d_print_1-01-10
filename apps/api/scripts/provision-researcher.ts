// MF-1574: безопасное провижининг service account для исследовательского API.
// Секрет приходит только через окружение и никогда не печатается/не сохраняется в репозитории.
// Перед запуском на целевой БД миграции должны быть применены обычным dbmate deploy-контуром.

import { createResearchApiKeyHash, parseResearchApiKey } from "../src/modules/publicapi/public/operations.ts";
import { pool } from "../src/db/client.ts";
import { assertExplicitOperationalTarget } from "./dev-seed-guard.ts";
import { validateResearcherApiKey } from "./researcher-api-key.ts";

const USERNAME = "researcher-creality";
const DISPLAY_NAME = "Researcher Creality";

function requiredSecret(): string {
  return validateResearcherApiKey(process.env.RESEARCHER_API_KEY);
}

async function run(): Promise<void> {
  const secret = requiredSecret();
  await assertExplicitOperationalTarget(pool, "provision researcher", "PROVISION_RESEARCHER_DB_NAME");
  const parsed = parseResearchApiKey(secret);
  if (!parsed) throw new Error("Invalid RESEARCHER_API_KEY");
  const keyPrefix = parsed.publicId;
  const keyHash = await createResearchApiKeyHash(secret);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existing = await client.query<{ id: string; role: string; status: string }>(`select id, role, status from users where username = $1 for update`, [USERNAME]);

    let userId: string;
    if (existing.rows[0]) {
      if (existing.rows[0].role !== "researcher") {
        throw new Error(`учётная запись ${USERNAME} уже существует с ролью ${existing.rows[0].role}; возвышение запрещено`);
      }
      userId = existing.rows[0].id;
      await client.query(`update users set status = 'active', updated_at = now() where id = $1`, [userId]);
    } else {
      const created = await client.query<{ id: string }>(
        `insert into users (username, display_name, status, handle_confirmed, role)
         values ($1, $2, 'active', true, 'researcher') returning id`,
        [USERNAME, DISPLAY_NAME],
      );
      const createdUser = created.rows[0];
      if (!createdUser) throw new Error("Researcher account creation returned no user");
      userId = createdUser.id;
    }

    await client.query(
      `insert into user_api_keys (
         user_id, scope, scopes, label, key_prefix, key_hash, status, revoked_at, revoked_reason, expires_at, updated_at
       ) values ($1, 'research', array['write']::text[], $2, $3, $4, 'active', null, null, null, now())
       on conflict (user_id) where scope = 'research' do nothing`,
      [userId, "${USERNAME} POST /research/printers", keyPrefix, keyHash],
    );

    await client.query(
      `with created as (
         insert into permission_grants(user_id,permission,scope,granted_by,reason)
         select $1,'research.manage_printers','{"kind":"global"}'::jsonb,$1,'researcher service account provisioning'
         where not exists (
           select 1 from permission_grants
            where user_id=$1 and permission='research.manage_printers' and scope='{"kind":"global"}'::jsonb
              and revoked_at is null and (expires_at is null or expires_at>now())
         )
         returning id
       )
       insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       select gen_random_uuid(),$1,'permission.granted','permission_grant',id,
              jsonb_build_object('permission','research.manage_printers'),now()
         from created`,
      [userId],
    );

    await client.query("commit");
    console.log(`provision researcher: account=${USERNAME} role=researcher scope=research permission=research.manage_printers`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

run()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "provision researcher failed");
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
