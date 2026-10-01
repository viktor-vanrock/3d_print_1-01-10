import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { PermissionsService } from "../../permissions/application/permissions.service.ts";
import { PermissionGuard } from "../../permissions/guards/permission.guard.ts";
import { Permissions } from "../../permissions/public/index.ts";
import { FEED_AGENT_AUTH_PORT } from "../../feed/public/index.ts";
import { MaterialAdminService } from "../application/material-admin.service.ts";
import { MaterialAdminController } from "./material-admin.controller.ts";

const allowedPermissions = new Set<Permissions>();
const session = { id: "00000000-0000-4000-8000-000000000001", username: "admin", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };
const materials = {
  list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0, has_more: false }),
  options: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(),
  publish: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002", version: 2 }),
  restore: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002", version: 2 }),
  archive: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002", version: 2 }),
};

@Global()
@Module({ providers: [
  { provide: SessionVerifier, useValue: { readSession: (request: { headers: { authorization?: string } }) => Promise.resolve(request.headers.authorization === "Bearer valid" ? session : null) } },
  { provide: PermissionsService, useValue: { hasPermission: (_userId: string, permission: Permissions) => Promise.resolve(allowedPermissions.has(permission)), isActiveUser: () => Promise.resolve(true) } },
  { provide: FEED_AGENT_AUTH_PORT, useValue: { verifyAgentContentToken: () => Promise.resolve(null) } },
  { provide: MaterialAdminService, useValue: materials },
], exports: [SessionVerifier, PermissionsService, FEED_AGENT_AUTH_PORT, MaterialAdminService] })
class MaterialAdminTestPortsModule {}

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MaterialAdminTestPortsModule], controllers: [MaterialAdminController], providers: [
  { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
] })
class MaterialAdminTestModule {}

describe("Material admin HTTP contract", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => {
    app = await createNestApp(MaterialAdminTestModule);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => app.close());
  beforeEach(() => { allowedPermissions.clear(); vi.clearAllMocks(); });

  it("возвращает 401 без сессии и 403 без catalog.edit_any", async () => {
    expect((await fetch(`${baseUrl}/data/materials`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/data/materials`, { headers: { authorization: "Bearer valid" } })).status).toBe(403);
  });

  it.each([
    { path: "publish", method: "publish", permission: Permissions.CATALOG_PUBLISH_ANY },
    { path: "restore", method: "restore", permission: Permissions.CATALOG_EDIT_ANY },
    { path: "archive", method: "archive", permission: Permissions.CATALOG_UNPUBLISH_ANY },
  ] as const)("маршрутизирует lifecycle-команду $method только с нужным permission", async ({ path, method, permission }) => {
    allowedPermissions.add(Permissions.CATALOG_EDIT_ANY);
    allowedPermissions.add(permission);
    const response = await fetch(`${baseUrl}/data/materials/00000000-0000-4000-8000-000000000002/${path}`, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(response.status).toBe(200);
    expect(materials[method]).toHaveBeenCalledWith(session.id, "00000000-0000-4000-8000-000000000002", 1);
  });

  it.each([
    { path: "publish", method: "publish" },
    { path: "archive", method: "archive" },
  ] as const)(`${Permissions.CATALOG_EDIT_ANY} не разрешает $method`, async ({ path, method }) => {
    allowedPermissions.add(Permissions.CATALOG_EDIT_ANY);
    const response = await fetch(`${baseUrl}/data/materials/00000000-0000-4000-8000-000000000002/${path}`, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(response.status).toBe(403);
    expect(materials[method]).not.toHaveBeenCalled();
  });

  it.each([
    { path: "publish", permission: Permissions.CATALOG_PUBLISH_ANY },
    { path: "archive", permission: Permissions.CATALOG_UNPUBLISH_ANY },
  ])("lifecycle permission без catalog.edit_any не даёт изменить скрытую карточку", async ({ path, permission }) => {
    allowedPermissions.add(permission);
    const response = await fetch(`${baseUrl}/data/materials/00000000-0000-4000-8000-000000000002/${path}`, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(response.status).toBe(403);
  });
});
