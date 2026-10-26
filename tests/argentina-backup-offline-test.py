import contextlib,gzip,importlib.util,io,json,pathlib,sqlite3,tempfile,unittest
spec=importlib.util.spec_from_file_location('backup_offline',pathlib.Path(__file__).parents[1]/'scripts'/'argentina-backup-offline.py')
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
class PortableArchiveTest(unittest.TestCase):
    def test_restore_preserves_sources_and_assigns_internal_skus_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            payloads=[('product','10',{'id':10,'title':'=FORMULA','status':'active','variants':[{'id':101,'sku':'DUP','price':'12500.50'},{'id':102,'sku':'DUP','price':'1'},{'id':103,'sku':'','price':'2'}]}),('customer','20',{'id':20,'first_name':'Prueba','email':'qa@example.test'}),('order','9007199254740993',{'id':9007199254740993,'name':'QA-1','currency':'ARS','total_price':'12500.50','financial_status':'paid','customer':{'id':20},'line_items':[{'variant_id':101,'quantity':3,'sku':'DUP','price':'12500.50'}]}),('draft_order','30',{'id':30,'name':'D30','order_id':99,'status':'completed','line_items':[]})]
            with gzip.open(root/'shopify_archivo.jsonl.gz','wt',encoding='utf-8') as file:
                for resource,key,payload in payloads:file.write(json.dumps({'store_id':4,'recurso':resource,'shopify_id':key,'payload':payload})+'\n')
            with contextlib.redirect_stdout(io.StringIO()):backup.build(root);backup.verify(root)
            db=sqlite3.connect(root/'kenku-argentina.sqlite')
            self.assertEqual(db.execute('select id,total,status from orders').fetchone(),('9007199254740993','12500.50','paid'))
            self.assertEqual(db.execute('select sku_original,sku_internal from catalog order by variant_id').fetchall(),[('DUP','KAR-V101'),('DUP','KAR-V102'),('','KAR-V103')])
            self.assertEqual(db.execute('select quantity from historical_items').fetchone()[0],3);db.close()
            self.assertIn("'=FORMULA",(root/'catalogo_ordenado.csv').read_text(encoding='utf-8-sig'))
            audit=json.loads((root/'auditoria.json').read_text());self.assertEqual(audit['draft_order_references_absent_from_orders'],1)
            with (root/'pedidos.csv').open('ab') as file:file.write(b'tampered')
            with self.assertRaises(AssertionError):backup.verify(root)
    def test_paths_cannot_escape_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):backup.inside(pathlib.Path(directory),'../../outside')
if __name__=='__main__':unittest.main()
