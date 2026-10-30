CREATE TABLE "gameya_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"gameya_id" text NOT NULL,
	"group_id" text NOT NULL,
	"position" integer NOT NULL,
	"payer_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text
);
--> statement-breakpoint
CREATE TABLE "gameya_slots" (
	"gameya_id" text NOT NULL,
	"group_id" text NOT NULL,
	"position" integer NOT NULL,
	"user_id" text NOT NULL,
	"received_at" timestamp with time zone,
	CONSTRAINT "gameya_slots_gameya_id_position_pk" PRIMARY KEY("gameya_id","position")
);
--> statement-breakpoint
CREATE TABLE "gameya_swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"gameya_id" text NOT NULL,
	"group_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"other_id" text NOT NULL,
	"other_accepted_at" timestamp with time zone,
	"organizer_id" text,
	"organizer_approved_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gameyas" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"start_month" text NOT NULL,
	"due_day" integer DEFAULT 1 NOT NULL,
	"order_mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"previous_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gameya_payments" ADD CONSTRAINT "gameya_payments_gameya_id_gameyas_id_fk" FOREIGN KEY ("gameya_id") REFERENCES "public"."gameyas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameya_slots" ADD CONSTRAINT "gameya_slots_gameya_id_gameyas_id_fk" FOREIGN KEY ("gameya_id") REFERENCES "public"."gameyas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameya_swaps" ADD CONSTRAINT "gameya_swaps_gameya_id_gameyas_id_fk" FOREIGN KEY ("gameya_id") REFERENCES "public"."gameyas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameyas" ADD CONSTRAINT "gameyas_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gameya_payments_uq" ON "gameya_payments" USING btree ("gameya_id","position","payer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gameya_slots_user_uq" ON "gameya_slots" USING btree ("gameya_id","user_id");