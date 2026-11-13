CREATE TABLE "safety_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"forward_note" text,
	"forwarded_by" text,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "safety_queue_status" ON "safety_queue" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_queue_object" ON "safety_queue" USING btree ("object_kind","object_id");