CREATE TABLE "challenge_logs" (
	"challenge_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "challenge_logs_challenge_id_user_id_day_pk" PRIMARY KEY("challenge_id","user_id","day")
);
--> statement-breakpoint
CREATE TABLE "challenge_parts" (
	"challenge_id" text NOT NULL,
	"group_id" text NOT NULL,
	"round" integer NOT NULL,
	"part" integer NOT NULL,
	"user_id" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	CONSTRAINT "challenge_parts_challenge_id_round_part_pk" PRIMARY KEY("challenge_id","round","part")
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"total_parts" integer,
	"part_label" text,
	"member_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"auto_next" boolean DEFAULT true NOT NULL,
	"target" integer,
	"unit" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"signature" jsonb,
	"signed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"fields" jsonb NOT NULL,
	"require_signature" boolean DEFAULT false NOT NULL,
	"member_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "challenge_logs" ADD CONSTRAINT "challenge_logs_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_parts" ADD CONSTRAINT "challenge_parts_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_uq" ON "form_responses" USING btree ("form_id","user_id");