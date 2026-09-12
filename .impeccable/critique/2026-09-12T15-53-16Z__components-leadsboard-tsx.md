---
target: el tablero de leads
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/home/user/kairoai/components/LeadsBoard.tsx"
target_fingerprint: "sha256:4a8b9c1861eb59a6860ca27146d159db73c4aa926dd41c3627ac72fba5d304bb"
target_path: /home/user/kairoai/components/LeadsBoard.tsx
timestamp: 2026-09-12T15-53-16Z
slug: components-leadsboard-tsx
---
Method: dual-agent (A: revisión de diseño · B: evidencia determinista)

## Design Health Score

| # | Heurística | Score | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado del sistema | 2 | `chartNow` congelado al montar (`:452`): tras 8 h de turno cada juicio de "hoy"/"vencido" se calcula contra la hora de carga, y nada en pantalla dice de cuándo son los datos. |
| 2 | Correspondencia con el mundo real | 3 | Voz CR/HN fuerte y un arreglo ganado ("Solo saludó" sobre "Frío"), pero "seguimiento" significa tres cosas en una pantalla: tab, `board_stage` y `work_state`. |
| 3 | Control y libertad del usuario | 1 | Sin `Esc` en el drawer, sin retorno de foco, y una gestión se escribe con un clic sin deshacer. |
| 4 | Consistencia y estándares | 1 | Seis categorías de violación de DESIGN.md confirmadas mecánicamente: chips y tabs redondos donde el sistema manda cuadrado, tabs como píldora sólida donde especifica subrayado, `destructive` sólido como etiqueta. |
| 5 | Prevención de errores | 2 | Bien: autocorrección del rango de fechas, drawer fijado a la tienda del lead. Mal: `<select onChange>` compromete uno de 19 estados —incluido `lista_negra`— en un solo evento. |
| 6 | Reconocer antes que recordar | 2 | Las cuatro bandas de prioridad se explican una vez, en prosa (`:1045`), y nunca se marcan en la lista. La posición 37 no dice en qué banda estás. |
| 7 | Flexibilidad y eficiencia | 1 | Cero atajos de teclado en una pantalla que se trabaja 8 h/día. Cero `onKeyDown`, cero `tabIndex`, cero manejo de `Escape` en 1.300 líneas. |
| 8 | Diseño estético y minimalista | 1 | ~30 controles interactivos antes de la primera tarjeta de lead. El número más grande de la pantalla es un backlog; las llamadas que quedan hoy van en `text-xs` dentro de un tab. |
| 9 | Diagnóstico y recuperación de errores | 2 | Un solo slot de `error` para carga, búsqueda y sync de Shopify, sin reintento. El fallo de portapapeles se traga en silencio. |
| 10 | Ayuda y documentación | 2 | Toda la ayuda vive en atributos `title`; cuatro de ellos sobre elementos no enfocables (`:1146, :1154, :1171, :1195`), invisibles por teclado y en táctil. |
| **Total** | | **18/40** | **Poor (borde superior) — ver la lectura abajo** |

Los tres heurísticos en 1 son composición (consistencia, flexibilidad, minimalismo), no lógica. El modelo de datos y la redacción están por encima de la media de software en producción; el score no captura eso bien.

## Design Specificity Verdict

**Fundamentado — con un órgano importado que no pertenece a este producto.**

La *lógica* de esta pantalla no se puede levantar y poner en otro producto. `SEGMENT_ORDER` y `RANK_SEGMENTO_BASE` codifican una escalera de conversión medida sobre 2.875 leads de esta base (41,4% / 15,8% / 1,5% / 1,0%): el orden de la lista *es* la estrategia comercial, y es derivado, no prestado. `STALE_FOLLOWUP_DAYS = 7` existe porque 174 recontactos vencidos coparon una vez las primeras 174 posiciones. `detectSinpeText` exige que lo diga el cliente porque el guion del bot lo decía. Eso es una interfaz de cola de llamadas específica.

**La excepción, y es lo más grande de la pantalla.** La tarjeta `Leads sin llamar` (`:686–781`) es instrumental analítico genérico: histograma de 15 barras con `h-40` y un KPI en `text-2xl`, ocupando los primeros ~260px del viewport. Es intercambiable con el tope de cualquier dashboard SaaS. Mide un *backlog* —un número que solo puede crecer mientras ella está al teléfono— y tiene más autoridad visual que la cola sobre la que se apoya.

El modelo es específico; la *jerarquía* es genérica. La queja del dueño es exactamente la brecha entre esos dos hechos.

**Escaneo determinista.** El detector mecánico de Impeccable dio **exit 0, cero hallazgos** sobre `components/LeadsBoard.tsx`. Eso es información en sí: su conjunto de reglas no cubre áreas táctiles, anillos de foco, orden de tabulación ni jerarquía, que es donde están los problemas reales. Las mediciones manuales sí encontraron:

- **6 controles por debajo de 24×24 px**: `:826` (22×22), `:902`, `:908`, `:965`, `:1031` (16px de alto, sin padding) y `:1257` (20×20, la X del drawer).
- **11 de 13 `<button>` crudos sin anillo de foco** (`:770, 826, 857, 877, 902, 908, 926, 948, 965, 1031, 1257`), contra el "Do" de DESIGN.md. Las instancias de `<Button>` sí lo traen.
- **Contraste calculado**: `text-muted-foreground` da 6,04:1 sobre el fondo (pasa AA). El modificador `/70` da **3,43:1 — falla AA**, y se aplica en `:706` (10px, la advertencia de que el número grande es solo un subconjunto) y `:1181` (12px, `lead.auto_reason`, la frase que explica por qué el lead está en la cola).
- **Inputs de fecha con `focus:ring-1`** (`:806, :822`) donde el sistema documenta 2px con separación.
- **`La Regla del Velo` rota en `:890`**: el pill de vencidos usa `bg-destructive` sólido mientras el banner del mismo concepto en `:860` usa la forma correcta con alfa.

**Overlays visuales:** no hay. La visualización en navegador se omitió a propósito: el egress a Supabase está bloqueado en este entorno, la app no puede renderizar datos reales y no hay dev server. No se levantó ningún servidor y no existe ningún overlay.

## Overall Impression

El cerebro de esta pantalla es mejor que su cara. La cola sabe exactamente a quién llamar —con un orden derivado de una medición propia— y después no se lo dice a nadie: tira el rango que calculó, lo explica en una frase de prosa, y le da el tamaño de letra más grande de la pantalla a un número que no es accionable.

La oportunidad más grande no es agregar nada. Es **mostrar la estructura que la cola ya conoce** y **degradar el histograma**.

## What's Working

1. **La cola ordenada con posición visible.** `buildWorkQueue` devuelve los leads pre-ordenados y `LeadCard` pinta `queuePosition` con chip primario y realce en la posición 1. Funciona porque el orden es *defendible ante la persona que lo sigue*: sale de una medición de esta base, no de una jerarquía que alguien dibujó.

2. **Facetas numéricamente honestas.** `leadsDelTab` cuenta los chips sobre exactamente la población del tab activo con el filtro de intención removido, así que los chips suman el total del tab y el número del chip es el número que recibís al hacer clic. Eso mató una contradicción reportada.

3. **Negarse a mentir sobre lo que un número significa.** `overdue` (`:597–609`) parte 174 vencidos en 15 promesas reales y 159 reintentos del sistema, porque decirle a la asesora que 174 clientes pidieron que los llamara era —en palabras del comentario— "sencillamente, falso".

## Priority Issues

### [P0] La estructura de prioridad de la cola es invisible, y el backlog la supera en jerarquía

`buildWorkQueue` conoce la banda de cada lead (`queueRank`) pero **la descarta**: devuelve un `T[]` plano. La UI compensa con una frase en prosa (`:1040–1055`) y un contador monótono. Nada en la lista marca dónde terminan los "recontactos vencidos" y empiezan los "sin llamar". Al mismo tiempo el número más grande de la página (`text-2xl`, `:703`) es el backlog, y el que define su día es un pill `text-xs` dentro de un tab.

**Por qué importa:** es la queja del dueño, literal. No puede distinguir de un vistazo si está trabajando promesas que ella hizo o leads fríos que nadie tocó — dos llamadas completamente distintas, con dos aperturas distintas.

**Arreglo:** que `buildWorkQueue` devuelva `{ lead, rank }`; encabezados de banda pegajosos en la lista usando `overdue.prometidos` / `overdue.reintentos` que ya se calculan y hoy se tiran; borrar la frase en prosa; poner "Quedan N llamadas hoy" en `text-3xl` donde está el backlog, y colapsar el histograma a una tira de una línea debajo de la lista.

**Comando sugerido:** `/impeccable layout`

### [P1] `chartNow` congelado al montar: "Hoy" se degrada durante el turno

`useState(() => new Date())` en `:452` alimenta `matchesTab`, `visibleLeads`, `uncalledBuckets`, `leadsDelTab` y `tabCount`. Sin intervalo, sin re-key, sin timestamp visible. Un recontacto prometido para las 14:00 nunca aparece en Hoy si la página se cargó a las 8:00. Peor: `Actualizar` refresca datos pero **no avanza `chartNow`**, así que el remedio del usuario no funciona.

**Arreglo:** tick de 60 s, avanzarlo dentro de `load()`, y renderizar "Actualizado 14:32" al lado del botón.

**Comando sugerido:** `/impeccable harden`

### [P1] Sin camino por teclado y sin deshacer en la única acción destructiva

Seis acciones de puntero por lead, cero atajos, sin `Esc`, y `CallButton` existe solo *dentro* del drawer — en una cola de llamadas, el botón de llamar está un nivel demasiado profundo. La gestión es un clic único sin confirmar ni deshacer que además escribe una fecha de recontacto.

**Arreglo:** `j`/`k` mueven un cursor con foco visible, `Enter` abre, `Esc` cierra, `c` llama; `CallButton` en la tarjeta; `GestionBar` pegada al fondo del drawer; "Deshacer" colgado del `savedStatus` que ya existe; "Siguiente llamada →" en el pie del drawer.

**Comando sugerido:** `/impeccable harden`

### [P1] La red de seguridad de búsqueda aproximada no puede dispararse nunca

El servidor devuelve teléfonos parecidos con `aproximado: true` y hay un banner ámbar escrito para eso (`:1017`). Pero `searchMatches` re-filtra los resultados del servidor por el predicado del cliente (`:447–450`), y `matchesSearch` exige `l.phone.includes(q)`. Un match *aproximado* por definición no contiene lo tecleado, así que **todo resultado difuso se filtra**. `visibleLeads` queda en 0, se renderiza "Sin resultados", y el banner —que vive dentro de la rama no vacía— nunca aparece.

**Por qué importa:** la función existe porque la asesora se equivoca en un dígito leyendo un número de una pantalla. Hoy recibe "sin resultados" y concluye que el lead no existe. Sin workaround desde la UI.

**Arreglo:** que las filas devueltas por el servidor no pasen por el predicado del cliente (un `Set` de ids que hace bypass), y sacar el banner de la rama de lista vacía.

**Comando sugerido:** `/impeccable harden`

### [P2] La deriva del sistema de diseño está gastando su propia señal

Chips (`:928, :952`) y tabs (`:881`) son `rounded-full` donde DESIGN.md dice cuadrado y reserva el redondo **exclusivamente** para el badge de estado. Como las dos filas de filtros ahora son píldoras y `LeadCard` pinta hasta cinco píldoras reales, la forma ya no distingue *filtro* de *estado* en ninguna parte. Y `SEGMENT_VARIANT.enganchado = "destructive"` (`:180`) pinta **"🔥 Enganchado" —un segmento informativo y positivo, del 15,8% de conversión— del mismo rojo que una promesa incumplida** (`FollowupBadge`), a 12px de distancia en la misma fila.

**Por qué importa:** ella escanea por color. Cuando el rojo significa a la vez "tu mejor lead" y "vas tarde", el escaneo deja de funcionar y tiene que leer cada fila.

**Arreglo:** cuadrar las dos filas de filtros; tab activo como subrayado de 2px; `Enganchado` a `warning`; el rojo queda exclusivo de lo vencido.

**Comando sugerido:** `/impeccable polish`

## Persona Red Flags

**Alex (power user impaciente — la asesora *es* Alex: 8 h/día, una pantalla)**
- Cero interacción por teclado en 1.300 líneas. Seis acciones de puntero × ~200 leads/día.
- Sin `Esc` para cerrar el drawer.
- `CallButton` enterrado: existe solo dentro del drawer. En una cola de llamadas, llamar exige abrir un panel de chat primero.
- Amnesia de paginación: `shownCount` vuelve a 50 con cualquier cambio de tab, orden, tienda o rango. Con 200 filas en Seguimiento, un clic en el orden la manda de vuelta a la fila 50.
- La lista se re-ordena debajo de ella: `onGestionDone` → `onRefresh` → `load()` refetchea el tablero entero con el drawer abierto; el lead gestionado suele salir de Hoy; al cerrar, su lugar ya no está y nada ofrece "siguiente".
- Su panel de productividad —su paga— arranca apagado todas las mañanas.

**Sam (solo teclado, lector de pantalla, 4,5:1)**
- **El drawer no es un diálogo.** Sin `role="dialog"`, sin `aria-modal`, sin trampa de foco, sin retorno de foco, sin `Esc`. Puede tabular fuera del drawer hacia el tablero vivo *debajo* de un overlay opaco, operando controles que no ve. El cierre por clic en el backdrop no tiene equivalente por teclado.
- **15 botones del gráfico van antes del buscador en orden de DOM.** Tabula por hasta 19–20 paradas —la mayoría barras sobre las que no puede actuar— antes de llegar a algo que sirva. Sin skip link. Es el peor hecho de orden de teclado de la página.
- **El ARIA está invertido.** Las barras del histograma tienen `aria-pressed` y `aria-label` escrito a mano; los **tabs** no tienen `role="tab"` ni `aria-selected` ni nombre accesible, y los **chips de intención** no tienen `aria-pressed`. Los dos controles que definen qué hay en pantalla son los dos que están mudos.
- Las etiquetas de tab se leen como cuatro fragmentos sin relación (`🎯` + `Hoy` + `174 vencidos` + `619`).
- Toda la ayuda es `title`: `SEGMENT_META[].hint` —que carga la tasa de conversión que justifica el orden entero de la cola— solo se alcanza con el mouse encima.
- Dos fallos de contraste medidos, los dos en texto explicativo: `/70` a 3,43:1 en `:706` y `:1181`.
- `<select onChange>` compromete estado al navegar con flechas: puede escribir `lista_negra` irreversiblemente.

## Minor Observations

- Acentos faltantes en cadenas de UI ("telefono", "Copiar numero", "Selecciona quien eres") en una pantalla que por lo demás escribe "antigüedad" y "confirmá" con cuidado. Los comentarios del código van sin acento a propósito; las cadenas de UI no deberían heredarlo.
- `TAB_META.descartado.hint = "Terminales"`: ninguna asesora va a parsear esa palabra.
- `role="group"` en el histograma debería ser `toolbar` o un radiogroup etiquetado: las barras son filtros mutuamente excluyentes.
- Cinco estados de carga distintos colapsan en dos cadenas; dos ramas distintas renderizan el mismo "Cargando...".
- Un solo slot de `error` para tres operaciones: un "Error al sincronizar Borradores de Shopify" viejo puede quedar sobre una lista exitosa indefinidamente.
- `FollowupBadge` recalcula `Date.now()` por render mientras la cola usa el `chartNow` congelado: **dos relojes en una tarjeta**. Un badge puede decir "Seguir hoy" en una tarjeta que la cola colocó como no vencida.
- `BOARD_VIEWS` sigue describiendo el modelo abandonado de siete tabs, e `interface BoardView` está declarada dos veces. Código muerto que contradice la arquitectura actual.

## Questions to Consider

1. **Si `buildWorkQueue` ya sabe cuál es la próxima llamada, ¿por qué esto es un tablero?** Todo el aparato de arriba existe para que ella *construya* una vista, pero `queueRank` ya decidió. ¿Qué costaría una superficie de un lead a la vez —este cliente, su historia, Llamar, las seis gestiones, Siguiente— con el tablero degradado a una pestaña de búsqueda que abre cuando algo sale mal?
2. **El histograma cuenta leads que nadie llamó, un número que solo sube mientras ella está al teléfono. ¿Qué se supone que haga con eso?** Si la respuesta honesta es "nada, es para el dueño", entonces es la métrica *del dueño* ocupando los 260px más valiosos de la pantalla *de la asesora*, donde funciona como recordatorio permanente de una deuda impagable.
3. **Mediste que un carrito convierte 41,4% y un conversó 1,5% — 27×. ¿Le creés a tu propio número?** Si sí, los 1.484 conversós y 900 saludos de la cola no son su trabajo. ¿Cómo se ve Hoy si *solo* contiene pagos + prometidos + por cerrar + carrito + enganchado, y los otros 2.384 son invisibles por defecto? Esa cola es lo bastante corta como para *terminarse* — lo que haría de "estoy al día" un estado que esta interfaz podría expresar por primera vez.
