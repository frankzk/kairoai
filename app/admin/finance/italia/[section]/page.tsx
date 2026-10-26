import {notFound} from "next/navigation";
import ElogyWorkspace from "@/components/italia/ElogyWorkspace";
export default function Page({params}:{params:{section:string}}){
 if(!["logistica","liquidaciones","rentabilidad","costos","gastos","cierre"].includes(params.section))notFound();
 return <ElogyWorkspace section={params.section}/>;
}
