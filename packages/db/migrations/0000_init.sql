CREATE TABLE "allocation_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"round" text NOT NULL,
	"team_id" uuid NOT NULL,
	"bid" integer,
	"prefs" jsonb NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"day" date PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"event_seq" integer NOT NULL,
	"kind" text NOT NULL,
	"broadcast" boolean NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grain_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" text NOT NULL,
	"server_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"source" text NOT NULL,
	"ref_id" text,
	"note" text,
	"at" timestamp with time zone NOT NULL,
	"reverses" text,
	"param_version" integer NOT NULL,
	"event_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"template_id" text
);
--> statement-breakpoint
CREATE TABLE "op_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"object" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "param_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "planned_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"done_at" timestamp with time zone,
	"shiftable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" text NOT NULL,
	"server_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"source" text NOT NULL,
	"ref_id" text,
	"note" text,
	"at" timestamp with time zone NOT NULL,
	"reverses" text,
	"param_version" integer NOT NULL,
	"event_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "season_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"server_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"param_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opening_date" date NOT NULL,
	"seed" integer NOT NULL,
	"current_param_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"child_id" text NOT NULL,
	"grade" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_note" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qr_image" text,
	"qr_uploaded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "allocation_submissions" ADD CONSTRAINT "allocation_submissions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_submissions" ADD CONSTRAINT "allocation_submissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed" ADD CONSTRAINT "feed_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grain_ledger" ADD CONSTRAINT "grain_ledger_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grain_ledger" ADD CONSTRAINT "grain_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lands" ADD CONSTRAINT "lands_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "param_versions" ADD CONSTRAINT "param_versions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_events" ADD CONSTRAINT "season_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_snapshots" ADD CONSTRAINT "season_snapshots_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_submissions_round_team" ON "allocation_submissions" USING btree ("server_id","round","team_id");--> statement-breakpoint
CREATE INDEX "feed_server_at" ON "feed" USING btree ("server_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "grain_ledger_entry" ON "grain_ledger" USING btree ("server_id","entry_id");--> statement-breakpoint
CREATE INDEX "grain_ledger_team" ON "grain_ledger" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "param_versions_season_version" ON "param_versions" USING btree ("season_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_events_server_key" ON "planned_events" USING btree ("server_id","key");--> statement-breakpoint
CREATE INDEX "planned_events_due" ON "planned_events" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_entry" ON "points_ledger" USING btree ("server_id","entry_id");--> statement-breakpoint
CREATE INDEX "points_ledger_team" ON "points_ledger" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "season_events_server_seq" ON "season_events" USING btree ("server_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "season_snapshots_server_seq" ON "season_snapshots" USING btree ("server_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_child" ON "team_members" USING btree ("team_id","child_id");