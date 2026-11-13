CREATE TABLE "debates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"contest_id" text NOT NULL,
	"defender_side" text,
	"side_by" text,
	"side_at" timestamp with time zone,
	"side_deadline" timestamp with time zone NOT NULL,
	"opening_deadline" timestamp with time zone NOT NULL,
	"no_defender" boolean DEFAULT false NOT NULL,
	"openings_shared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "debates_contest" ON "debates" USING btree ("server_id","contest_id");