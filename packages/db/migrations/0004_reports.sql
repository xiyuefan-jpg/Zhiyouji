CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"ranking" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed" ADD COLUMN "hidden_by" text;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_server_publish" ON "reports" USING btree ("server_id","publish_at");