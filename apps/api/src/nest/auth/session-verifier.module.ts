import { Global, Module } from "@nestjs/common";
import { RuntimeLogger } from "../observability/runtime-logger.ts";
import { SessionVerifier } from "./session-verifier.ts";
import { AuthModule } from "../../modules/auth/auth.module.ts";

@Global()
@Module({
  imports: [AuthModule],
  providers: [RuntimeLogger, SessionVerifier],
  exports: [SessionVerifier],
})
export class SessionVerifierModule {}
