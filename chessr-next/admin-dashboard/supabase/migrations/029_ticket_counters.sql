-- Ticket counters for sequential ticket numbering
CREATE TABLE IF NOT EXISTS ticket_counters (
  type TEXT PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);

-- Seed initial counter for support tickets
INSERT INTO ticket_counters (type, last_number) VALUES ('support', 0) ON CONFLICT DO NOTHING;

-- Atomic increment function for ticket numbering
CREATE OR REPLACE FUNCTION increment_ticket_counter(ticket_type TEXT)
RETURNS INT AS $$
DECLARE
  new_number INT;
BEGIN
  UPDATE ticket_counters SET last_number = last_number + 1 WHERE type = ticket_type RETURNING last_number INTO new_number;
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE ticket_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_counters_service ON ticket_counters FOR ALL TO service_role USING (true);
