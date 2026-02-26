-- Add maintenance schedule keys to global_stats
-- Values store Unix epoch (seconds), or 0 for "none"

INSERT INTO global_stats (key, value) VALUES
    ('maintenance_schedule', 0),
    ('maintenance_schedule_end', 0)
ON CONFLICT (key) DO NOTHING;
