CREATE TABLE "land_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"rubric" text NOT NULL,
	"question_type" text NOT NULL,
	"default_audience" text,
	"junior_hint" text,
	"status" text DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "land_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"land_template_id" uuid,
	"question_type" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text,
	"rubric" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"todo" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_land_template_id_land_templates_id_fk" FOREIGN KEY ("land_template_id") REFERENCES "public"."land_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompts_land" ON "prompts" USING btree ("land_template_id","status");