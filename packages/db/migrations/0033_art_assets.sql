CREATE TABLE "art_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"author" text NOT NULL,
	"note" text,
	"live" boolean DEFAULT false NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "art_assets_slot" ON "art_assets" USING btree ("slot","live");