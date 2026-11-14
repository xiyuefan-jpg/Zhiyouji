ALTER TABLE "supply_results" ADD COLUMN "regraded_grain" integer;--> statement-breakpoint
ALTER TABLE "supply_results" ADD COLUMN "regrade_note" text;--> statement-breakpoint
ALTER TABLE "supply_results" ADD COLUMN "regraded_by" text;--> statement-breakpoint
ALTER TABLE "supply_results" ADD COLUMN "regraded_at" timestamp with time zone;