import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolveAdminBootstrapConfig } from "../../../nest/config/runtime-config.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { PermissionsService } from "../../permissions/public/index.ts";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId } from "../../_kernel/brandedIds.ts";

const SUPERADMIN_BOOTSTRAP_LOCK = "auth.superadmin-bootstrap.v1";

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const admin = resolveAdminBootstrapConfig({
      NODE_ENV: this.config.get("NODE_ENV"),
      ADMIN_USERNAME: this.config.get("ADMIN_USERNAME"),
      ADMIN_PASSWORD: this.config.get("ADMIN_PASSWORD"),
    });
    if (admin === null) return;

    const client = await this.pool.connect();
    let grants: { readonly created: number; readonly skipped: number } = { created: 0, skipped: 0 };
    let events: readonly string[] = [];
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [SUPERADMIN_BOOTSTRAP_LOCK]);
      const externalStateEstablished =
        await this.repository.hasAnyPasswordCredentialsInTransaction(client)
        || await this.permissions.hasAnyPermissionGrantsInTransaction(client);
      const identity = await this.repository.resolveSuperadminIdentityInTransaction(client, {
        username: admin.username,
        externalStateEstablished,
      });
      const userId = UserId(identity.id);
      if (identity.bindingMode === "existing_installation") {
        const credential = await this.repository.passwordMatchesInTransaction(client, userId, admin.password);
        const permissionEvidence = await this.permissions.hasCompleteBootstrapEvidenceInTransaction(client, userId);
        if (!credential || !permissionEvidence) throw new Error("Existing Superadmin binding evidence is incomplete");
        await this.repository.bindExistingSuperadminIdentityInTransaction(client, userId);
      }
      const account = await this.repository.recoverSuperadminInTransaction(client, {
        userId,
        password: admin.password,
      });
      grants = await this.permissions.ensureBootstrapAdminPermissionsInTransaction(client, userId);
      const recordedEvents: string[] = [];
      if (identity.bindingCreated || identity.bindingMode === "existing_installation") recordedEvents.push("superadmin.identity.bound");
      if (identity.accountCreated) recordedEvents.push("superadmin.account.created");
      if (account.passwordCreated) recordedEvents.push("superadmin.credential.created");
      if (account.passwordRotated) recordedEvents.push("superadmin.credential.rotated");
      if (account.accountRecovered) recordedEvents.push("superadmin.account.recovered");
      events = recordedEvents;
      await this.permissions.recordSuperadminBootstrapEventsInTransaction(client, userId, events);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    this.logger.info(
      { event: "auth.admin_bootstrap", outcome: "success", reason: `${events.length === 0 && grants.created === 0 ? "no_op" : events.join(",") || "permissions_repaired"}; permissions created=${grants.created}, skipped=${grants.skipped}` },
      "Superadmin is ready",
    );
  }
}
