-- Local fork migration, formerly 0056. Renumbered after upstream 0053-0124; only fills NULL activity timestamps so it can re-run on databases that applied 0056.
-- Backfill account activity timestamps from historical auth signals.
-- Columns were added in 0051 but never written by login/refresh paths until this fix.

-- last_login_at: most recent credential-presentation event in audit log
UPDATE "users" AS u
SET "last_login_at" = src.max_at
FROM (
	SELECT "user_id", MAX("created_at") AS max_at
	FROM "audit_log"
	WHERE "user_id" IS NOT NULL
		AND "action" IN ('auth.login', 'auth.oidc.login', 'magic_link.login')
	GROUP BY "user_id"
) AS src
WHERE u."id" = src."user_id"
	AND u."last_login_at" IS NULL;--> statement-breakpoint

-- last_authenticated_at: most recent refresh-token issuance (login or rotation)
UPDATE "users" AS u
SET "last_authenticated_at" = src.max_at
FROM (
	SELECT "user_id", MAX("created_at") AS max_at
	FROM "refresh_tokens"
	GROUP BY "user_id"
) AS src
WHERE u."id" = src."user_id"
	AND u."last_authenticated_at" IS NULL;--> statement-breakpoint

-- Ensure last_authenticated_at is at least last_login_at when only login was recovered
UPDATE "users"
SET "last_authenticated_at" = "last_login_at"
WHERE "last_login_at" IS NOT NULL
	AND ("last_authenticated_at" IS NULL OR "last_authenticated_at" < "last_login_at");
