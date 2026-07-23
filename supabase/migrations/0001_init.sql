-- Problem-to-PDF Pipeline — initial schema
-- See docs/spec.md for the full pipeline design this supports.

-- Raw problems pulled directly from sources
create table raw_problems (
  id uuid primary key default gen_random_uuid(),
  source text not null,              -- 'reddit', 'google_paa', etc.
  source_url text,
  raw_text text not null,
  engagement_score int default 0,    -- upvotes, review count, etc.
  fetched_at timestamptz default now()
);

-- Deduplicated/clustered problems with a combined ranking score
create table problem_clusters (
  id uuid primary key default gen_random_uuid(),
  representative_text text not null, -- clearest phrasing of the problem
  source_count int default 0,        -- how many distinct sources it appeared on
  total_engagement int default 0,
  score numeric,                     -- computed rank
  status text default 'discovered',  -- discovered -> approved -> researched -> drafted -> published
  created_at timestamptz default now()
);

-- Link table: which raw_problems belong to which cluster
create table cluster_members (
  cluster_id uuid references problem_clusters(id),
  raw_problem_id uuid references raw_problems(id),
  primary key (cluster_id, raw_problem_id)
);

-- Research output per cluster
create table research_docs (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references problem_clusters(id),
  content text,                      -- structured research findings
  created_at timestamptz default now()
);

-- Final generated PDFs
create table pdfs (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references problem_clusters(id),
  file_url text,
  title text,
  price numeric,
  gumroad_url text,
  published_at timestamptz
);

-- Companion SEO blog posts (share research with the PDF, published separately)
create table blog_posts (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references problem_clusters(id),
  pdf_id uuid references pdfs(id),
  draft_content text,
  final_content text,
  status text default 'drafted',   -- drafted -> humanized -> approved -> published
  published_url text,
  published_at timestamptz
);
