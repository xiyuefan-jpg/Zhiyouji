CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"role" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost" integer,
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_configs" (
	"task" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer DEFAULT 1 NOT NULL,
	"fallback_provider" text,
	"fallback_model" text,
	"shadow_model" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_calls_task_at" ON "ai_calls" USING btree ("task","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_task_version" ON "prompt_templates" USING btree ("task","version");