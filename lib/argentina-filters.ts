import { italiaDateRange } from "./italia-filters";
import { ARGENTINA_WORKSPACE } from "./management-workspace";
export function argentinaDateRange(period:string,start="",end="",now=new Date()) {
  return italiaDateRange(period,start,end,now,ARGENTINA_WORKSPACE.timeZone);
}
