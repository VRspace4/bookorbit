ALTER TABLE "refresh_tokens" ADD COLUMN "successor_token_hash" varchar(255);--> statement-breakpoint
CREATE INDEX "refresh_tokens_successor_token_hash_idx" ON "refresh_tokens" USING btree ("successor_token_hash");
