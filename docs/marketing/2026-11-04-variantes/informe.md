# Asignación por producto y variantes

Marketing agrupa SKU actuales de Shopify y SKU históricos con nombre base idéntico y único bajo el mismo producto. Las coincidencias de nombre o SKU exactas y únicas se resuelven al leer el reporte; no se escriben asignaciones desde una petición GET. Los nombres parecidos y los catálogos ambiguos requieren revisión. Las asignaciones manuales tienen prioridad; «Sin asignar» persiste una exclusión de la regla automática. «Fijar asignación» guarda una coincidencia automática como elección manual.

El selector muestra productos completos. «Todas las variantes» incluye sus SKU actuales e históricos y se amplía con variantes futuras del catálogo. «Elegir variantes» guarda una lista explícita del mismo producto, que no se amplía sola. Las asignaciones anteriores conservan el SKU original.

Los pedidos se deduplican por producto o selección, aunque tengan varias variantes; las unidades conservan las cantidades. Cada campaña contribuye una vez al cálculo del producto padre. Las selecciones y el producto completo pueden solaparse: sus filas no son aditivas. El CPA sigue siendo pauta asignada / pedidos creados, no atribución individual; se mantienen los avisos de cobertura parcial y calendarios distintos. El inventario y la reposición siguen por SKU.

La migración aditiva agrega familia, alcance y miembros a marketing_campaign_products. Mantiene RLS y los permisos exclusivos del servidor. La API verifica permisos, tienda, cuenta, producto y variantes con datos del servidor; ignora nombres y claves calculadas que mande el cliente.

Validación: pruebas de coincidencia/ambigüedad, SKU reutilizado, selección inválida, persistencia y exclusión automática, deduplicación de pedidos y suma de gasto. Catálogo real de CR: 227 entradas → 146 productos; Fat-Burn tiene 29 SKU actuales/históricos, con dos variantes archivadas actuales. Stock ShipHero permanece pendiente.
