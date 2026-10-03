CREATE TABLE "program_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_event_kind" CHECK ("program_event"."kind" in ('added', 'scope_added', 'scope_removed', 'scope_changed', 'policy_changed', 'details_changed'))
);
--> statement-breakpoint
ALTER TABLE "program_event" ADD CONSTRAINT "program_event_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_event_program_at_idx" ON "program_event" USING btree ("program_id","at");--> statement-breakpoint
CREATE INDEX "program_event_at_idx" ON "program_event" USING btree ("at");