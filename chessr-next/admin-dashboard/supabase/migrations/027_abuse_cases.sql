-- Abuse cases table for persisted abuse detection results
CREATE TABLE IF NOT EXISTS abuse_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  types TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  reasons TEXT[] NOT NULL DEFAULT '{}',
  user_ids TEXT[] NOT NULL DEFAULT '{}',
  fingerprints TEXT[] NOT NULL DEFAULT '{}',
  ips JSONB NOT NULL DEFAULT '[]',
  notes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_abuse_cases_status ON abuse_cases(status);
CREATE INDEX IF NOT EXISTS idx_abuse_cases_user_ids ON abuse_cases USING GIN(user_ids);

ALTER TABLE abuse_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY abuse_cases_service ON abuse_cases FOR ALL TO service_role USING (true);
