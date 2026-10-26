import {NextRequest,NextResponse} from "next/server";
import {getDB} from "./db";
import {argentinaAccess,argentinaStoreId} from "./argentina-server";

/** These readers never call Shopify, including images and empty/error states. */
export async function argentinaArchiveList(req:NextRequest,kind:"customer"|"product"){
  if(!argentinaAccess())return NextResponse.json({error:"Sin acceso a Kenku Argentina"},{status:403});
  const p=req.nextUrl.searchParams,page=Math.max(1,Math.min(100000,Math.floor(Number(p.get("page"))||1))),search=(p.get("search")||"").trim().slice(0,100);
  try {
    const db=getDB(),store=await argentinaStoreId();
    let q=db.from(kind==="customer"?"argentina_customers":"argentina_products").select("record_id,payload,archived_at",{count:"exact"}).eq("store_id",store).order("record_id").range((page-1)*50,page*50-1);
    if(search)q=q.ilike("search_text",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
    const r=await q;if(r.error)throw Error("read failed");
    let rows:any[]=[];
    if(kind==="customer") rows=(r.data||[]).map(({record_id,payload:c,archived_at})=>({id:record_id,name:[c.first_name,c.last_name].filter(Boolean).join(" ")||"Sin nombre",email:c.email||"",phone:c.phone||c.default_address?.phone||"",orders_count:c.orders_count??0,total_spent:c.total_spent??"0",currency:c.currency||"ARS",tags:c.tags||"",note:c.note||"",addresses:c.addresses||[],email_marketing_consent:c.email_marketing_consent,sms_marketing_consent:c.sms_marketing_consent,archived_at}));
    else {
      const skuCounts=new Map<string,number>();
      for(let offset=0;;offset+=1000){const all=await db.from("shopify_archivo").select("variants:payload->variants").eq("store_id",store).eq("recurso","product").order("shopify_id").range(offset,offset+999);if(all.error)throw Error("catalog read failed");for(const p of all.data||[])for(const v of Array.isArray(p.variants)?p.variants:[]){if(!v||typeof v!=="object"||Array.isArray(v))continue;const sku=String(v.sku||"").trim().toLowerCase();if(sku)skuCounts.set(sku,(skuCounts.get(sku)||0)+1);}if(!all.data||all.data.length<1000)break;}
      const ids=(r.data||[]).map(r=>String(r.payload.image?.id||"")).filter(Boolean),images=new Map<string,string>();
      if(ids.length){const copies=await db.from("shopify_archivo_imagenes").select("image_id,storage_path").eq("store_id",store).in("image_id",ids);if(copies.error)throw Error("images failed");
        if(copies.data?.length){const signed=await db.storage.from("shopify-archivo").createSignedUrls(copies.data.map(c=>c.storage_path),3600);if(signed.error)throw Error("image URLs failed");const byPath=new Map((signed.data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));for(const c of copies.data){const url=byPath.get(c.storage_path);if(url)images.set(c.image_id,url);}}
      }
      rows=(r.data||[]).map(({record_id,payload:p,archived_at})=>({id:record_id,title:p.title||"Sin título",handle:p.handle||"",status:p.status||"",vendor:p.vendor||"",product_type:p.product_type||"",tags:p.tags||"",description:String(p.body_html||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim(),image_url:images.get(String(p.image?.id))||null,variants:(p.variants||[]).map((v:any)=>({id:String(v.id),title:v.title,sku:v.sku||"",internal_sku:internalCatalogSku(String(v.sku||""),String(v.id),skuCounts),sku_issue:!String(v.sku||"").trim()?"missing":(skuCounts.get(String(v.sku).trim().toLowerCase())||0)>1?"duplicate":null,price:v.price,compare_at_price:v.compare_at_price,barcode:v.barcode,inventory_quantity:v.inventory_quantity,inventory_item_id:String(v.inventory_item_id||"")})),archived_at}));
    }
    return NextResponse.json({rows,count:r.count,page,source:"kairo-archive"},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"No se pudo consultar el respaldo de Argentina"},{status:503});}
}

export function internalCatalogSku(original:string,variantId:string,counts:Map<string,number>):string{const clean=original.trim();return clean&&counts.get(clean.toLowerCase())===1?clean:`KAR-V${variantId}`;}
