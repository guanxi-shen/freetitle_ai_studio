#!/bin/sh
# Start uvicorn in background (API only, internal port)
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 &

# Wait for uvicorn to be ready before starting nginx
for i in $(seq 1 30); do
  if wget -q --spider http://127.0.0.1:8000/api/version 2>/dev/null; then
    break
  fi
  sleep 1
done

# Start nginx in foreground (serves static + proxies API)
nginx -g 'daemon off;'
