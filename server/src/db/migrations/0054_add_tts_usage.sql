CREATE TABLE "tts_usage" (
	"user_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"usage_month" date NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tts_usage_user_id_provider_usage_month_pk" PRIMARY KEY("user_id","provider","usage_month")
);--> statement-breakpoint
ALTER TABLE "tts_usage" ADD CONSTRAINT "tts_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tts_usage_user_month_idx" ON "tts_usage" USING btree ("user_id","usage_month");--> statement-breakpoint
ALTER TABLE "tts_usage" ADD CONSTRAINT "tts_usage_character_count_nonnegative_chk" CHECK ("character_count" >= 0);--> statement-breakpoint
ALTER TABLE "tts_usage" ADD CONSTRAINT "tts_usage_provider_chk" CHECK ("provider" in ('browser', 'azure', 'gcp-chirp3', 'xai', 'kokoro', 'gpt-4o-mini-tts'));
