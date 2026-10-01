import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { DatabaseLifecycle } from "./database-lifecycle.service.ts";
import { DATABASE_POOL } from "./database.constants.ts";
import { StatusNotificationsService } from "./status-notifications.service.ts";
import { RuntimeLogger } from "../observability/runtime-logger.ts";

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool =>
        new Pool({
          connectionString: config.get<string>("DATABASE_URL"),
        }),
    },
    DatabaseLifecycle,
    RuntimeLogger,
    StatusNotificationsService,
  ],
  exports: [DATABASE_POOL, StatusNotificationsService],
})
export class DatabaseModule {}
