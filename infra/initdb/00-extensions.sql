-- Extensions required by the Mola schema.
-- pgvector backs Layer-3 semantic retrieval; pg_trgm accelerates the
-- grep-style raw-text tool in the retrieval agent (§6).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
