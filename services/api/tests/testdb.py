"""Point DB tests at their own database. Import this before any tidyai_api module.

Tests create and delete accounts, and account deletion cascades to projects.
They must never see the dev database.
"""

from __future__ import annotations

import os
import sys

import psycopg
from psycopg import sql

TEST_URL = os.environ.get("TIDYAI_TEST_DATABASE_URL", "postgresql://tidyai:tidyai@localhost:5434/tidyai_test")
TEST_DB = psycopg.conninfo.conninfo_to_dict(TEST_URL)["dbname"]
if not TEST_DB.endswith("_test"):
    raise RuntimeError(f"test database name must end in _test, got {TEST_DB!r}")

os.environ["DATABASE_URL"] = TEST_URL
_loaded = sys.modules.get("tidyai_api.db")
if _loaded is not None and _loaded.DATABASE_URL != TEST_URL:
    raise RuntimeError("tidyai_api.db was imported before tests.testdb and points at the dev database")

try:
    with psycopg.connect(TEST_URL.rsplit("/", 1)[0] + "/postgres", autocommit=True, connect_timeout=3) as admin:
        if not admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone():
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
except psycopg.OperationalError:
    pass
