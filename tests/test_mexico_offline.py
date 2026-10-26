from contextlib import closing
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("offline", Path(__file__).resolve().parents[1] / "scripts" / "kenku-mx-offline.py")
offline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(offline)

class OfflineArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "data").mkdir()
        fixtures = {
            "order": {"id": 10, "name": "#MX10", "total_price": "49.95", "currency": "MXN", "customer": {"id": 20}, "shipping_address": {"zip": "01210"}},
            "customer": {"id": 20, "first_name": "Synthetic", "last_name": "Customer"},
            "product": {"id": 30, "title": "Synthetic product", "variants": [{"id": 31, "sku": "MX-SKU", "price": "49.95"}]},
        }
        for resource, payload in fixtures.items():
            row = {"store_id": 3, "recurso": resource, "shopify_id": str(payload["id"]), "payload": payload}
            (self.root / "data" / (resource + ".jsonl")).write_text(json.dumps(row) + "\n", encoding="utf-8")
        (self.root / "data" / "checkout.jsonl").write_text("", encoding="utf-8")
        extra = self.root / "extras" / "bulk" / "orders_finance"
        extra.mkdir(parents=True)
        (extra / "000000.jsonl").write_text(json.dumps({"id": "gid://shopify/Order/10", "transactions": [{"id": "transaction-1", "amountSet": {"shopMoney": {"amount": "49.95", "currencyCode": "MXN"}}}]}) + "\n", encoding="utf-8")
        (self.root / "snapshot.json").write_text(json.dumps({"store": "kenku-mx", "counts": {"order": 1, "customer": 1, "product": 1, "checkout": 0}}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_rebuild_keeps_decimals_postcode_relationships_and_supplemental_data(self):
        self.assertEqual(offline.build(self.root), {"checkout": 0, "customer": 1, "order": 1, "product": 1})
        with closing(sqlite3.connect(self.root / "archive.sqlite")) as db:
            payload, customer = db.execute("select payload,customer_id from records where resource='order'").fetchone()
            data = json.loads(payload)
            self.assertEqual(data["total_price"], "49.95")
            self.assertEqual(data["shipping_address"]["zip"], "01210")
            self.assertEqual(customer, "20")
            self.assertEqual(db.execute("select count(*) from extra where id='gid://shopify/Order/10'").fetchone()[0], 1)
        self.assertGreater(offline.seal(self.root), 0)
        self.assertEqual(offline.verify(self.root)["integrity"], "ok")

    def test_verifier_detects_missing_or_changed_files(self):
        offline.build(self.root)
        offline.seal(self.root)
        (self.root / "data" / "order.jsonl").write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(AssertionError, "hash mismatch"):
            offline.verify(self.root)

    def test_can_rebuild_index_twice_without_duplicate_rows(self):
        offline.build(self.root)
        offline.build(self.root)
        with closing(sqlite3.connect(self.root / "archive.sqlite")) as db:
            self.assertEqual(db.execute("select count(*) from records").fetchone()[0], 3)
            self.assertEqual(db.execute("select count(*) from extra").fetchone()[0], 1)

    def test_rejects_other_stores_before_overwriting_an_index(self):
        (self.root / "snapshot.json").write_text(json.dumps({"store": "kenku-ar"}), encoding="utf-8")
        (self.root / "archive.sqlite").write_bytes(b"existing data")
        with self.assertRaisesRegex(ValueError, "Mexico archive"):
            offline.build(self.root)
        self.assertEqual((self.root / "archive.sqlite").read_bytes(), b"existing data")

if __name__ == "__main__":
    unittest.main()
