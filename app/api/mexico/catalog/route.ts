import {NextRequest} from "next/server";
import {mexicoArchiveList} from "@/lib/mexico-archive";
export const dynamic="force-dynamic";
export const GET=(req:NextRequest)=>mexicoArchiveList(req,"product");
