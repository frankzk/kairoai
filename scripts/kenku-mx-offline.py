"""Portable, standard-library archive reader. No Shopify or Supabase client."""
from contextlib import closing
import argparse
import hashlib
import json
import mimetypes
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

RESOURCES = {"orders": "order", "customers": "customer", "products": "product"}

def build(root):
    marker = root / "snapshot.json"
    if not marker.is_file() or json.loads(marker.read_text(encoding="utf-8")).get("store") != "kenku-mx":
        raise ValueError("Select a Kenku Mexico archive before rebuilding")
    db = sqlite3.connect(root / "archive.sqlite")
    db.execute("drop table if exists records")
    db.execute("create table records(resource text,id text,payload text,search text,created text,customer_id text,primary key(resource,id))")
    db.execute("drop table if exists extra")
    db.execute("create table extra(resource text,id text,parent_id text,payload text,primary key(resource,id,parent_id))")
    counts = {}
    for file in sorted((root / "data").glob("*.jsonl")):
        count = 0
        with file.open(encoding="utf-8") as stream:
            for line in stream:
                row = json.loads(line)
                payload = row.get("payload", {})
                resource = row["recurso"]
                fields = [payload.get(k, "") for k in ("name", "first_name", "last_name", "email", "phone", "title", "handle", "vendor", "tags")]
                for key in ("customer", "shipping_address", "billing_address", "variants"):
                    fields.append(json.dumps(payload.get(key, {}), ensure_ascii=False))
                db.execute("insert into records values(?,?,?,?,?,?)", (resource, row["shopify_id"], json.dumps(payload, ensure_ascii=False), " ".join(str(x) for x in fields).lower(), payload.get("created_at", ""), str((payload.get("customer") or {}).get("id", ""))))
                count += 1
        counts[file.stem] = count
    db.execute("create index records_dates on records(resource,created desc,id desc)")
    db.execute("create index records_customer on records(resource,customer_id)")
    extra_records = root / "extras" / "records.jsonl"
    if extra_records.exists():
        with extra_records.open(encoding="utf-8") as stream:
            for line in stream:
                row = json.loads(line)
                if not row["resource"].startswith("_"):
                    db.execute("insert or replace into extra values(?,?,?,?)", (row["resource"], row["record_id"], "", json.dumps(row["payload"], ensure_ascii=False)))
    for file in sorted((root / "extras" / "bulk").glob("*/*.jsonl")):
        with file.open(encoding="utf-8") as stream:
            for line in stream:
                row = json.loads(line)
                db.execute("insert or replace into extra values(?,?,?,?)", (file.parent.name, str(row.get("id") or hashlib.sha256(line.encode()).hexdigest()), row.get("__parentId", ""), json.dumps(row, ensure_ascii=False)))
    db.execute("create index extra_parent on extra(resource,parent_id)")
    db.execute("create index extra_id on extra(id)")
    db.execute("create index extra_order on extra(json_extract(payload,'$.order.id'))")
    db.commit()
    assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
    db.close()
    (root / "offline-counts.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")
    return counts

def seal(root):
    files = {}
    for file in sorted(root.rglob("*")):
        if not file.is_file() or file.name in ("manifest.json", ".gitignore"):
            continue
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        files[file.relative_to(root).as_posix()] = {"bytes": file.stat().st_size, "sha256": digest.hexdigest()}
    previous = json.loads((root / "snapshot.json").read_text(encoding="utf-8"))
    previous["files"] = files
    (root / "manifest.json").write_text(json.dumps(previous, indent=2, ensure_ascii=False), encoding="utf-8")
    return len(files)

def verify(root):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["files"].items():
        file = (root / name).resolve()
        assert file.is_relative_to(root.resolve()) and file.is_file(), "Missing archive file"
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        assert file.stat().st_size == expected["bytes"] and digest.hexdigest() == expected["sha256"], "Archive hash mismatch: " + name
    with closing(sqlite3.connect(root / "archive.sqlite")) as db:
        assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
        counts = dict(db.execute("select resource,count(*) from records group by resource"))
    counts = {key: counts.get(key, 0) for key in manifest["counts"]}
    assert counts == manifest["counts"], "Archive counts mismatch"
    return {"verified_files": len(manifest["files"]), "counts": counts, "integrity": "ok"}

def serve(root, port):
    root = root.resolve()
    if json.loads((root / "snapshot.json").read_text(encoding="utf-8")).get("store") != "kenku-mx":
        raise ValueError("This directory is not a Mexico archive")
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Customer searches and identifiers do not belong in logs.

        def respond(self, body, mime="application/json", status=200):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith("text/") else ""))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            args = parse_qs(url.query)
            if url.path in ("/", "/viewer.html"):
                return self.respond((root / "viewer.html").read_bytes(), "text/html")
            if url.path == "/api/meta":
                return self.respond(json.loads((root / "snapshot.json").read_text(encoding="utf-8")))
            if url.path == "/api/images":
                return self.respond(json.loads((root / "image-map.json").read_text(encoding="utf-8")))
            if url.path == "/api/resources":
                with closing(sqlite3.connect(root / "archive.sqlite")) as db:
                    return self.respond([{"resource": r, "count": c} for r, c in db.execute("select resource,count(*) from extra group by resource order by resource")])
            if url.path in ("/api/list", "/api/detail"):
                kind = args.get("kind", [""])[0]
                extra = kind == "extra"
                resource = args.get("resource", [""])[0] if extra else RESOURCES.get(kind)
                if not resource:
                    return self.respond({"error": "Recurso inválido"}, status=400)
                with closing(sqlite3.connect("file:" + (root / "archive.sqlite").as_posix() + "?mode=ro", uri=True)) as db:
                    if url.path.endswith("detail"):
                        record_id = args.get("id", [""])[0]
                        row = db.execute("select payload from " + ("extra" if extra else "records") + " where resource=? and id=?", (resource, record_id)).fetchone()
                        if not row:
                            return self.respond({"error": "No encontrado"}, status=404)
                        if extra:
                            return self.respond(json.loads(row[0]))
                        gid = "gid://shopify/" + {"order": "Order", "customer": "Customer", "product": "Product"}[resource] + "/" + record_id
                        linked = db.execute("with recursive linked(resource,id,parent_id,payload,depth) as (select resource,id,parent_id,payload,0 from extra where id=? or json_extract(payload,'$.order.id')=? union all select e.resource,e.id,e.parent_id,e.payload,l.depth+1 from extra e join linked l on e.resource=l.resource and e.parent_id=l.id where l.depth<3) select distinct resource,id,payload from linked limit 5000", (gid, gid)).fetchall()
                        return self.respond({"original": json.loads(row[0]), "supplemental": [{"resource": r, "id": i, "data": json.loads(p)} for r, i, p in linked], "supplemental_limit_reached": len(linked) == 5000})
                    try:
                        page = max(1, min(100000, int(args.get("page", ["1"])[0])))
                    except ValueError:
                        return self.respond({"error": "Página inválida"}, status=400)
                    search = args.get("search", [""])[0].lower()[:100]
                    where = "resource=? and instr(" + ("lower(payload)" if extra else "search") + ",?)>0"
                    params = [resource, search]
                    customer = args.get("customer", [""])[0]
                    if customer and not extra:
                        where += " and customer_id=?"
                        params.append(customer)
                    table = "extra" if extra else "records"
                    count = db.execute("select count(*) from " + table + " where " + where, params).fetchone()[0]
                    rows = db.execute("select id,payload from " + table + " where " + where + (" order by id desc" if extra else " order by created desc,id desc") + " limit 50 offset ?", params + [(page - 1) * 50]).fetchall()
                    return self.respond({"rows": [{"id": row[0], "data": json.loads(row[1])} for row in rows], "count": count, "page": page})
            if url.path.startswith("/media/"):
                file = (root / unquote(url.path.lstrip("/"))).resolve()
                if file.is_relative_to(root / "media") and file.is_file():
                    return self.respond(file.read_bytes(), mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            return self.respond({"error": "No encontrado"}, status=404)
    print("Visor local: http://127.0.0.1:" + str(port), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["build", "seal", "verify", "serve"])
    parser.add_argument("root", type=Path)
    parser.add_argument("--port", type=int, default=8767)
    options = parser.parse_args()
    if options.mode == "serve":
        serve(options.root, options.port)
    else:
        print(json.dumps(globals()[options.mode](options.root), ensure_ascii=False))
