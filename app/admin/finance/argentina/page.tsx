import { redirect } from "next/navigation";
import OrdersPage from "@/components/italia/OrdersPage";
import { argentinaAccess } from "@/lib/argentina-server";
export const dynamic="force-dynamic";
export default function ArgentinaPage() {
  if(!argentinaAccess()) redirect("/cuenta");
  return <OrdersPage storeCode="kenku-ar"/>;
}
