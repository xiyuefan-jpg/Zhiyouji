CREATE TABLE "ai_prices" (
	"model" text PRIMARY KEY NOT NULL,
	"in_per_million" integer DEFAULT 0 NOT NULL,
	"out_per_million" integer DEFAULT 0 NOT NULL,
	"per_audio_hour" integer DEFAULT 0 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_configs" ALTER COLUMN "prompt_version" SET DEFAULT 0;