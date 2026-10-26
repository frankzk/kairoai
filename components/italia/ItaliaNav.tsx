"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {FileSpreadsheet,Truck,ReceiptText,BarChart3,Package,Wallet,CalendarDays} from "lucide-react";
import {leerYo} from "@/lib/sesion-cliente";
const tabs=[
 {label:"Pedidos",path:"",icon:FileSpreadsheet,finance:false},
 {label:"Logística Elogy",path:"logistica",icon:Truck,finance:false},
 {label:"Liquidaciones",path:"liquidaciones",icon:ReceiptText,finance:true},
 {label:"Rentabilidad",path:"rentabilidad",icon:BarChart3,finance:true},
 {label:"Costos por SKU",path:"costos",icon:Package,finance:true},
 {label:"Gastos",path:"gastos",icon:Wallet,finance:true},
 {label:"Cierre mensual",path:"cierre",icon:CalendarDays,finance:true},
];
export default function ItaliaNav(){
 const path=usePathname(),[finance,setFinance]=useState(false);
 useEffect(()=>setFinance(Boolean(leerYo()?.permisos.includes("finanzas"))),[]);
 return <nav aria-label="Herramientas de Italia" className="min-w-0 overflow-x-auto border-b border-border"><div className="flex min-w-max">{tabs.filter(t=>!t.finance||finance).map(t=>{const href=`/admin/finance/italia${t.path?`/${t.path}`:""}`,active=path===href;return <Link key={t.path} href={href} aria-current={active?"page":undefined} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"}`}><t.icon size={14}/>{t.label}</Link>;})}</div></nav>;
}
