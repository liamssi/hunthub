CREATE TABLE "user_pin" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_pin_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"session" text NOT NULL,
	"pane_id" text,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pin_unique" UNIQUE NULLS NOT DISTINCT("user_id","machine_id","session","pane_id"),
	CONSTRAINT "user_pin_label_length" CHECK (char_length("user_pin"."label") <= 200)
);
--> statement-breakpoint
ALTER TABLE "user_pin" ADD CONSTRAINT "user_pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pin" ADD CONSTRAINT "user_pin_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_pin_machine_idx" ON "user_pin" USING btree ("machine_id");