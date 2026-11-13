CREATE TABLE "supply_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"supply_id" text NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"supply_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"submitted_members" integer NOT NULL,
	"quality" integer NOT NULL,
	"summary" integer NOT NULL,
	"model" text NOT NULL,
	"comment" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supply_entries" ADD CONSTRAINT "supply_entries_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_entries" ADD CONSTRAINT "supply_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_results" ADD CONSTRAINT "supply_results_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_results" ADD CONSTRAINT "supply_results_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_entries_team" ON "supply_entries" USING btree ("server_id","supply_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_results_team" ON "supply_results" USING btree ("server_id","supply_id","team_id");