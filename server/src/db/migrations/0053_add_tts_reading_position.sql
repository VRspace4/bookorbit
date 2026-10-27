ALTER TABLE "reading_progress" ADD COLUMN IF NOT EXISTS "tts_section_index" integer;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN IF NOT EXISTS "tts_word_index" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_tts_section_index_nonnegative_chk" CHECK ("tts_section_index" is null or "tts_section_index" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_tts_word_index_nonnegative_chk" CHECK ("tts_word_index" is null or "tts_word_index" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
