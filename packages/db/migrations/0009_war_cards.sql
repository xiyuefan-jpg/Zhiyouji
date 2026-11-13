CREATE TABLE "war_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"offered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen" text,
	"chosen_by" text,
	"chosen_at" timestamp with time zone,
	"received" text,
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "war_cards" ADD CONSTRAINT "war_cards_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "war_cards" ADD CONSTRAINT "war_cards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "war_cards_team" ON "war_cards" USING btree ("server_id","week","team_id");