---
name: kairoai
description: Consola de operación COD — leads, despacho, novedades, rentabilidad y marketing — con la claridad de un panel tipo Stripe y el acento Índigo eléctrico.
colors:
  background: "hsl(240 33% 98%)"
  card: "hsl(0 0% 100%)"
  muted: "hsl(245 50% 96%)"
  secondary: "hsl(245 50% 96%)"
  border: "hsl(240 20% 91%)"
  input: "hsl(240 18% 86%)"
  accent: "hsl(248 60% 95%)"
  foreground: "hsl(240 21% 10%)"
  muted-foreground: "hsl(240 10% 41%)"
  primary: "hsl(252 100% 65%)"
  on-primary: "hsl(0 0% 100%)"
  destructive: "hsl(350 68% 42%)"
  seleccion: "hsl(253 100% 96%)"
  series-1: "#6D4AFF"
  series-2: "#0D9488"
  series-3: "#D97706"
  series-4: "#DB2777"
  dark-background: "hsl(228 45% 5%)"
  dark-card: "hsl(230 40% 8%)"
  dark-border: "hsl(234 26% 17%)"
  dark-foreground: "hsl(228 30% 92%)"
  dark-primary: "hsl(252 100% 68%)"
typography:
  family: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif (self-hosted @fontsource-variable/inter, cv11)"
  page-title:
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  section-title:
    fontSize: "15px"
    fontWeight: 600
  body:
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontSize: "12px"
    fontWeight: 500
  numbers: "tabular-nums everywhere numbers are compared (tables, font-mono, KPIs)"
rounded:
  badge: "5px"
  control: "6px"
  card: "8px"
  menu: "10px"
  full: "9999px"
spacing:
  hairline: "4px"
  tight: "6px"
  control-gap: "8px"
  card-padding: "20px"
  page-gutter: "24px"
elevation:
  card: "0 1px 2px rgb(20 20 31 / 0.04)"
  control: "0 1px 1px rgb(20 20 31 / 0.04)"
  popover: "0 12px 32px -8px rgb(20 20 31 / 0.18), 0 2px 6px rgb(20 20 31 / 0.06)"
components:
  button-primary: { height: "32px", padding: "0 12px", rounded: "{rounded.control}", background: "{colors.primary}", text: "{colors.on-primary}" }
  button-outline: { height: "32px", padding: "0 12px", rounded: "{rounded.control}", background: "{colors.card}", border: "{colors.input}" }
  input: { height: "32px", padding: "0 10px", rounded: "{rounded.control}", focus: "border primary + 3px ring primary/25" }
  badge: { padding: "2px 6px", rounded: "{rounded.badge}", style: "soft tint, no border, 12px/500" }
  card: { rounded: "{rounded.card}", border: "1px {colors.border}", padding: "20px", shadow: "{elevation.card}" }
  segmented: { track: "{colors.muted}", active: "card + shadow-sm + 1px ring border", colorLivesIn: "dot" }
  tab: { text: "13.5px/500", active: "2px primary underline", wraps: "never (scrolls inside its row)" }
  sidebar: { width: "240px", store-switcher: "top", groups: "Operación · Crecimiento · Ajustes", footer: "persona · Tono oscuro · Mi cuenta · Salir" }
---

# Design System: kairoai

## Overview

**North Star: "La consola Índigo".** Kairo se trabaja de turno: asesoras en Leads, logística en Novedades y Gestión, el dueño en Panel y Marketing. La referencia explícita del dueño es el panel de Stripe (y su propio sistema Kapso Sales): superficies claras, bordes de 1 px, sombras mínimas, controles de 32 px, letra Inter, íconos de trazo fino y el estado contado con texto e ícono, no con bloques de color.

Claro es el tono por defecto (oficina, de día). Cada persona puede pasar a **tono oscuro** con el interruptor del menú; se guarda por persona en su navegador y se aplica antes de pintar. Todo color sale de tokens, así ambos tonos son el mismo diseño.

**Rasgos:**
- Lienzo lavanda muy claro, tarjetas blancas, bordes finos; la profundidad es casi nula.
- Un solo acento, Índigo eléctrico #6D4AFF: acción principal, selección, foco y marca.
- Estados (verde, ámbar, rojo) separados de las series de gráficos y siempre con texto o ícono.
- Densidad cómoda: 13,5 px de cuerpo, 12 px para etiquetas, cifras tabulares.
- Sin etiquetas en MAYÚSCULAS espaciadas, sin rótulos encima de los títulos, sin numerar secciones, sin emoji como íconos.

## Navegación

- **Menú lateral fijo** (240 px) en escritorio; en teléfono, barra superior con botón de menú y cajón.
- **Selector de tienda único**, arriba del menú (como el selector de cuenta de Stripe). Mireva Costa Rica / Honduras cambian la tienda de todas las pantallas a la vez (`useSelectedStore` + evento `kairo:tienda`); Kenku Italia / México / Argentina abren su propia pantalla de pedidos. Ninguna pantalla tiene su propio selector de tienda.
- El menú se adapta a la tienda: Marketing solo con Mireva Costa Rica; en una tienda Kenku, sus Pedidos y Ajustes.
- Encabezado de cada pantalla: título 20 px/600, una línea de descripción en gris, acciones a la derecha. Sin flechas "volver al Dashboard": el menú resuelve la navegación.

## Colors

### Acento
- **Índigo eléctrico** (`{colors.primary}`): botón principal, pestaña activa, selección, anillo de foco, ícono activo del menú. Nunca indica estado.

### Neutros (claro)
- **Lienzo** (`{colors.background}`), **Tarjeta** (`{colors.card}`), **Hundido** (`{colors.muted}`) para carriles de controles segmentados y filas secundarias, **Borde** (`{colors.border}`), **Texto** (`{colors.foreground}`) y **Texto secundario** (`{colors.muted-foreground}`, ≥ 4,5:1 sobre el lienzo).

### Estados
Las clases de estado de Tailwind (`text-emerald-300`, `bg-amber-500/10`…) son variables: en claro la escala se invierte (300↔700, 400↔600, 500 igual) para leerse sobre blanco; en oscuro valen lo de siempre. Así un mismo código sirve en los dos tonos.

### Series de gráficos (Marketing, Panel)
Índigo #6D4AFF → verde azulado #0D9488 → ámbar #D97706 → magenta #DB2777, en ese orden fijo y validadas con el script de dataviz contra la superficie (claro) y contra #0C0F1D (oscuro: #8B73FF, #12A594, #CC7D0A, #E5418C). Meta conserva su azul; TikTok va en tinta.

## Typography

Inter variable servida desde el propio sitio, con `cv11`. Título de página 20 px/600 (-0,015em), título de sección 15 px/600, cuerpo 13,5 px, etiquetas 12 px/500 en mayúscula inicial. Cifras tabulares en tablas, KPIs y todo lo que antes iba en monoespaciada (montos, teléfonos, ids), con cero barrado.

## Components

- **Botón**: 32 px, radio 6 px, 13,5 px/500. Principal índigo con sombra mínima; secundario blanco con borde y sombra de 1 px; fantasma solo con fondo al pasar. Foco: anillo índigo de 3 px al 30 %.
- **Campo y select**: 32 px, borde `input`, sombra de 1 px; foco con borde índigo y anillo suave.
- **Etiqueta (badge)**: tinte suave, sin borde, radio 5 px, 12 px/500; puede llevar ícono de 12 px.
- **Tarjeta**: borde de 1 px, radio 8 px, padding 20 px, sombra casi nula. Nunca bordes de color para contar estado; nunca tarjetas dentro de tarjetas.
- **Control segmentado** (filtros): carril hundido; la opción activa es blanca con sombra corta y anillo de 1 px; el color del estado vive en el punto.
- **Pestañas**: 13,5 px/500, subrayado índigo de 2 px, en una sola línea (se desplazan dentro de su fila).
- **Indicadores (KPI)**: tarjeta neutra; el valor puede tomar el color del estado y la comparación lleva flecha y texto. Cargando: barra gris, no "…".
- **Íconos**: lucide, 16 px, trazo 1,75.
- **Menú desplegable / popover**: radio 10 px, borde, sombra con desplazamiento (no halos).

## Do's and Don'ts

- **Do** usar tokens (`bg-card`, `border-border`, `text-muted-foreground`, `text-primary`) para que el tono oscuro funcione solo.
- **Do** contar estados con texto o ícono además del color.
- **Do** mantener las tablas anchas desplazándose dentro de su región en teléfono.
- **Don't** agregar un selector de tienda dentro de una pantalla: la tienda viene del menú.
- **Don't** usar mayúsculas espaciadas, rótulos encima del título, números de sección o emoji.
- **Don't** usar bordes de color en tarjetas, bloques sólidos de color para filtros activos ni sombras tipo halo.
