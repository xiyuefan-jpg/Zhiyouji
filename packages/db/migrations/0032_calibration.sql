CREATE TABLE "calib_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"family" text NOT NULL,
	"task_title" text NOT NULL,
	"task_body" text,
	"audience" text,
	"media_kind" text DEFAULT 'text' NOT NULL,
	"text" text NOT NULL,
	"ai_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calib_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sample_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scorer" text NOT NULL,
	"total" integer NOT NULL,
	"dims" jsonb NOT NULL,
	"rubric" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calib_scores" ADD CONSTRAINT "calib_scores_sample_id_calib_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."calib_samples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calib_scores_one" ON "calib_scores" USING btree ("sample_id","kind","scorer");