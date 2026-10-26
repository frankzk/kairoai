import {describe,it,expect} from 'vitest';
import {payoutPeriod} from '@/lib/elogy-model';
describe('Italy bank cash period',()=>{
 it('separates statement, receipt and missing payment dates across months',()=>{
  const rows=[{statement_date:'2026-09-30',expected_cents:10000,received_at:'2026-10-02',received_cents:9500},{statement_date:'2026-10-01',expected_cents:20000,received_at:null,received_cents:null},{statement_date:'2026-09-01',expected_cents:900,received_at:'2026-09-02',received_cents:900}];
  const r=payoutPeriod(rows,{from:'2026-09-30T22:00:00.000Z',to:'2026-10-31T23:00:00.000Z'});
  expect(r.rows).toHaveLength(2);expect(r.expected).toBe(20000);expect(r.received).toBe(9500);
  expect(payoutPeriod(rows,null).received).toBe(10400);
 });
});
