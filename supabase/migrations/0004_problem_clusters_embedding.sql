-- Stores each cluster's embedding (the founding member's embedding vector,
-- as a plain JSON array of floats) so re-clustering runs can compare new
-- raw_problems against it without recomputing. No pgvector/ANN index yet —
-- brute-force cosine comparison in JS is fine at MVP scale; revisit if
-- problem_clusters grows into the thousands.
alter table problem_clusters
  add column embedding jsonb;
