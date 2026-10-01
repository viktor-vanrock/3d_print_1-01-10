import { RuntimeConfigurationError } from "./config/runtime-config.ts";

async function main(): Promise<void> {
  const { startNestApp } = await import("./bootstrap.ts");
  await startNestApp();
}

void main().catch((error: unknown) => {
  console.error(error instanceof RuntimeConfigurationError ? `api startup failed: ${error.message}` : "api startup failed: unexpected startup error");
  process.exitCode = 1;
});
