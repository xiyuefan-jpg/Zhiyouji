ALTER TABLE "daily_submissions" ADD COLUMN "client_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_client_key" ON "daily_submissions" USING btree ("child_id","client_key");