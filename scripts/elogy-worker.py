#!/usr/bin/env python3
"""Refresh Kairo's Italy mirror. Provider credentials remain in Vercel."""
import json
import sys
import urllib.request
from urllib.parse import urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    with open("/root/kenkuit-kairo-secrets.json", encoding="utf-8") as source:
        config = json.load(source)
    base = config["kairo_url"].rstrip("/")
    url = urlsplit(base)
    if url.scheme != "https" or url.hostname != "kairoai-pearl.vercel.app" or url.username or url.password or url.port:
        raise ValueError("Unexpected Kairo origin")
    request = urllib.request.Request(base + "/api/cron/elogy", headers={
        "Authorization": "Bearer " + config["WOO_KENKU_IT_SYNC_SECRET"],
        "User-Agent": "Kenku-Italia-Elogy-worker/1.0",
    })
    with urllib.request.build_opener(NoRedirect).open(request, timeout=290) as response:
        result = json.load(response)
    # Do not log upstream payloads, customer data or credentials.
    print(json.dumps({"ok": result.get("ok")}))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Elogy sync failed; inspect Kairo cron health.", file=sys.stderr)
        sys.exit(1)
