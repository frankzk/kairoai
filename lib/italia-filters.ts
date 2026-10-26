import { ITALIA_STATUS, type ItaliaStatus } from "./italia-orders";

export const ITALIA_PERIODS = [
  ["today", "Hoy"], ["yesterday", "Ayer"], ["7d", "7 días"],
  ["30d", "30 días"], ["month", "Mes"], ["all", "Todo"], ["range", "Rango"],
] as const;
export type ItaliaPeriod = typeof ITALIA_PERIODS[number][0];
export type ItaliaCounts = Record<ItaliaStatus, number>;
export const ITALIA_STATES = Object.keys(ITALIA_STATUS) as ItaliaStatus[];
const dayFormat = (timeZone:string) => new Intl.DateTimeFormat("en-CA", {timeZone, year:"numeric",month:"2-digit",day:"2-digit"});
const timeFormat = (timeZone:string) => new Intl.DateTimeFormat("en-GB", {timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});

function validDay(day: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day;
}
function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0,10);
}
/** Convert each calendar boundary separately: Rome days can have 23 or 25 hours. */
function midnight(day: string, timeZone: string): string {
  const target = Date.parse(`${day}T00:00:00Z`);
  let utc = target;
  for (let i=0;i<3;i++) {
    const parts = Object.fromEntries(timeFormat(timeZone).formatToParts(utc).map(p=>[p.type,p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    utc += target-local;
  }
  return new Date(utc).toISOString();
}
export function italiaDateRange(period: string, start="", end="", now=new Date(), timeZone="Europe/Rome"): {from:string;to:string}|null {
  if (!ITALIA_PERIODS.some(([key])=>key===period)) throw Error("Periodo inválido");
  if (period==="all") return null;
  const today=dayFormat(timeZone).format(now);
  let from=today, through=today;
  if(period==="yesterday") from=through=shift(today,-1);
  if(period==="7d") from=shift(today,-6);
  if(period==="30d") from=shift(today,-29);
  if(period==="month") from=`${today.slice(0,7)}-01`;
  if(period==="range") {
    if(!validDay(start)||!validDay(end)||start>end) throw Error("Elige un rango de fechas válido");
    from=start;through=end;
  }
  return {from:midnight(from,timeZone),to:midnight(shift(through,1),timeZone)};
}
