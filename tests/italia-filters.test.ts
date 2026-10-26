import {describe,it,expect} from "vitest";
import {italiaDateRange} from "@/lib/italia-filters";

describe("Periodos de Gestión Italia",()=>{
  it("uses Rome's day even when the UTC date has not changed yet",()=>{
    expect(italiaDateRange("today","","",new Date("2026-07-10T23:30:00Z"))).toEqual({from:"2026-07-10T22:00:00.000Z",to:"2026-07-11T22:00:00.000Z"});
  });
  it("covers all 25 hours of autumn and 23 of spring",()=>{
    expect(italiaDateRange("range","2026-10-25","2026-10-25")).toEqual({from:"2026-10-24T22:00:00.000Z",to:"2026-10-25T23:00:00.000Z"});
    expect(italiaDateRange("range","2026-03-29","2026-03-29")).toEqual({from:"2026-03-28T23:00:00.000Z",to:"2026-03-29T22:00:00.000Z"});
  });
  it("calculates yesterday, month and rolling calendar days with exclusive end",()=>{
    const now=new Date("2026-10-26T12:00:00Z");
    expect(italiaDateRange("yesterday","","",now)).toEqual(italiaDateRange("range","2026-10-25","2026-10-25"));
    expect(italiaDateRange("7d","","",now)).toEqual(italiaDateRange("range","2026-10-20","2026-10-26"));
    expect(italiaDateRange("30d","","",now)).toEqual(italiaDateRange("range","2026-09-27","2026-10-26"));
    expect(italiaDateRange("month","","",now)).toEqual(italiaDateRange("range","2026-10-01","2026-10-26"));
    expect(italiaDateRange("all")).toBeNull();
  });
  it("rejects incomplete, reversed, non-calendar and injected date ranges",()=>{
    for(const [period,from,to] of [["bad","",""],["range","2026-10-25",""],["range","2026-10-26","2026-10-25"],["range","2026-02-30","2026-03-01"],["range","2026-10-25T00:00:00Z","2026-10-25"]])expect(()=>italiaDateRange(period,from,to)).toThrow();
  });
});
