-- Memory finds objects with similar names by trigram similarity (pg_trgm), so a person a
-- colleague names is a candidate for the same person writing from their own address. Drizzle
-- can't generate this, so it is written by hand.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
