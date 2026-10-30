CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"subject_id" text NOT NULL,
	"plan" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"granted_by" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entitlements_subject_idx" ON "entitlements" USING btree ("scope","subject_id");