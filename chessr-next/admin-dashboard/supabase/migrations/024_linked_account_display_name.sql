-- Add display_name for platforms where username != display name (e.g. WorldChess)
ALTER TABLE linked_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
