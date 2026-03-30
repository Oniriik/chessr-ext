-- Add display_name for platforms where username != display name (e.g. WorldChess)
ALTER TABLE linked_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Update platform check constraint to include worldchess
ALTER TABLE linked_accounts DROP CONSTRAINT IF EXISTS linked_accounts_platform_check;
ALTER TABLE linked_accounts ADD CONSTRAINT linked_accounts_platform_check CHECK (platform IN ('chesscom', 'lichess', 'worldchess'));
