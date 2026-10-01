import { Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { verifyPassword } from "../infrastructure/password-hash.ts";

export const AUTH_STEP_UP_PORT = Symbol("AUTH_STEP_UP_PORT");
export const PASSWORD_CREDENTIAL_READER = Symbol("PASSWORD_CREDENTIAL_READER");

export interface AuthStepUpPort {
  verifyPassword(userId: UserId, password: string): Promise<boolean>;
}

export interface PasswordCredentialReader {
  findPasswordHashByUserId(userId: UserId): Promise<string | null>;
}

@Injectable()
export class AuthStepUpService implements AuthStepUpPort {
  constructor(@Inject(PASSWORD_CREDENTIAL_READER) private readonly credentials: PasswordCredentialReader) {}

  async verifyPassword(userId: UserId, password: string): Promise<boolean> {
    if (password === "" || password.length > 1024) return false;
    const hash = await this.credentials.findPasswordHashByUserId(userId);
    return hash === null ? false : verifyPassword(password, hash);
  }
}
