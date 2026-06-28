-- iComfly legacy store cleanup.
--
-- SAFE BY DEFAULT:
-- - Preflight queries are read-only.
-- - The apply transaction ends with ROLLBACK by default.
-- - To apply for real, review the returned rows/counts, then change only the
--   final ROLLBACK to COMMIT and rerun the transaction.
--
-- Context:
-- - Kairo internal Costa Rica store_id: 1 (mireva-cr)
-- - iComfly external store/account id: 71
-- - 71 must not be used as an operational Kairo store_id.

-- ---------------------------------------------------------------------------
-- 1) Preflight: stores and current distribution.
-- ---------------------------------------------------------------------------

select id, code, name, active
from stores
where id in (1, 2, 71)
order by id;

select store_id, count(*) as rows
from icomfly_orders
group by store_id
order by store_id;

select
  'legacy_not_duplicated' as bucket,
  count(*) as rows
from icomfly_orders legacy
where legacy.store_id = 71
  and not exists (
    select 1
    from icomfly_orders target
    where target.store_id = 1
      and target.icomfly_order_id = legacy.icomfly_order_id
  )
union all
select
  'legacy_already_present_in_store_1' as bucket,
  count(*) as rows
from icomfly_orders legacy
where legacy.store_id = 71
  and exists (
    select 1
    from icomfly_orders target
    where target.store_id = 1
      and target.icomfly_order_id = legacy.icomfly_order_id
  )
order by bucket;

select
  legacy.dispatch_state,
  count(*) as rows
from icomfly_orders legacy
where legacy.store_id = 71
  and not exists (
    select 1
    from icomfly_orders target
    where target.store_id = 1
      and target.icomfly_order_id = legacy.icomfly_order_id
  )
group by legacy.dispatch_state
order by legacy.dispatch_state;

-- Small sample of rows that would move.
select
  legacy.icomfly_order_id,
  legacy.order_number,
  legacy.shopify_display_number,
  legacy.dispatch_state,
  legacy.icomfly_created_at,
  legacy.synced_at
from icomfly_orders legacy
where legacy.store_id = 71
  and not exists (
    select 1
    from icomfly_orders target
    where target.store_id = 1
      and target.icomfly_order_id = legacy.icomfly_order_id
  )
order by legacy.icomfly_created_at desc nulls last, legacy.synced_at desc
limit 25;

-- Small sample of duplicated legacy rows that will NOT move.
select
  legacy.icomfly_order_id,
  legacy.order_number,
  legacy.dispatch_state as legacy_state,
  target.dispatch_state as current_state,
  legacy.synced_at as legacy_synced_at,
  target.synced_at as current_synced_at
from icomfly_orders legacy
join icomfly_orders target
  on target.store_id = 1
 and target.icomfly_order_id = legacy.icomfly_order_id
where legacy.store_id = 71
order by target.synced_at desc nulls last, legacy.synced_at desc nulls last
limit 25;

-- ---------------------------------------------------------------------------
-- 2) Apply transaction: dry-run by default because it ends with ROLLBACK.
-- ---------------------------------------------------------------------------

begin;

with moved as (
  update icomfly_orders legacy
  set store_id = 1
  where legacy.store_id = 71
    and not exists (
      select 1
      from icomfly_orders target
      where target.store_id = 1
        and target.icomfly_order_id = legacy.icomfly_order_id
    )
  returning
    legacy.icomfly_order_id,
    legacy.order_number,
    legacy.dispatch_state,
    legacy.icomfly_created_at,
    legacy.synced_at
)
select
  count(*) as moved_rows,
  min(icomfly_created_at) as oldest_created_at,
  max(icomfly_created_at) as newest_created_at
from moved;

-- Validation inside the same transaction. If this returns 0, all movable rows
-- were remapped. Duplicated legacy rows can still remain under store_id=71.
select count(*) as remaining_legacy_not_duplicated
from icomfly_orders legacy
where legacy.store_id = 71
  and not exists (
    select 1
    from icomfly_orders target
    where target.store_id = 1
      and target.icomfly_order_id = legacy.icomfly_order_id
  );

select store_id, count(*) as rows
from icomfly_orders
group by store_id
order by store_id;

-- Keep ROLLBACK for the first execution. To apply for real, change only this
-- line to COMMIT after reviewing moved_rows and validation counts.
rollback;
