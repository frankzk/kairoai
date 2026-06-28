# Manual Supabase SQL

Estos archivos no son migraciones automaticas. Son runbooks operativos para
copiar y ejecutar manualmente en Supabase SQL Editor despues de revisar backup,
preflight y ventana de operacion.

Reglas:

- No se ejecutan como parte de `supabase/migrations`.
- Deben tener preflight de lectura antes de cualquier escritura.
- Si contienen escritura, deben venir con `ROLLBACK` por defecto o con la parte
  de escritura comentada.
- No se aplican en produccion sin confirmacion explicita.
