CREATE TABLE "asset_services" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"group_id" text NOT NULL,
	"day" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"service_every_days" integer,
	"last_service_day" text,
	"next_service_day" text,
	"vendor_contact_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"low_at" integer DEFAULT 0 NOT NULL,
	"low" boolean DEFAULT false NOT NULL,
	"vendor_user_id" text,
	"vendor_contact_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"group_id" text NOT NULL,
	"delta" integer NOT NULL,
	"after" integer NOT NULL,
	"reason" text,
	"user_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_services" ADD CONSTRAINT "asset_services_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD CONSTRAINT "inventory_moves_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_requests" ADD CONSTRAINT "spend_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;