import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { RuntimeLogger } from "../../nest/observability/runtime-logger.ts";
import { AuthController } from "./api/auth.controller.ts";
import { AuthService } from "./application/auth.service.ts";
import { AdminBootstrapService } from "./application/admin-bootstrap.service.ts";
import { AuthSessionService } from "./application/session.service.ts";
import { AuthRepository } from "./infrastructure/auth.repository.ts";
import { OtpEmailAdapter } from "./infrastructure/email.adapter.ts";
import { IdentityStorageAdapter } from "./infrastructure/identity-storage.adapter.ts";
import { AUTH_IDENTITY_LOOKUP_PORT, AUTH_IDENTITY_READ_PORT } from "./domain/identity-identifier.ts";
import { PermissionsModule } from "../permissions/public/index.ts";
import { AUTH_STEP_UP_PORT, AuthStepUpService, PASSWORD_CREDENTIAL_READER } from "./application/auth-step-up.service.ts";
import { AUTH_SESSION_REGISTRY_PORT } from "./application/session.service.ts";

@Global()
@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [AuthController],
  providers: [
    RuntimeLogger,
    AuthRepository,
    OtpEmailAdapter,
    IdentityStorageAdapter,
    AuthService,
    AdminBootstrapService,
    AuthSessionService,
    AuthStepUpService,
    { provide: PASSWORD_CREDENTIAL_READER, useExisting: AuthRepository },
    { provide: AUTH_STEP_UP_PORT, useExisting: AuthStepUpService },
    { provide: AUTH_IDENTITY_READ_PORT, useExisting: AuthRepository },
    { provide: AUTH_IDENTITY_LOOKUP_PORT, useExisting: AuthRepository },
    { provide: AUTH_SESSION_REGISTRY_PORT, useExisting: AuthRepository },
  ],
  exports: [AUTH_IDENTITY_LOOKUP_PORT, AUTH_IDENTITY_READ_PORT, AUTH_SESSION_REGISTRY_PORT, AUTH_STEP_UP_PORT],
})
export class AuthModule {}
