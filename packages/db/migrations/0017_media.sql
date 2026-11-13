ALTER TABLE "files" ADD COLUMN "frames" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "process_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "process_error" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "files_status" ON "files" USING btree ("status");