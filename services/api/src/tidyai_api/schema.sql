CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_id text REFERENCES pages (id) ON DELETE CASCADE,
  title text NOT NULL,
  depth integer NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id text PRIMARY KEY,
  page_id text NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  position integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  version integer NOT NULL
);

CREATE INDEX IF NOT EXISTS chats_project ON chats (project_id);
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS pages_project ON pages (project_id, position);
CREATE INDEX IF NOT EXISTS blocks_page ON blocks (page_id, position);

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('block', 'user_message', 'assistant_message')),
  source_id text NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1536),
  UNIQUE (source_type, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_project ON chunks (project_id);
CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

-- Accounts. See docs/research/14-accounts-auth.md.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified_at timestamptz,
  password_hash text,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider text NOT NULL,
  subject text NOT NULL,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user ON oauth_accounts (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens (user_id, purpose);

CREATE TABLE IF NOT EXISTS rate_events (
  bucket text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_events_bucket ON rate_events (bucket, at);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id text REFERENCES users (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id, created_at);
