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
