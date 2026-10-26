import Archive from "@/components/MexicoArchive";
import {argentinaAccess} from "@/lib/argentina-server";
import {redirect} from "next/navigation";
export const dynamic="force-dynamic";
export default function Page(){if(!argentinaAccess())redirect("/cuenta");return <Archive region="argentina" kind="catalog"/>;}
