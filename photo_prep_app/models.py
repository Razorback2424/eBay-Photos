import os
import sqlite3
import threading
from datetime import datetime


DB_LOCK = threading.Lock()


def _connect(db_path):
    conn = sqlite3.connect(db_path, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _column_names(conn, table_name):
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {r["name"] for r in rows}


def init_db(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS batches (
                  id TEXT PRIMARY KEY,
                  owner_id TEXT NOT NULL DEFAULT 'local',
                  owner_email TEXT,
                  batch_name TEXT,
                  status TEXT NOT NULL,
                  mode TEXT,
                  created_at TEXT,
                  started_at TEXT,
                  finished_at TEXT,
                  error TEXT,
                  run_dir TEXT,
                  cards_root TEXT,
                  zip_path TEXT,
                  pair_count INTEGER NOT NULL DEFAULT 0,
                  processed_pairs INTEGER NOT NULL DEFAULT 0,
                  total_cards INTEGER NOT NULL DEFAULT 0,
                  total_images INTEGER NOT NULL DEFAULT 0,
                  output_warnings TEXT NOT NULL DEFAULT ''
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS batch_pair_results (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  batch_id TEXT NOT NULL,
                  position INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  front_name TEXT,
                  back_name TEXT,
                  status TEXT,
                  card_count INTEGER NOT NULL DEFAULT 0,
                  image_count INTEGER NOT NULL DEFAULT 0,
                  exit_code INTEGER,
                  UNIQUE(batch_id, position),
                  FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS subscriptions (
                  account_id TEXT PRIMARY KEY,
                  account_email TEXT,
                  status TEXT NOT NULL,
                  plan_name TEXT NOT NULL,
                  cards_per_month_limit INTEGER NOT NULL DEFAULT 0,
                  trial_cards_total_limit INTEGER NOT NULL DEFAULT 25,
                  trial_exhausted_at TEXT,
                  stripe_customer_id TEXT,
                  stripe_subscription_id TEXT,
                  updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS usage_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  account_id TEXT NOT NULL,
                  batch_id TEXT NOT NULL UNIQUE,
                  cards_processed INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS webhook_events (
                  event_id TEXT PRIMARY KEY,
                  provider TEXT NOT NULL,
                  event_type TEXT,
                  received_at TEXT NOT NULL,
                  processed_ok INTEGER NOT NULL DEFAULT 0,
                  status TEXT,
                  error TEXT,
                  payload_sha256 TEXT
                )
                """
            )
            # Lightweight migrations for existing local DBs.
            batch_cols = _column_names(conn, "batches")
            if "owner_id" not in batch_cols:
                conn.execute("ALTER TABLE batches ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'")
            if "owner_email" not in batch_cols:
                conn.execute("ALTER TABLE batches ADD COLUMN owner_email TEXT")
            sub_cols = _column_names(conn, "subscriptions")
            if "account_email" not in sub_cols:
                conn.execute("ALTER TABLE subscriptions ADD COLUMN account_email TEXT")
            if "stripe_customer_id" not in sub_cols:
                conn.execute("ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT")
            if "stripe_subscription_id" not in sub_cols:
                conn.execute("ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT")
            if "trial_cards_total_limit" not in sub_cols:
                conn.execute("ALTER TABLE subscriptions ADD COLUMN trial_cards_total_limit INTEGER NOT NULL DEFAULT 25")
            if "trial_exhausted_at" not in sub_cols:
                conn.execute("ALTER TABLE subscriptions ADD COLUMN trial_exhausted_at TEXT")

            conn.execute("CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_batches_owner_created_at ON batches(owner_id, created_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pair_results_batch ON batch_pair_results(batch_id, position)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_month ON usage_events(created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_account_month ON usage_events(account_id, created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC)")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL")
            conn.commit()
        finally:
            conn.close()


def upsert_batch_from_job(db_path, job):
    pair_results = list(job.get("pair_results", []) or [])
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO batches (
                  id, owner_id, owner_email, batch_name, status, mode, created_at, started_at, finished_at, error,
                  run_dir, cards_root, zip_path, pair_count, processed_pairs, total_cards, total_images, output_warnings
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  owner_id=excluded.owner_id,
                  owner_email=excluded.owner_email,
                  batch_name=excluded.batch_name,
                  status=excluded.status,
                  mode=excluded.mode,
                  created_at=excluded.created_at,
                  started_at=excluded.started_at,
                  finished_at=excluded.finished_at,
                  error=excluded.error,
                  run_dir=excluded.run_dir,
                  cards_root=excluded.cards_root,
                  zip_path=excluded.zip_path,
                  pair_count=excluded.pair_count,
                  processed_pairs=excluded.processed_pairs,
                  total_cards=excluded.total_cards,
                  total_images=excluded.total_images,
                  output_warnings=excluded.output_warnings
                """,
                (
                    job.get("id"),
                    job.get("owner_id", "local"),
                    job.get("owner_email", ""),
                    job.get("batch_name", ""),
                    job.get("status", ""),
                    job.get("mode", ""),
                    job.get("created_at"),
                    job.get("started_at"),
                    job.get("finished_at"),
                    job.get("error"),
                    job.get("run_dir"),
                    job.get("cards_root"),
                    job.get("zip_path"),
                    int(job.get("pair_count", 0) or 0),
                    int(job.get("processed_pairs", 0) or 0),
                    int(job.get("total_cards", 0) or 0),
                    int(job.get("total_images", 0) or 0),
                    job.get("output_warnings", "") or "",
                ),
            )
            conn.execute("DELETE FROM batch_pair_results WHERE batch_id = ?", (job.get("id"),))
            for idx, item in enumerate(pair_results):
                conn.execute(
                    """
                    INSERT INTO batch_pair_results (
                      batch_id, position, name, front_name, back_name, status, card_count, image_count, exit_code
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        job.get("id"),
                        idx,
                        item.get("name", ""),
                        item.get("front_name", ""),
                        item.get("back_name", ""),
                        item.get("status", ""),
                        int(item.get("card_count", 0) or 0),
                        int(item.get("image_count", 0) or 0),
                        item.get("exit_code"),
                    ),
                )
            conn.commit()
        finally:
            conn.close()


def get_batch(db_path, batch_id, owner_id=None):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            if owner_id is None:
                row = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
            else:
                row = conn.execute("SELECT * FROM batches WHERE id = ? AND owner_id = ?", (batch_id, owner_id)).fetchone()
            if not row:
                return None
            batch = dict(row)
            pair_rows = conn.execute(
                "SELECT position, name, front_name, back_name, status, card_count, image_count, exit_code "
                "FROM batch_pair_results WHERE batch_id = ? ORDER BY position ASC",
                (batch_id,),
            ).fetchall()
            batch["pair_results"] = [dict(r) for r in pair_rows]
            batch.setdefault("run_log", "")
            batch.setdefault("pairs", [])
            return batch
        finally:
            conn.close()


def list_recent_batches(db_path, limit=8, owner_id=None):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            if owner_id is None:
                rows = conn.execute(
                    "SELECT id, owner_id, owner_email, batch_name, status, pair_count, total_cards, created_at "
                    "FROM batches ORDER BY created_at DESC LIMIT ?",
                    (int(limit),),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, owner_id, owner_email, batch_name, status, pair_count, total_cards, created_at "
                    "FROM batches WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
                    (owner_id, int(limit)),
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def total_cards_processed(db_path, owner_id=None):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            if owner_id is None:
                row = conn.execute(
                    "SELECT COALESCE(SUM(total_cards), 0) AS total FROM batches "
                    "WHERE status IN ('completed', 'completed_with_warnings')"
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT COALESCE(SUM(total_cards), 0) AS total FROM batches "
                    "WHERE owner_id = ? AND status IN ('completed', 'completed_with_warnings')",
                    (owner_id,),
                ).fetchone()
            return int(row["total"] or 0)
        finally:
            conn.close()


def ensure_subscription(
    db_path,
    account_id,
    *,
    account_email=None,
    status="trialing",
    plan_name="Starter Trial",
    cards_per_month_limit=200,
    trial_cards_total_limit=25,
):
    now = datetime.now().isoformat(timespec="seconds")
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO subscriptions (
                  account_id, account_email, status, plan_name, cards_per_month_limit, trial_cards_total_limit, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id) DO NOTHING
                """,
                (
                    account_id,
                    account_email,
                    status,
                    plan_name,
                    int(cards_per_month_limit),
                    int(trial_cards_total_limit or 0),
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()


def get_subscription(db_path, account_id):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT account_id, account_email, status, plan_name, cards_per_month_limit, trial_cards_total_limit, trial_exhausted_at, "
                "stripe_customer_id, stripe_subscription_id, updated_at "
                "FROM subscriptions WHERE account_id = ?",
                (account_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def set_subscription(
    db_path,
    account_id,
    *,
    account_email=None,
    status,
    plan_name=None,
    cards_per_month_limit=None,
    stripe_customer_id=None,
    stripe_subscription_id=None,
    trial_cards_total_limit=None,
    trial_exhausted_at=None,
):
    now = datetime.now().isoformat(timespec="seconds")
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            current = conn.execute(
                "SELECT account_email, plan_name, cards_per_month_limit, trial_cards_total_limit, trial_exhausted_at, stripe_customer_id, stripe_subscription_id "
                "FROM subscriptions WHERE account_id = ?",
                (account_id,),
            ).fetchone()
            existing_email = current["account_email"] if current else None
            existing_plan = current["plan_name"] if current else "Starter Trial"
            existing_limit = int(current["cards_per_month_limit"]) if current else 200
            existing_trial_limit = int(current["trial_cards_total_limit"]) if current and current["trial_cards_total_limit"] is not None else 25
            existing_trial_exhausted_at = current["trial_exhausted_at"] if current else None
            existing_customer = current["stripe_customer_id"] if current else None
            existing_subscription = current["stripe_subscription_id"] if current else None
            conn.execute(
                """
                INSERT INTO subscriptions (
                  account_id, account_email, status, plan_name, cards_per_month_limit, trial_cards_total_limit, trial_exhausted_at,
                  stripe_customer_id, stripe_subscription_id, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                  account_email=excluded.account_email,
                  status=excluded.status,
                  plan_name=excluded.plan_name,
                  cards_per_month_limit=excluded.cards_per_month_limit,
                  trial_cards_total_limit=excluded.trial_cards_total_limit,
                  trial_exhausted_at=excluded.trial_exhausted_at,
                  stripe_customer_id=excluded.stripe_customer_id,
                  stripe_subscription_id=excluded.stripe_subscription_id,
                  updated_at=excluded.updated_at
                """,
                (
                    account_id,
                    account_email if account_email is not None else existing_email,
                    status,
                    plan_name or existing_plan,
                    int(cards_per_month_limit if cards_per_month_limit is not None else existing_limit),
                    int(trial_cards_total_limit if trial_cards_total_limit is not None else existing_trial_limit),
                    trial_exhausted_at if trial_exhausted_at is not None else existing_trial_exhausted_at,
                    stripe_customer_id if stripe_customer_id is not None else existing_customer,
                    stripe_subscription_id if stripe_subscription_id is not None else existing_subscription,
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()


def usage_cards_for_month(db_path, account_id, month_prefix):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(cards_processed), 0) AS total "
                "FROM usage_events WHERE account_id = ? AND substr(created_at, 1, 7) = ?",
                (account_id, month_prefix),
            ).fetchone()
            return int(row["total"] or 0)
        finally:
            conn.close()


def usage_cards_lifetime(db_path, account_id):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(cards_processed), 0) AS total FROM usage_events WHERE account_id = ?",
                (account_id,),
            ).fetchone()
            return int(row["total"] or 0)
        finally:
            conn.close()


def record_usage_for_batch(db_path, *, account_id, batch_id, cards_processed, created_at=None):
    ts = created_at or datetime.now().isoformat(timespec="seconds")
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO usage_events (account_id, batch_id, cards_processed, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (account_id, batch_id, int(cards_processed or 0), ts),
            )
            conn.commit()
        finally:
            conn.close()


def get_subscription_by_stripe_customer(db_path, stripe_customer_id):
    if not stripe_customer_id:
        return None
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT account_id, account_email, status, plan_name, cards_per_month_limit, stripe_customer_id, stripe_subscription_id, updated_at "
                "FROM subscriptions WHERE stripe_customer_id = ?",
                (stripe_customer_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def get_subscription_by_stripe_subscription(db_path, stripe_subscription_id):
    if not stripe_subscription_id:
        return None
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT account_id, account_email, status, plan_name, cards_per_month_limit, stripe_customer_id, stripe_subscription_id, updated_at "
                "FROM subscriptions WHERE stripe_subscription_id = ?",
                (stripe_subscription_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


# Backward-compatible wrappers used by local demo flow.
def ensure_local_subscription(db_path, *, status="trialing", plan_name="Starter Trial", cards_per_month_limit=200):
    return ensure_subscription(
        db_path,
        "local",
        status=status,
        plan_name=plan_name,
        cards_per_month_limit=cards_per_month_limit,
    )


def get_local_subscription(db_path):
    return get_subscription(db_path, "local")


def set_local_subscription(db_path, *, status, plan_name=None, cards_per_month_limit=None):
    return set_subscription(
        db_path,
        "local",
        status=status,
        plan_name=plan_name,
        cards_per_month_limit=cards_per_month_limit,
    )


def list_batches_past_retention(db_path, cutoff_iso, limit=100):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                """
                SELECT id, run_dir
                FROM batches
                WHERE status IN ('completed', 'completed_with_warnings', 'failed')
                  AND finished_at IS NOT NULL
                  AND finished_at < ?
                ORDER BY finished_at ASC
                LIMIT ?
                """,
                (cutoff_iso, int(limit)),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def mark_batch_expired(db_path, batch_id):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                UPDATE batches
                SET status = 'expired',
                    zip_path = NULL,
                    output_warnings = CASE
                      WHEN output_warnings IS NULL OR output_warnings = '' THEN 'Batch files expired after retention window.'
                      ELSE output_warnings || char(10) || 'Batch files expired after retention window.'
                    END
                WHERE id = ?
                """,
                (batch_id,),
            )
            conn.commit()
        finally:
            conn.close()


def mark_incomplete_batches_failed_on_startup(db_path):
    now = datetime.now().isoformat(timespec="seconds")
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                UPDATE batches
                SET status='failed',
                    finished_at=COALESCE(finished_at, ?),
                    error=CASE
                      WHEN error IS NULL OR error = '' THEN 'Server restarted before batch completed. Please re-run the batch.'
                      ELSE error
                    END
                WHERE status IN ('queued', 'running')
                """,
                (now,),
            )
            conn.commit()
        finally:
            conn.close()


def health_check(db_path):
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute("SELECT 1 AS ok").fetchone()
            return bool(row and int(row["ok"]) == 1)
        finally:
            conn.close()


def webhook_event_exists(db_path, event_id):
    if not event_id:
        return False
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute("SELECT 1 AS ok FROM webhook_events WHERE event_id = ?", (event_id,)).fetchone()
            return bool(row)
        finally:
            conn.close()


def insert_webhook_event_receipt(db_path, *, event_id, provider, event_type, payload_sha256):
    if not event_id:
        return False
    now = datetime.now().isoformat(timespec="seconds")
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO webhook_events (
                  event_id, provider, event_type, received_at, processed_ok, status, error, payload_sha256
                ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (event_id, provider, event_type, now, "received", None, payload_sha256),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def mark_webhook_event_processed(db_path, *, event_id, processed_ok, status=None, error=None):
    if not event_id:
        return
    with DB_LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                UPDATE webhook_events
                SET processed_ok = ?,
                    status = COALESCE(?, status),
                    error = ? 
                WHERE event_id = ?
                """,
                (1 if processed_ok else 0, status, error, event_id),
            )
            conn.commit()
        finally:
            conn.close()
