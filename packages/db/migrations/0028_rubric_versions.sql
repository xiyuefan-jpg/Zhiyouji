CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"dims" jsonb NOT NULL,
	"at50" text NOT NULL,
	"at75" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_family_version" ON "rubric_versions" USING btree ("family","version");