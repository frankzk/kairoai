-- Enriquecimiento del chat: cuantos mensajes escribio el cliente y cual fue el
-- primero. Alimenta el segmento "Converso" del tablero (lib/leads-segment.ts).
--
-- POR QUE HACE FALTA: el transcript se lee en vivo de Icomfly cuando se abre el
-- drawer y no se persiste, asi que `inbound_count` existia como columna pero
-- nadie la escribia (0 de 20.140 leads). Sin esto, dos de los cuatro segmentos
-- del tablero quedan vacios.

-- El primer mensaje del cliente. Vale por si solo: cuando alguien toca
-- "consultar por WhatsApp" desde la ficha de un producto, el mensaje llega
-- prellenado con la URL. Es un unico mensaje, pero dice que producto quiere —
-- contarlo como "solo saludo" lo hunde al fondo de la cola junto a quien
-- escribio "hola" y nada mas.
alter table leads add column if not exists first_inbound_text text;

-- Cuando se leyo el transcript por ultima vez. Hace de cursor: se re-lee solo
-- si la conversacion crecio (last_interaction_at > inbound_synced_at), asi el
-- barrido termina en vez de dar vueltas para siempre.
alter table leads add column if not exists inbound_synced_at timestamptz;

-- Indice de la cola de enriquecimiento: los que nunca se leyeron primero, y
-- dentro de esos los mas recientes (que son los que se ven en el tablero).
create index if not exists leads_inbound_pending_idx
  on leads (store_id, inbound_synced_at nulls first, last_interaction_at desc)
  where crm_conversation_id is not null;

-- La seleccion va por RPC y no por PostgREST porque la condicion compara DOS
-- COLUMNAS entre si (last_interaction_at > inbound_synced_at), y los filtros de
-- PostgREST solo comparan una columna contra un valor.
create or replace function leads_pending_inbound(p_store_id bigint, p_limit int)
returns table (
  id bigint,
  crm_conversation_id text,
  inbound_count int,
  first_inbound_text text
)
language sql
stable
as $$
  select l.id, l.crm_conversation_id, l.inbound_count, l.first_inbound_text
  from leads l
  where l.store_id = p_store_id
    and l.crm_conversation_id is not null
    and l.category in ('open', 'hot')
    and (l.inbound_synced_at is null
         or (l.last_interaction_at is not null
             and l.last_interaction_at > l.inbound_synced_at))
  order by l.inbound_synced_at asc nulls first,
           l.last_interaction_at desc nulls last
  limit greatest(p_limit, 0);
$$;

create or replace function leads_pending_inbound_count(p_store_id bigint)
returns bigint
language sql
stable
as $$
  select count(*)
  from leads l
  where l.store_id = p_store_id
    and l.crm_conversation_id is not null
    and l.category in ('open', 'hot')
    and (l.inbound_synced_at is null
         or (l.last_interaction_at is not null
             and l.last_interaction_at > l.inbound_synced_at));
$$;
