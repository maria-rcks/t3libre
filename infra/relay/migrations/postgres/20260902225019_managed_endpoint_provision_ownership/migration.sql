CREATE TABLE "relay_managed_endpoint_provision_claims" (
	"user_id" varchar(191),
	"environment_id" varchar(191),
	"claim_id" uuid NOT NULL,
	"expires_at" varchar(64) NOT NULL,
	"created_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_managed_endpoint_provision_claims_pkey" PRIMARY KEY("user_id","environment_id")
);
--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN "generation_id" uuid DEFAULT gen_random_uuid() NOT NULL;