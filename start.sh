#!/bin/bash
# Kill any process running on port 8000
# fuser -k 8000/tcp might return 1 if no process found, so || true handles it
fuser -k 8000/tcp || true

source venv/bin/activate
uvicorn app:app --reload --host 0.0.0.0 --port 8000
