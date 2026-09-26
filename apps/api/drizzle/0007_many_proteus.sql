CREATE TABLE "attention_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attention_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"machine_id" uuid NOT NULL,
	"session" text NOT NULL,
	"workspace_label" text NOT NULL,
	"pane_id" text NOT NULL,
	"agent" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_event_kind_check" CHECK ("attention_event"."kind" in ('needs_you', 'finished'))
);
--> statement-breakpoint
ALTER TABLE "attention_event" ADD CONSTRAINT "attention_event_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_event_created_idx" ON "attention_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "attention_event_machine_idx" ON "attention_event" USING btree ("machine_id");