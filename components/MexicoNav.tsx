"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
export default function MexicoNav(){const pathname=usePathname();return <nav aria-label="Kenku México" className="flex gap-1 border-b border-border text-xs">{[["/admin/finance/mexico","Pedidos"],["/admin/finance/mexico/customers","Clientes"],["/admin/finance/mexico/catalog","Catálogo"]].map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?"page":undefined} className={`border-b-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname===href?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</Link>)}</nav>;}
