import {NextRequest} from "next/server";
import {argentinaArchiveList} from "@/lib/argentina-archive";
export const dynamic="force-dynamic";
export const GET=(req:NextRequest)=>argentinaArchiveList(req,"customer");
