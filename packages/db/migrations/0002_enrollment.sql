CREATE TABLE "season_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"enabled_by" text NOT NULL,
	"enabled_at" timestamp with time zone NOT NULL,
	"payment_note" text,
	"revoked_by" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "children" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "grouping" jsonb;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "grouping_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "prompts" jsonb;--> statement-breakpoint
ALTER TABLE "season_players" ADD CONSTRAINT "season_players_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_players" ADD CONSTRAINT "season_players_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_players_season_child" ON "season_players" USING btree ("season_id","child_id");--> statement-breakpoint
CREATE INDEX "season_players_child" ON "season_players" USING btree ("child_id");