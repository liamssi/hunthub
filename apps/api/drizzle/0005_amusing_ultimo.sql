CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"machine_id" uuid NOT NULL,
	"session" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"origin" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "agent_run_origin_check" CHECK ("agent_run"."origin" in ('started', 'adopted')),
	CONSTRAINT "agent_run_name_length" CHECK (char_length("agent_run"."name") <= 64)
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_live_name_idx" ON "agent_run" USING btree ("machine_id","session","name") WHERE "agent_run"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "agent_run_user_idx" ON "agent_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_run_created_idx" ON "agent_run" USING btree ("created_at");