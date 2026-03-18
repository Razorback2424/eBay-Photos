import os


# MVP production deployment rule: single worker only.
# The app runs an in-process queue worker thread, so multiple Gunicorn workers
# would duplicate background workers and break job processing semantics.

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8000")
workers = 1
threads = int(os.environ.get("GUNICORN_THREADS", "4") or "4")
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "300") or "300")
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30") or "30")
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOGLEVEL", "info")

