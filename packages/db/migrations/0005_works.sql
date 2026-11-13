CREATE TABLE "ai_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"rubric" text NOT NULL,
	"model" text NOT NULL,
	"total" integer NOT NULL,
	"dims" jsonb NOT NULL,
	"comment" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"official" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"team_id" uuid,
	"child_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"filename" text,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"duration_sec" integer,
	"transcript" text,
	"created_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "human_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"total" integer NOT NULL,
	"dims" jsonb NOT NULL,
	"comment" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"file_id" uuid,
	"text" text,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"second" boolean DEFAULT false NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reminded_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviewer_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"key" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settled_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"basis" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"decided_by" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slot" text NOT NULL,
	"prompt_id" text,
	"version" integer NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"media_kind" text NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text,
	"ai_note" text,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"safety" text DEFAULT 'pending' NOT NULL,
	"tags" jsonb
);
--> statement-breakpoint
ALTER TABLE "ai_scores" ADD CONSTRAINT "ai_scores_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_scores" ADD CONSTRAINT "human_scores_assignment_id_review_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."review_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_scores" ADD CONSTRAINT "human_scores_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_reviewer_id_admin_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_leaves" ADD CONSTRAINT "reviewer_leaves_reviewer_id_admin_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_rounds" ADD CONSTRAINT "scoring_rounds_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settled_scores" ADD CONSTRAINT "settled_scores_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_scores_work" ON "ai_scores" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "files_team" ON "files" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "materials_slot" ON "materials" USING btree ("server_id","team_id","slot");--> statement-breakpoint
CREATE INDEX "review_assignments_reviewer" ON "review_assignments" USING btree ("reviewer_id","status");--> statement-breakpoint
CREATE INDEX "review_assignments_work" ON "review_assignments" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_rounds_key" ON "scoring_rounds" USING btree ("server_id","key");--> statement-breakpoint
CREATE INDEX "settled_scores_work" ON "settled_scores" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "works_slot_version" ON "works" USING btree ("server_id","team_id","slot","version");--> statement-breakpoint
CREATE INDEX "works_slot" ON "works" USING btree ("server_id","slot");