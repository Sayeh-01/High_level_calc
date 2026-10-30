CREATE TABLE "leaves" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_day" text NOT NULL,
	"end_day" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"day" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"action_items" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standups" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"yesterday" text DEFAULT '' NOT NULL,
	"today" text NOT NULL,
	"blockers" text DEFAULT '' NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "standups_group_id_user_id_day_pk" PRIMARY KEY("group_id","user_id","day")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "stage" text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;