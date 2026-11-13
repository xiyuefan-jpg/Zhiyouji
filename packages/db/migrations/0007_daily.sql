CREATE TABLE "daily_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"by" text NOT NULL,
	"passed" boolean NOT NULL,
	"expression" integer,
	"ai_level" integer,
	"ai_tone" boolean DEFAULT false NOT NULL,
	"main_tag" text,
	"sub_tag" text,
	"difficulty" integer,
	"crossing" integer,
	"length" integer,
	"raw" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"template_id" integer NOT NULL,
	"evidence_file_ids" jsonb NOT NULL,
	"explain_kind" text NOT NULL,
	"explain_file_id" uuid,
	"explain_text" text,
	"ai_note" text,
	"no_ai" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"day" date NOT NULL,
	"grade" integer NOT NULL,
	"status" text DEFAULT 'reviewing' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone,
	"fail_reason" text,
	"feedback_good" text,
	"feedback_better" text,
	"grain" integer,
	"counted" boolean,
	"busy_notice_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"tag" text,
	"difficulty" integer,
	"day" date NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_reviews" ADD CONSTRAINT "daily_reviews_submission_id_daily_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."daily_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_submissions" ADD CONSTRAINT "daily_submissions_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD CONSTRAINT "knowledge_cards_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD CONSTRAINT "knowledge_cards_submission_id_daily_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."daily_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_reviews_submission" ON "daily_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "daily_child_day" ON "daily_submissions" USING btree ("child_id","day");--> statement-breakpoint
CREATE INDEX "daily_status" ON "daily_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "knowledge_cards_child" ON "knowledge_cards" USING btree ("child_id","day");