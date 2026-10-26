const meta='id namespace key type value description';
const money='shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}';
const transaction=`id kind status gateway formattedGateway createdAt processedAt test amountSet{${money}} parentTransaction{id}`;
const bulk=(resource,body)=>({resource,kind:'bulk',query:`{${body}}`});
const page=(resource,root,fields,args='')=>({resource,kind:'graphql',root,query:`query($after:String){${root}(first:100,after:$after${args}){nodes{${fields}} pageInfo{hasNextPage endCursor}}}`});
const plans=[
 {resource:'access',kind:'graphql',query:'{currentAppInstallation{accessScopes{handle}} shop{id name currencyCode ianaTimezone myshopifyDomain primaryDomain{url}} ordersCount(limit:null,query:"status:any"){count precision} customersCount(limit:null){count precision} productsCount{count precision}}'},
 bulk('orders_finance',`orders(query:"status:any",sortKey:ID){edges{node{id legacyResourceId name updatedAt currencyCode displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet{${money}} totalReceivedSet{${money}} totalRefundedSet{${money}} transactions{${transaction}} refunds{id createdAt note totalRefundedSet{${money}}}}}}`),
 bulk('orders_history',`orders(query:"status:any",sortKey:ID){edges{node{id name events{edges{node{id createdAt message}}} metafields{edges{node{${meta}}}}}}}`),
 bulk('orders_fulfillments',`orders(query:"status:any",sortKey:ID){edges{node{id name fulfillments{id name status displayStatus createdAt updatedAt deliveredAt inTransitAt estimatedDeliveryAt trackingInfo{company number url}} fulfillmentOrders{edges{node{id status requestStatus assignedLocation{name location{id}} lineItems{edges{node{id totalQuantity remainingQuantity lineItem{id}}}}}}}}}}`),
 bulk('customers_details',`customers(sortKey:ID){edges{node{id legacyResourceId firstName lastName email phone note tags createdAt updatedAt metafields{edges{node{${meta}}}}}}}`),
 {resource:'products_extended',kind:'bulk',query:''},
 page('inventory_items','inventoryItems','id legacyResourceId sku tracked requiresShipping countryCodeOfOrigin harmonizedSystemCode unitCost{amount currencyCode} inventoryLevels(first:100){nodes{id location{id name} quantities(names:["available","on_hand","committed","incoming","reserved","damaged","safety_stock","quality_control"]){name quantity}} pageInfo{hasNextPage endCursor}}'),
 page('files','files','__typename id alt createdAt updatedAt fileStatus ...on MediaImage{image{url width height} originalSource{url}} ...on GenericFile{url mimeType originalFileSize} ...on Video{sources{url mimeType format}} ...on Model3d{sources{url mimeType format}}'),
 page('themes','themes','id name role createdAt updatedAt'),
 page('menus','menus','id handle title items{id title type url resourceId tags items{id title type url resourceId tags items{id title type url resourceId tags}}}'),
 page('metaobject_definitions','metaobjectDefinitions','id type name description fieldDefinitions{key name type{name} required validations{name value}}'),
 page('markets','markets','id name handle status primary'),
 page('discounts','discountNodes','id discount{__typename ...on DiscountCodeBasic{title status startsAt endsAt codes(first:250){nodes{code} pageInfo{hasNextPage endCursor}}} ...on DiscountAutomaticBasic{title status startsAt endsAt}}'),
 {resource:'shipping_zones',kind:'rest',path:'/shipping_zones.json'},
 {resource:'carrier_services',kind:'rest',path:'/carrier_services.json'},
 {resource:'fulfillment_services',kind:'rest',path:'/fulfillment_services.json'},
 {resource:'shopify_payments_payouts',kind:'rest',path:'/shopify_payments/payouts.json'},
 {resource:'shopify_payments_balance_transactions',kind:'rest',path:'/shopify_payments/balance/transactions.json'},
 {resource:'gift_cards',kind:'rest',path:'/gift_cards.json'},
 {resource:'script_tags',kind:'rest',path:'/script_tags.json'},
];
for(const owner of ['PRODUCT','PRODUCTVARIANT','CUSTOMER','ORDER','COLLECTION','SHOP','PAGE','BLOG','ARTICLE'])plans.push(page('definitions_'+owner.toLowerCase(),'metafieldDefinitions','id name namespace key description type{name} validations{name value}',`,ownerType:${owner}`));
plans.push({resource:'locales',kind:'graphql',query:'{shopLocales{locale name primary published}}'});
const inventory=plans.find(p=>p.resource==='inventory_items');inventory.query=inventory.query.replace('inventoryItems(first:100','inventoryItems(first:20').replace('inventoryLevels(first:100)','inventoryLevels(first:10)');
const connection=(name,fields,args='')=>name+(args?'('+args+')':'')+'{edges{node{'+fields+'}}}';
const productPlan=plans.find(p=>p.resource==='products_extended');
productPlan.query='{'+connection('products','id legacyResourceId title handle status descriptionHtml vendor productType tags seo{title description} '+connection('metafields',meta)+' '+connection('variants','id legacyResourceId title sku barcode price compareAtPrice inventoryItem{id unitCost{amount currencyCode}} '+connection('metafields',meta))+' '+connection('media','__typename id alt mediaContentType ...on MediaImage{image{url width height}} ...on Video{sources{url mimeType format}} ...on ExternalVideo{originUrl embeddedUrl} ...on Model3d{sources{url mimeType format}}'),'sortKey:ID')+'}';
const types=['MenuItem','DiscountCodeBasic','DiscountAutomaticBasic','Order','OrderTransaction','Event','CommentEvent','InventoryItem','OnlineStoreThemeFileBodyBase64','OnlineStoreThemeFileBodyUrl','QueryRoot','MediaImage','GenericFile','Shop','ShopifyPaymentsAccount','Metaobject','Market','Product','ProductVariant','Fulfillment','FulfillmentEvent','Return','Refund'];
plans.push({resource:'schema',kind:'graphql',query:'{'+types.map((name,i)=>`t${i}:__type(name:"${name}"){name fields(includeDeprecated:true){name type{kind name ofType{kind name ofType{kind name}}} args{name type{kind name ofType{kind name}}}}}`).join(' ')+'}'});
function themePlan(id){return {resource:'theme_files_'+id.split('/').at(-1),kind:'graphql',root:'theme.files',variables:{id},query:'query($id:ID!,$after:String){theme(id:$id){files(first:10,after:$after){nodes{filename contentType checksumMd5 size updatedAt body{...on OnlineStoreThemeFileBodyText{content} ...on OnlineStoreThemeFileBodyBase64{contentBase64} ...on OnlineStoreThemeFileBodyUrl{url}}} pageInfo{hasNextPage endCursor}}}}'};}
function metaobjectPlan(type){return {resource:'metaobjects_'+require('crypto').createHash('sha256').update(type).digest('hex').slice(0,16),kind:'graphql',root:'metaobjects',variables:{type},query:'query($type:String!,$after:String){metaobjects(type:$type,first:100,after:$after){nodes{id type handle updatedAt fields{key type value}} pageInfo{hasNextPage endCursor}}}'};}
function translationPlan(type,locale){return {resource:'translation_'+type.toLowerCase()+'_'+locale.replace(/[^a-z0-9]/gi,'_').toLowerCase(),kind:'graphql',root:'translatableResources',variables:{locale},query:`query($locale:String!,$after:String){translatableResources(resourceType:${type},first:100,after:$after){nodes{resourceId translatableContent{key value locale digest} translations(locale:$locale){key value locale outdated}} pageInfo{hasNextPage endCursor}}}`};}
module.exports={plans,themePlan,metaobjectPlan,translationPlan};
