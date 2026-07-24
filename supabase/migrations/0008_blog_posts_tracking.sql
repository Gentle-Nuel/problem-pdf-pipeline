alter table problem_clusters
  add column blog_generated_at timestamptz;

alter table blog_posts
  add column telegram_sent_at timestamptz;
