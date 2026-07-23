-- Tracks which clusters have already been cross-validated against
-- Google's autocomplete API, so the same cluster isn't re-queried every
-- run. Closes the gap in docs/spec.md's Data sources section: Google
-- autocomplete/PAA was planned as a secondary validation layer but never
-- got its own build-order step.
alter table problem_clusters
  add column paa_checked_at timestamptz;
