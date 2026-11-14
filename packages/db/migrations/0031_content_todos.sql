CREATE TABLE "content_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"state" text,
	"action" text,
	"due_day" integer NOT NULL,
	"due_note" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
