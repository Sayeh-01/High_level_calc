CREATE TABLE "calendar_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "calendar_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "guest_links" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"token" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "guest_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "calendar_tokens" ADD CONSTRAINT "calendar_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;