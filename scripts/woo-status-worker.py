#!/usr/bin/env python3
"""Invoke the Italy outbox from Vultr; secrets stay in a root-only JSON file."""
import json
import sys
import urllib.request

def main():
    with open("/root/kenkuit-kairo-secrets.json", encoding="utf-8") as source:
        config = json.load(source)
    endpoint = config["kairo_url"].rstrip("/") + "/api/cron/woo-status"
    if not endpoint.startswith("https://"):
        raise ValueError("HTTPS required")
    request = urllib.request.Request(endpoint, headers={
        "Authorization": "Bearer " + config["WOO_KENKU_IT_SYNC_SECRET"],
        "User-Agent": "Kenku-Italia-status-worker/1.0",
    })
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=180) as response:
        result = json.load(response)
    print(json.dumps({k: result.get(k) for k in ("ok", "synced", "failed")}))
    return 0 if result.get("ok") else 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Woo status sync failed; inspect Kairo cron health.", file=sys.stderr)
        sys.exit(1)
