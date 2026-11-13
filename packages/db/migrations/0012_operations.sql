CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"season_id" uuid,
	"server_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "camp_qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"camp" text NOT NULL,
	"image" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "envoys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"camp" text NOT NULL,
	"team_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"registered_by" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "qr_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_qr_codes" ADD CONSTRAINT "camp_qr_codes_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envoys" ADD CONSTRAINT "envoys_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envoys" ADD CONSTRAINT "envoys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_publish" ON "announcements" USING btree ("publish_at");--> statement-breakpoint
CREATE UNIQUE INDEX "camp_qr_codes_camp" ON "camp_qr_codes" USING btree ("server_id","camp");--> statement-breakpoint
CREATE UNIQUE INDEX "envoys_child" ON "envoys" USING btree ("server_id","child_id");