ALTER TABLE "relay_environment_links" ADD COLUMN "temporary_lease_id" varchar(191);--> statement-breakpoint
ALTER TABLE "relay_environment_links" ADD COLUMN "temporary_lease_expires_at" varchar(64);--> statement-breakpoint
CREATE INDEX "idx_relay_environment_links_temporary_expiry" ON "relay_environment_links" ("temporary_lease_expires_at");