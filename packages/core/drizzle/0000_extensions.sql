-- pg_trgm powers the GIN trigram index behind LIKE %q% search (links_search_trgm).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
