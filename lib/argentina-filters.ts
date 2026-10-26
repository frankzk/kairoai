import { orderDateRange } from "./italia-filters";
import { kenkuManagementStore } from "./kenku-management";
export function argentinaDateRange(period:string,start="",end="",now=new Date()) {
  return orderDateRange(kenkuManagementStore("kenku-ar").timeZone,period,start,end,now);
}
