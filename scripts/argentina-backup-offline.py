"""Portable Argentina archive. Python standard library only; never uses a network."""
import argparse, base64, collections, csv, datetime, gzip, hashlib, html.parser, json, pathlib, sqlite3, urllib.parse

class PlainText(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.hidden=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','iframe'): self.hidden+=1
        if tag in ('p','br','li','div'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','iframe'): self.hidden=max(0,self.hidden-1)
    def handle_data(self,data):
        if not self.hidden: self.parts.append(data)
def plain(value):
    parser=PlainText(); parser.feed(str(value or '')); return ''.join(parser.parts).strip()
def rows(root,table):
    file=root/(table+'.jsonl.gz')
    if not file.exists(): return
    with gzip.open(file,'rt',encoding='utf-8') as handle:
        for line in handle:
            if line.strip(): yield json.loads(line)
def safe_cell(value):
    text='' if value is None else str(value)
    return "'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text
def csv_file(root,name,fields,data):
    with (root/name).open('w',encoding='utf-8-sig',newline='') as handle:
        out=csv.writer(handle);out.writerow(fields)
        for row in data: out.writerow([safe_cell(v) for v in row])
def inside(root,relative):
    path=(root/relative).resolve()
    if not path.is_relative_to(root.resolve()): raise ValueError('Archive path escapes backup')
    return path
def build(root):
    target=root/'kenku-argentina.sqlite'; temp=root/'kenku-argentina.sqlite.partial'
    if temp.exists(): temp.unlink()
    db=sqlite3.connect(temp)
    db.executescript('''
    create table records(resource text,id text,payload text not null,primary key(resource,id));
    create table orders(id text primary key,number text,created_at text,currency text,total text,customer_id text,status text,payload text);
    create table customers(id text primary key,name text,email text,phone text,payload text);
    create table drafts(id text primary key,number text,created_at text,status text,total text,currency text,order_id text,payload text);
    create table catalog(variant_id text primary key,product_id text,sku_original text,sku_internal text unique,title text,status text,price text,currency text,stock integer,image_local text,description_text text,payload text);
    create table historical_items(source text,source_id text,product_id text,variant_id text,sku text,title text,quantity integer,price text,catalog_match integer);
    create table bulk_records(kind text,id text,parent_id text,payload text,primary key(kind,id,parent_id));
    ''')
    counts=collections.Counter();products=[];orders=[];customers=[];drafts=[]; historical=[]
    for row in rows(root,'shopify_archivo'):
        if row['store_id']!=4: raise ValueError('Cross-store archive row')
        r,i,p=row['recurso'],str(row['shopify_id']),row['payload'];raw=json.dumps(p,ensure_ascii=False,separators=(',',':'))
        db.execute('insert into records values(?,?,?)',(r,i,raw));counts[r]+=1
        if r=='product': products.append(p)
        elif r=='order':
            customer=p.get('customer') or {};status='cancelled' if p.get('cancelled_at') else p.get('financial_status','')
            db.execute('insert into orders values(?,?,?,?,?,?,?,?)',(i,str(p.get('name','')),p.get('created_at',''),p.get('currency',''),str(p.get('total_price','')),str(customer.get('id','')),status,raw));orders.append(p)
        elif r=='customer':
            db.execute('insert into customers values(?,?,?,?,?)',(i,' '.join(str(p.get(k) or '') for k in ('first_name','last_name')).strip(),p.get('email') or '',p.get('phone') or '',raw));customers.append(p)
        elif r=='draft_order':
            db.execute('insert into drafts values(?,?,?,?,?,?,?,?)',(i,str(p.get('name','')),p.get('created_at',''),p.get('status',''),str(p.get('total_price','')),p.get('currency',''),str(p.get('order_id') or ''),raw));drafts.append(p)
    images={str(r['image_id']):'media/'+r['storage_path'] for r in rows(root,'shopify_archivo_imagenes')}
    sku_count=collections.Counter(str(v.get('sku') or '').strip().casefold() for p in products for v in p.get('variants',[]) if str(v.get('sku') or '').strip())
    issues=[];catalog=[];variant_ids=set();original_skus=set()
    for p in products:
        for v in p.get('variants',[]):
            vid,pid=str(v['id']),str(p['id']);variant_ids.add(vid);sku=str(v.get('sku') or '');clean=sku.strip()
            internal=clean if clean and sku_count[clean.casefold()]==1 else 'KAR-V'+vid
            if not clean: issues.append({'variant_id':vid,'issue':'missing_original_sku','internal_sku':internal})
            elif sku_count[clean.casefold()]>1: issues.append({'variant_id':vid,'issue':'duplicate_original_sku','internal_sku':internal})
            if clean: original_skus.add(clean.casefold())
            image=images.get(str(v.get('image_id') or (p.get('image') or {}).get('id') or ''),'')
            if image and not inside(root,image).is_file(): issues.append({'variant_id':vid,'issue':'missing_local_image'})
            title=str(p.get('title') or '')+((' / '+str(v['title'])) if v.get('title') not in (None,'Default Title') else '')
            entry=(vid,pid,sku,internal,title,p.get('status',''),str(v.get('price','')),'ARS',v.get('inventory_quantity'),image,plain(p.get('body_html')),json.dumps({'product':p,'variant':v},ensure_ascii=False))
            db.execute('insert into catalog values(?,?,?,?,?,?,?,?,?,?,?,?)',entry);catalog.append(entry)
    for source,data in [('order',orders),('draft_order',drafts)]:
        for p in data:
            for item in p.get('line_items',[]):
                vid=str(item.get('variant_id') or '');sku=str(item.get('sku') or '')
                entry=(source,str(p['id']),str(item.get('product_id') or ''),vid,sku,str(item.get('name') or item.get('title') or ''),item.get('quantity'),str(item.get('price','')),int(vid in variant_ids))
                db.execute('insert into historical_items values(?,?,?,?,?,?,?,?,?)',entry);historical.append(entry)
    extra_count=collections.Counter();theme_files=0;theme_missing=0;latest_audit={}
    asset_file=root/'asset-map.json';asset_map=json.loads(asset_file.read_text()) if asset_file.exists() else {}
    for row in rows(root,'argentina_shopify_extra'):
        resource=row['resource'];p=row['payload'];extra_count[resource]+=1
        if resource=='audit' and p.get('at','')>latest_audit.get('at',''): latest_audit=p
        if resource=='theme_file':
            key=str(p.get('key',''));relative=pathlib.PurePosixPath(key)
            if not key or relative.is_absolute() or '..' in relative.parts or ':' in key: raise ValueError('Unsafe theme path')
            out=inside(root,'themes/'+str(row['parent_id'])+'/'+key);out.parent.mkdir(parents=True,exist_ok=True)
            if p.get('attachment') is not None: out.write_bytes(base64.b64decode(p['attachment'],validate=True));theme_files+=1
            elif p.get('value') is not None: out.write_bytes(str(p['value']).encode('utf-8'));theme_files+=1
            elif p.get('public_url'):
                url=urllib.parse.urlsplit(p['public_url']);local=asset_map.get(urllib.parse.urlunsplit((url.scheme,url.netloc,url.path,'','')))
                if local and inside(root,local).is_file():out.write_bytes(inside(root,local).read_bytes());theme_files+=1
                else:theme_missing+=1
            else: theme_missing+=1
            if out.is_file() and p.get('checksum_md5') and hashlib.md5(out.read_bytes()).hexdigest()!=p['checksum_md5']:raise ValueError('Theme checksum mismatch')
        elif resource=='bulk_export':
            file=inside(root,'supplemental/'+p['path'])
            if not file.exists(): continue
            count=0
            with gzip.open(file,'rt',encoding='utf-8') as handle:
                for line in handle:
                    if not line.strip(): continue
                    record=json.loads(line);count+=1
                    identifier=str(record.get('id') or hashlib.sha256(line.encode()).hexdigest())
                    db.execute('insert or replace into bulk_records values(?,?,?,?)',(row['external_id'],identifier,str(record.get('__parentId') or ''),json.dumps(record,ensure_ascii=False)))
            if count!=p['records']: raise ValueError('Bulk record count mismatch')
    db.executescript('create index orders_created on orders(created_at);create index customers_email on customers(email);create index customer_orders on orders(customer_id);create index items_variant on historical_items(variant_id);')
    db.commit()
    integrity=db.execute('pragma integrity_check').fetchone()[0]
    if integrity!='ok': raise ValueError('SQLite integrity failure')
    orphan=db.execute("select count(*) from orders where customer_id<>'' and customer_id not in (select id from customers)").fetchone()[0]
    historical_missing=db.execute("select count(*) from historical_items where source='order' and catalog_match=0").fetchone()[0]
    drafts_linked=db.execute("select count(*) from drafts where order_id<>''").fetchone()[0]
    drafts_missing_orders=db.execute("select count(distinct order_id) from drafts where order_id<>'' and order_id not in (select id from orders)").fetchone()[0]
    db.close();temp.replace(target)
    csv_file(root,'catalogo_ordenado.csv',['variant_id','product_id','sku_original','sku_interno','nombre','estado','precio','moneda','stock','imagen_local','descripcion_texto'],[r[:-1] for r in catalog])
    csv_file(root,'pedidos.csv',['id','numero','creado','moneda','total_original','estado_pago','estado_preparacion','anulado','customer_id'],[(p['id'],p.get('name'),p.get('created_at'),p.get('currency'),p.get('total_price'),p.get('financial_status'),p.get('fulfillment_status'),p.get('cancelled_at'),(p.get('customer') or {}).get('id')) for p in orders])
    csv_file(root,'clientes.csv',['id','nombre','apellido','email','telefono','pedidos_shopify'],[(p['id'],p.get('first_name'),p.get('last_name'),p.get('email'),p.get('phone'),p.get('orders_count')) for p in customers])
    csv_file(root,'borradores.csv',['id','numero','creado','estado','total','moneda','order_id'],[(p['id'],p.get('name'),p.get('created_at'),p.get('status'),p.get('total_price'),p.get('currency'),p.get('order_id')) for p in drafts])
    csv_file(root,'catalogo_historico.csv',['origen','pedido_id','producto_id','variante_id','sku_original','nombre','cantidad','precio','en_catalogo_actual'],historical)
    coverage={}
    for resource,field in [('order','orders'),('customer','customers'),('product','products'),('draft_order','drafts')]:
        expected=latest_audit.get('counts',{}).get(field);expected=expected if type(expected) is int else None
        coverage[resource]={'expected':expected,'archived':counts[resource],'missing':max(0,expected-counts[resource]) if expected is not None else None,'complete':expected is not None and counts[resource]==expected and (resource!='order' or latest_audit.get('readAllOrders') is True)}
    denied=[{'resource':r['resource'],'status':r['status'],'error':r.get('error')} for r in rows(root,'argentina_shopify_extra_state') if r.get('status')=='error']
    audit={'counts':dict(counts),'coverage':coverage,'source_access':{k:latest_audit.get(k) for k in ['at','app','readAllOrders','oldestOrderAt']},'resources_denied':denied,'catalog_variants':len(catalog),'catalog_issues':issues,'orphan_order_customers':orphan,'order_lines_without_current_variant':historical_missing,'drafts_linked_to_order':drafts_linked,'draft_order_references_absent_from_orders':drafts_missing_orders,'extras':dict(extra_count),'theme_files_restored':theme_files,'theme_files_without_content':theme_missing,'sqlite_integrity':integrity,'built_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (root/'auditoria.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'LEEME.txt').write_text('''KENKU ARGENTINA: COPIA PRIVADA

Contiene datos personales. No subir esta carpeta a GitHub ni a una web pública.
kenku-argentina.sqlite permite consultas sin Shopify ni conexión a internet.
Los JSONL gzip conservan los objetos originales completos y sus identificadores.
CSV: catálogo ordenado, histórico por línea, pedidos, clientes y borradores.
Los borradores NO se suman como ventas. Los importes y monedas son originales.
Los SKU internos KAR-V... identifican variantes sin SKU o con SKU repetido;
no se modificó el SKU original de Shopify. No se inventaron costos de producto.
media/ contiene las fotos locales; supplemental/ guarda exportaciones adicionales.
themes/ contiene archivos recuperados. Liquid requiere adaptación a otra plataforma.
Los enlaces originales quedan como evidencia, no son necesarios para consultar SQLite/CSV.
Las claves de acceso y contraseñas de clientes no forman parte de este paquete.

Python 3, sin instalar librerías:
  python offline.py . summary
  python offline.py . verify
  python offline.py . orders --search NUMERO
  python offline.py . customers --search TEXTO
  python offline.py . catalog --search SKU
La auditoría técnica de cobertura está en auditoria.json y en el informe final.
''',encoding='utf-8')
    pathlib.Path(__file__).resolve().read_bytes() # Source is bundled for future offline use.
    if pathlib.Path(__file__).resolve()!=root/'offline.py': (root/'offline.py').write_bytes(pathlib.Path(__file__).read_bytes())
    seal(root)
    print(json.dumps({k:v for k,v in audit.items() if k!='catalog_issues'},ensure_ascii=False))
def seal(root):
    file=root/'manifest.json';manifest=json.loads(file.read_text()) if file.exists() else {'store':'kenku-ar','store_id':4}
    manifest['files']=[]
    for p in sorted(root.rglob('*')):
        if not p.is_file() or p==file or p.name.endswith(('.partial','-wal','-shm')):continue
        b=p.read_bytes();manifest['files'].append({'path':p.relative_to(root).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    manifest['sealed_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();file.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
def verify(root):
    manifest=json.loads((root/'manifest.json').read_text());assert manifest['store']=='kenku-ar' and manifest['store_id']==4
    for entry in manifest['files']:
        p=inside(root,entry['path']);b=p.read_bytes();assert len(b)==entry['bytes'] and hashlib.sha256(b).hexdigest()==entry['sha256'],entry['path']
    db=sqlite3.connect(f'file:{(root/"kenku-argentina.sqlite").as_posix()}?mode=ro',uri=True)
    assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
    for resource,count in db.execute('select resource,count(*) from records group by resource'):
        expected=sum(1 for r in rows(root,'shopify_archivo') if r['recurso']==resource);assert expected==count,resource
    summary={t:db.execute('select count(*) from '+t).fetchone()[0] for t in ['records','orders','customers','drafts','catalog','historical_items','bulk_records']};db.close()
    print(json.dumps({'verified':True,'network_required':False,'sha256_files':len(manifest['files']),'tables':summary}))
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root',type=pathlib.Path);parser.add_argument('action',choices=['build','seal','verify','summary','orders','customers','catalog']);parser.add_argument('--search',default='');args=parser.parse_args();root=args.root.resolve()
    if args.action=='build':build(root)
    elif args.action=='seal':seal(root)
    elif args.action=='verify':verify(root)
    else:
        db=sqlite3.connect(f'file:{(root/"kenku-argentina.sqlite").as_posix()}?mode=ro',uri=True);db.row_factory=sqlite3.Row
        if args.action=='summary':print(json.dumps({t:db.execute('select count(*) from '+t).fetchone()[0] for t in ['orders','customers','drafts','catalog','records','bulk_records']}))
        else:
            columns={'orders':('id,number,created_at,currency,total,status','number'),'customers':('id,name,email,phone','name'),'catalog':('variant_id,sku_original,sku_internal,title,status,price,currency,image_local','title')}[args.action]
            result=db.execute(f'select {columns[0]} from {args.action} where {columns[1]} like ? limit 50',('%'+args.search+'%',));print(json.dumps([dict(r) for r in result],ensure_ascii=False))
        db.close()
if __name__=='__main__':main()
