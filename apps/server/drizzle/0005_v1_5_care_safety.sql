CREATE TABLE "emergency_cards" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"data" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_cards_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "med_doses" (
	"id" text PRIMARY KEY NOT NULL,
	"med_id" text NOT NULL,
	"group_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"given_at" timestamp with time zone,
	"given_by" text,
	"skipped" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meds" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"patient_name" text NOT NULL,
	"name" text NOT NULL,
	"dose" text DEFAULT '' NOT NULL,
	"times" text[] NOT NULL,
	"start_on" text NOT NULL,
	"end_on" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"title" text NOT NULL,
	"file_id" text,
	"expires_on" text,
	"notes" text,
	"ocr_text" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"access" text DEFAULT 'all' NOT NULL,
	"member_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "emergency_cards" ADD CONSTRAINT "emergency_cards_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "med_doses" ADD CONSTRAINT "med_doses_med_id_meds_id_fk" FOREIGN KEY ("med_id") REFERENCES "public"."meds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meds" ADD CONSTRAINT "meds_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_docs" ADD CONSTRAINT "vault_docs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_docs" ADD CONSTRAINT "vault_docs_folder_id_vault_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."vault_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "med_doses_med_time_uq" ON "med_doses" USING btree ("med_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "vault_docs_folder_idx" ON "vault_docs" USING btree ("folder_id");