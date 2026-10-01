import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { UserId } from "../../_kernel/brandedIds.ts";

@Injectable()
export class AdminConfirmationRepository {
  audit(tx: PoolClient, input: { readonly actorId: UserId; readonly targetId: UserId; readonly action: string; readonly details: Readonly<Record<string, unknown>> }): Promise<unknown> {
    return tx.query(
      `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       values($1,$2,$3,'user',$4,$5::jsonb,now())`,
      [randomUUID(), input.actorId, input.action, input.targetId, JSON.stringify(input.details)],
    );
  }
}
