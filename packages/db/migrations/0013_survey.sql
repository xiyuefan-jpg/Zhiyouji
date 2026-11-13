CREATE TABLE "survey_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"version" text NOT NULL,
	"answers" jsonb NOT NULL,
	"curiosity" jsonb NOT NULL,
	"style" text NOT NULL,
	"challenge_kind" text,
	"challenge_text" text,
	"challenge_file_id" uuid,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_answers_child" ON "survey_answers" USING btree ("child_id","completed_at");