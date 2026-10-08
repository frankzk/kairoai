---
name: kairoai
description: Sala de control para operación COD — leads, despacho, novedades y rentabilidad en una sola consola densa.
colors:
  background: "hsl(224 71% 4%)"
  card: "hsl(224 71% 6%)"
  muted: "hsl(223 47% 11%)"
  secondary: "hsl(215 27.9% 16.9%)"
  border: "hsl(216 34% 17%)"
  input: "hsl(216 34% 17%)"
  accent: "hsl(216 34% 17%)"
  foreground: "hsl(213 31% 91%)"
  muted-foreground: "hsl(215.4 16.3% 56.9%)"
  popover-foreground: "hsl(215 20.2% 65.1%)"
  on-accent: "hsl(210 20% 98%)"
  primary: "hsl(263 70% 50%)"
  destructive: "hsl(0 63% 31%)"
  status-good: "#34d399"
  status-good-strong: "#10b981"
  status-good-soft: "#6ee7b7"
  status-warn: "#f59e0b"
  status-warn-light: "#fbbf24"
  status-warn-soft: "#fde68a"
  status-bad: "#f87171"
  status-bad-strong: "#ef4444"
  status-bad-soft: "#fecaca"
  status-info: "#67e8f9"
  status-info-strong: "#22d3ee"
  status-critical: "#f43f5e"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
  label-loud:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.025em"
  label-micro:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  label-nano:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  none: "0"
  sm: "calc(0.5rem - 4px)"
  md: "calc(0.5rem - 2px)"
  lg: "0.5rem"
  full: "9999px"
spacing:
  hairline: "4px"
  tight: "6px"
  chip: "8px"
  dense: "12px"
  card: "16px"
  room: "24px"
  gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
    typography: "{typography.body}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
  chip-dense:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.none}"
    padding: "4px 8px"
    typography: "{typography.label}"
  chip-dense-active:
    backgroundColor: "hsl(263 70% 50% / 0.1)"
    textColor: "{colors.primary}"
    rounded: "{rounded.none}"
    padding: "4px 8px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "hsl(263 70% 50% / 0.9)"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "24px"
  ministat:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.none}"
    padding: "12px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
    typography: "{typography.body}"
  tab:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
    typography: "{typography.body}"
  tab-active:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
---

# Design System: kairoai

## Overview

**Creative North Star: "La Sala de Control"**

kairoai no es un dashboard que se consulta: es un panel de instrumentos que alguien trabaja de turno. La asesora vive en la pantalla de Leads decidiendo a quién llamar ahora; el operador vive en Finanzas decidiendo qué pedido cuadra y qué liquidación falta cobrar. Las dos personas necesitan la misma cosa: el máximo de información cierta por pantalla, iluminada por estado, sin tener que hacer scroll para saber si algo anda mal.

De ahí sale la densidad, y la densidad es una decisión, no un descuido. La escala tipográfica está corrida hacia abajo a propósito — 481 usos de 12px contra 188 de 14px — porque un dato más visible vale más que un dato más grande. Las esquinas de los controles compactos son rectas porque la recta se alinea en cuadrícula y ahorra pixeles. Las superficies son planas porque la profundidad falsa no informa nada. Lo único que se eleva es lo que de verdad está encima de todo: un modal.

El color hace el trabajo pesado. Sobre un fondo casi negro, un verde, un ámbar o un rojo son lo primero que el ojo encuentra, y eso es exactamente la intención: en una operación de contra-entrega el estado *es* la información. El violeta de marca no compite con ellos — marca lo que se puede tocar y lo que está seleccionado, nunca cómo va algo.

**Key Characteristics:**
- Densidad deliberada: 12px es el cuerpo de trabajo, no el texto secundario
- Fondo casi negro (4% de luminosidad) con capas por tono, no por sombra
- Color de estado semántico como canal primario de información
- Un solo acento de marca, reservado a acción, foco e identidad
- Esquina recta en lo compacto, radio en lo que contiene
- Sin webfont: el stack del sistema, cargado a costo cero

## Colors

Una paleta de dos capas: una base azul-noche casi acromática que nunca compite, y encima una paleta de estado saturada que carga toda la información operativa.

### Primary
- **Violeta de Mando** (`{colors.primary}`): el único acento de marca. Vive en el botón de acción principal, el tab activo, la fila seleccionada, el anillo de foco y los encabezados de módulo. No indica estado nunca.

### Secondary
- **Azul Pizarra** (`{colors.secondary}`): superficie de botón secundario y relleno de controles que existen pero no piden atención.

### Tertiary
La paleta de estado. No es decoración: es el canal principal por el que la pantalla dice cómo va algo.

- **Verde Entregado** (`{colors.status-good}` / `{colors.status-good-strong}`): resuelto, entregado, cuadrado, recibido. La versión 400 para texto sobre oscuro, la 500 para puntos y rellenos sólidos.
- **Ámbar Pendiente** (`{colors.status-warn}` / `{colors.status-warn-light}`): sin contestar, reprogramado, por verificar, fuera de meta. El color de "esto espera a alguien".
- **Rojo Fallo** (`{colors.status-bad}` / `{colors.status-bad-strong}`): no entregado, anulado, error de carga.
- **Cian Informativo** (`{colors.status-info}` / `{colors.status-info-strong}`): dato de contexto, conteo neutro, etiqueta que no juzga.
- **Rosa Crítico** (`{colors.status-critical}`): el escalón por encima del rojo, para lo que no puede pasar desapercibido.

### Neutral
- **Noche Profunda** (`{colors.background}`): el lienzo. Casi negro con tinte azul; deja que el color de estado sea lo primero que se ve.
- **Noche Elevada** (`{colors.card}`): la tarjeta. Dos puntos de luminosidad sobre el fondo — apenas lo suficiente para leerse como una capa distinta sin necesidad de sombra.
- **Noche Hundida** (`{colors.muted}`): fondo de zonas secundarias y filas alternas.
- **Gris Estructura** (`{colors.border}`): borde, campo y realce a la vez. Es el mismo valor para los tres: la estructura del sistema es una sola línea de 1px repetida miles de veces.
- **Blanco Papel** (`{colors.foreground}`): el texto que se lee.
- **Gris Secundario** (`{colors.muted-foreground}`): etiquetas, unidades, ayudas contextuales. Todo lo que acompaña al dato sin ser el dato.

### Named Rules

**La Regla del Canal Único.** El estado se comunica con la paleta de estado y solo con ella. El violeta de marca nunca significa "bien" ni "mal": significa "esto se puede tocar" o "esto está seleccionado". Si un estado necesita color, sale del verde/ámbar/rojo/cian; si no, va en gris.

**La Regla del Velo.** Los fondos de estado se pintan con alfa sobre el oscuro, no con el color sólido: `bg-emerald-500/15`, `/10`, `/20`. El color sólido se reserva para puntos indicadores y barras de progreso, donde el área es mínima. Un relleno sólido a pantalla completa rompe la jerarquía del oscuro.

**La Regla de la Línea Única.** Todo lo que separa, contiene o agrupa usa `{colors.border}` a 1px. No hay una segunda línea más clara ni más oscura para casos especiales. La monotonía del borde es lo que deja respirar al color de estado.

## Typography

**Fuente única:** el stack del sistema (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`), declarado en el `<body>`.

**Character:** sin personalidad tipográfica propia, y eso es la decisión. No hay webfont: cero bytes de descarga, cero parpadeo al cargar, y el texto se renderiza con el motor que el sistema operativo ya tiene afinado. En una herramienta que alguien abre cincuenta veces al día, la fuente que no se nota es la correcta. El carácter lo pone la densidad y el color, no la letra.

### Hierarchy
- **Display** (600, 30px): el número grande de un KPI de cabecera. Uno o dos por pantalla como máximo.
- **Headline** (600, 18px): título de bloque dentro de una tarjeta.
- **Title** (600, 16px): el título de tarjeta real del sistema. El primitivo `CardTitle` declara 24px, pero se sobreescribe a 16px en 14 de 19 usos — 16px es la verdad, 24px es un default heredado que no se usa.
- **Body** (400, 14px): texto de formulario, valores de campo, párrafos de ayuda.
- **Label** (400, 12px): **el cuerpo de trabajo real.** Filas de tabla, chips, etiquetas, metadatos, badges. Es la escala más usada del sistema con diferencia.
- **Label Loud** (500, 12px, +0.025em, mayúsculas): encabezado de sección y de columna. La mayúscula y el espaciado hacen el trabajo que en otro sistema haría un tamaño mayor.
- **Label Micro** (400, 11px): metadatos secundarios bajo un valor — la unidad, la fecha, la nota al pie de una fila. Casi siempre en gris secundario; es el escalón más usado después de los 12px (77 apariciones).
- **Label Nano** (400, 10px): el piso. Etiquetas dentro de badges compactos y encabezados micro en mayúsculas con `tracking-wide`. 64 apariciones.

### Named Rules

**La Regla de los 12px.** En las superficies de operación, 12px es el cuerpo y 14px es la excepción para formularios. Subir la escala "para que se lea mejor" reduce lo que cabe en pantalla, y lo que no cabe no se ve — que es peor que leerlo pequeño. Un tamaño mayor se justifica por jerarquía, nunca por comodidad.

**La Regla del Piso de 10px.** La rampa termina en 10px y no baja más. Por debajo de eso, gris secundario sobre un fondo al 4% de luminosidad deja de ser legible, y el dato que no se puede leer no está. Si algo no cabe en 10px, el problema es el layout, no el tamaño de la letra.

**La Regla de la Etiqueta Gris.** El dato va en `{colors.foreground}` y lo que lo describe va en `{colors.muted-foreground}`, un tamaño por debajo. Nunca al mismo peso: si la etiqueta compite con el número, la pantalla deja de escanearse y empieza a leerse.

## Layout

Rejilla de tarjetas sobre un contenedor centrado de 1400px con 32px de aire lateral. Dentro de cada tarjeta el ritmo lo marca `gap-2` (8px) — es el gap dominante del sistema con 243 usos, y define el pulso visual: los elementos relacionados casi se tocan.

La escala de separación es corta a propósito: 4px para elementos que forman una unidad (icono y etiqueta), 8px entre controles de una misma fila, 12px de padding en bloques compactos como los mini-stats, 16px en tarjetas de contenido, 24px en la cabecera y el cuerpo de una tarjeta grande.

Responsive de un solo salto. El sistema es de escritorio primero y `sm:` es el único punto de quiebre que importa: 156 usos contra 41 de `lg:`, 31 de `xl:` y 21 de `md:`. Por debajo de 640px las rejillas colapsan a una columna y las filas de filtros envuelven con `flex-wrap`; por encima, la densidad completa. No hay un diseño móvil aparte porque el trabajo no se hace en móvil.

Las tablas anchas y los gráficos scrollean dentro de su propio contenedor, nunca el cuerpo de la página.

## Elevation & Depth

**El sistema es plano, salvo lo que de verdad flota.** La profundidad no se pinta: se construye con tres escalones de luminosidad y una línea de 1px. El fondo está al 4%, la tarjeta al 6%, el borde y el realce al 17%. Esos dos puntos de diferencia entre fondo y tarjeta son suficientes para leer una capa en una pantalla oscura, y no hace falta nada más.

La sombra existe solo como señal de que algo está encima de todo lo demás. Los seis modales del módulo de finanzas la usan; nada más en la aplicación la necesita.

### Shadow Vocabulary
- **Reposo** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): la sombra mínima que llevan las tarjetas. Es casi imperceptible sobre el oscuro y funciona como asentamiento, no como elevación.
- **Flotante** (`box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25)`): exclusiva de modales y drawers. Es deliberadamente grande: si algo interrumpe el trabajo, tiene que verse claramente despegado del panel.

### Named Rules

**La Regla del Plano por Tono.** Para separar dos superficies se cambia el tono un escalón y se pone un borde. No se agrega una sombra. Una sombra en una superficie que no flota es profundidad decorativa, y en una pantalla densa solo agrega ruido.

## Shapes

La forma tiene dos registros, y cuál aplica depende de la densidad del elemento.

**Lo compacto va cuadrado.** Chips de filtro, celdas, mini-stats, botones de texto pequeños: esquina recta, sin radio. Son 96 elementos con borde y esquina a escuadra en las pantallas de operación. La recta se alinea con la cuadrícula, ahorra los pixeles que el radio recorta y hace que una fila de chips se lea como un bloque continuo en vez de una tira de píldoras.

**Lo que contiene lleva radio.** Tarjetas y modales a 8px (`{rounded.lg}`); botones y campos a 6px (`{rounded.md}`). El radio marca "esto es un recipiente" o "esto es un control estándar".

**El badge es el único redondo.** `{rounded.full}` es exclusivo del badge de estado. Esa forma no aparece en ningún otro lugar del sistema, y por eso funciona: la píldora significa "esto es una etiqueta de estado" sin necesidad de leerla.

Las barras de progreso también son redondas, por la misma razón formal: son la única otra cosa que representa una cantidad dentro de un carril.

### Named Rules

**La Regla de los Dos Registros.** Si el elemento es un control compacto dentro de una fila densa, va cuadrado. Si contiene otras cosas o es un control de formulario de tamaño completo, lleva radio. Ante la duda, mirar la altura: por debajo de 32px, cuadrado.

## Components

### Buttons
- **Shape:** radio suave de 6px (`{rounded.md}`) en los tamaños estándar; recta en las variantes compactas de texto.
- **Primary:** violeta de marca sobre blanco papel, 40px de alto, 16px de padding lateral. Hover al 90% de opacidad.
- **Outline:** fondo del lienzo con borde de campo; en hover pasa al tono de realce. Es el botón de acción secundaria más usado.
- **Ghost:** sin borde ni fondo en reposo; solo aparece el realce en hover. Para acciones terciarias dentro de filas.
- **Destructive:** rojo oscuro desaturado (`{colors.destructive}`), no el rojo de estado. Se diferencia a propósito: el rojo brillante informa, el rojo apagado ejecuta algo irreversible.
- **Focus:** anillo de 2px en violeta con 2px de separación. Nunca se quita.
- **Disabled:** 50% de opacidad y sin eventos de puntero.

### Chips
- **Style:** el patrón más repetido del sistema. Borde de 1px, esquina recta, 4px por 8px de padding, texto de 12px en gris secundario.
- **State:** seleccionado pasa a borde violeta, fondo violeta al 10% y texto violeta. La transición es solo de color.
- **Uso:** filtros de estado, rangos de periodo, facetas. Viven en filas con `gap-1.5` o `gap-2` y envuelven en pantallas angostas.

### Cards / Containers
- **Corner Style:** 8px (`{rounded.lg}`).
- **Background:** noche elevada (`{colors.card}`), un escalón sobre el lienzo.
- **Shadow Strategy:** solo la sombra de reposo. Ver Elevation & Depth.
- **Border:** 1px en gris estructura, siempre.
- **Internal Padding:** 24px en cabecera y cuerpo; 16px o 12px cuando la tarjeta es un bloque compacto.

### Inputs / Fields
- **Style:** fondo del lienzo (más oscuro que la tarjeta que lo contiene, o sea hundido), borde de campo, 6px de radio, 40px de alto, texto de 14px.
- **Focus:** anillo violeta de 2px con separación. Sin cambio de fondo.
- **Placeholder:** gris secundario.
- **Disabled:** cursor bloqueado y 50% de opacidad.
- **Fechas:** los selectores nativos se fuerzan a `color-scheme: dark` y el icono de calendario se reemplaza por un SVG propio en blanco papel, porque el nativo se volvía invisible sobre el oscuro.

### Navigation
- **Tabs:** subrayado de 2px, texto de 14px en peso medio. Activo lleva borde y texto violeta; inactivo, borde transparente y gris secundario que aclara en hover. El subrayado es el único indicador — no hay fondo ni píldora. Dos tamaños según qué se cambia: **16px por 12px** para el tab de módulo, y **12px por 8px** para el cambio de vista dentro de una pantalla, que es el que se usa donde la densidad manda. Los dos van dentro de un riel de 1px en `{colors.border}`, y el tab se estira al alto de la fila para que su subrayado caiga sobre el riel y no flotando encima.
- **Scrollbar:** 6px, pulgar en gris estructura que pasa a violeta en hover. Detalle pequeño y deliberado: hasta el scroll respeta el acento.

### Mini-Stat (componente firma)
El bloque de KPI del sistema: rectángulo cuadrado con borde de 1px, fondo del lienzo, 12px de padding. Etiqueta de 12px en gris secundario arriba, valor de 18px en peso 600 abajo. Se usan en filas de tres a cinco y son la forma canónica de contestar "cómo vamos" antes de entrar al detalle. Su esquina recta es lo que permite alinearlos en cuadrícula sin que se vean como tarjetas sueltas.

### Status Badge (componente firma)
Píldora completamente redonda, 10px por 2px de padding, 12px en peso 600. El fondo es el color de estado al 15-20% de alfa y el texto el mismo color en su versión clara. Es el vehículo principal por el que la aplicación comunica estado, y su forma redonda —única en el sistema— lo hace identificable antes de leerlo.

Las variantes de estado (`success`, `warning`, `info`, `muted`) no tienen hover: son etiquetas, no controles. Las variantes de marca del primitivo sí lo traen, heredado de su origen en shadcn; no se usa.

### Fila Seleccionable (componente firma)
El patrón por el que se navega casi todo el sistema: la lista maestro-detalle de liquidaciones, leads y pedidos. Rectángulo de esquina recta con tres niveles de información apilados —nombre en 12px peso 600, metadatos en gris secundario, fila de badges— y un botón de eliminar alineado a la derecha.

Tiene tres estados y los tres son solo de color: en reposo, borde de estructura; en hover, el borde pasa a violeta al 50%; seleccionada, borde violeta pleno con fondo al 10% y el nombre en violeta. La geometría nunca se mueve — no hay desplazamiento ni escala — porque en una lista densa el movimiento de un item desalinea la lectura de los demás.

## Do's and Don'ts

### Do:
- **Do** usar 12px como cuerpo en superficies de operación y reservar 14px para formularios. La densidad es la función.
- **Do** dejar el estado en manos de la paleta verde/ámbar/rojo/cian, y el violeta en manos de la acción, el foco y la identidad de módulo.
- **Do** pintar los fondos de estado con alfa (`/10`, `/15`, `/20`) sobre el oscuro. El sólido solo para puntos y barras.
- **Do** separar superficies con un escalón de tono más un borde de 1px en `{colors.border}`.
- **Do** dar esquina recta a todo control compacto por debajo de 32px de alto, y radio a lo que contiene.
- **Do** sobreescribir `CardTitle` a 16px (`text-base`). Es el tamaño real de título del sistema.
- **Do** poner el dato en blanco papel y su etiqueta en gris secundario, un tamaño por debajo.
- **Do** hacer que las tablas anchas scrolleen dentro de su contenedor, nunca el cuerpo de la página.
- **Do** mantener el anillo de foco violeta de 2px en todo control interactivo.

### Don't:
- **Don't** agregar sombras a superficies que no floten. Solo modales y drawers llevan la sombra flotante.
- **Don't** usar el violeta de marca para indicar que algo está bien, mal o pendiente. Ese es trabajo del color de estado.
- **Don't** cargar un webfont. El stack del sistema es una decisión de rendimiento, no una omisión.
- **Don't** redondear los chips de filtro ni los mini-stats. La fila de chips se lee como un bloque por su esquina recta.
- **Don't** subir la escala tipográfica "para que se lea mejor": reduce lo que cabe en pantalla, y lo que no cabe no se ve.
- **Don't** introducir una segunda línea divisoria más clara o más oscura que `{colors.border}`.
- **Don't** usar el rojo de estado para acciones destructivas — para eso está `{colors.destructive}`, más apagado a propósito.
- **Don't** parecer un SaaS genérico: sin degradados violeta, sin ilustraciones, sin tarjetas enormes con mucho aire, sin saludos de bienvenida.
- **Don't** parecer un ERP viejo: la densidad nunca justifica gris sobre gris ni tablas donde todo pesa lo mismo. La jerarquía es obligatoria.
