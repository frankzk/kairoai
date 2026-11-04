# Carga de Marketing, 04/11/2026

Al entrar a Decisión financiera se iniciaban seis consultas: resumen operativo, fuentes con presupuestos, asignaciones, configuración Charlie, otro procesamiento de los mismos pedidos y el catálogo completo de anuncios y creativos. La gráfica y el botón Actualizar esperaban este último reporte aunque sus metadatos solo son necesarios para Control y Testing.

La pantalla principal ahora usa tres consultas privadas: resumen con ingresos potenciales agregados, fuentes ligeras con gasto diario y configuración monetaria. El mismo snapshot operativo alimenta pedidos e ingresos; las filas y teléfonos permanecen en el servidor. No se añadió caché pública ni se cambió la autenticación.

Las fuentes ligeras consultan solo información de cuenta y resultados diarios por campaña. Incluyen los siete días de la gráfica, incluso al cruzar de mes, pero suman al gasto del período únicamente las fechas seleccionadas. La gráfica Meta usa exclusivamente la fuente Meta y su moneda correspondiente. Errores o reportes incompletos siguen siendo desconocidos; no se sustituyen por cero.

Matriz 4Pi y Sustracción consultan resultados por anuncio sin recorrer todos los creativos ni descargar pedidos. Los nombres de campaña y conjunto llegan en Insights; TikTok por anuncio sigue leyéndose de Make. Control y Testing conserva el catálogo completo, roles, activos y presupuestos. Los detalles se limitan al rango elegido. Productos/campañas y Tendencias conservan sus consultas completas; las asignaciones del resumen operativo se cargan al desplegarlo.

Medición de lectura real para 01–04/11/2026, desde la misma máquina y con las cinco cuentas: antes, reporte completo de anuncios 23,8 s y procesamiento operativo 3,8 s; después, fuentes del resumen 2,6 s y procesamiento operativo 2,6 s. Las consultas Meta del arranque se redujeron de 63 a 10. Son mediciones de esas ejecuciones, no un SLA de producción.

Playwright comprobó el resumen compilado localmente con fuentes reales, autenticación exclusiva del proceso localhost y sin simulación de respuestas: tres solicitudes HTTP 200 y carga terminada en 2,5 s en una ejecución con el servidor ya iniciado. Captura y mediciones locales bajo output/marketing y output/playwright. Esto no acredita una sesión privada de producción.

Verificación: 1.786 pruebas en 178 archivos, TypeScript y compilación aprobados. Regresiones cubiertas: plan de carga por vista, consulta diaria ligera sin presupuestos/creativos, separación entre gasto del período y días de tendencia, errores sin gasto cero inventado, gráfica sin reporte por anuncio, lector 4Pi con TikTok y resumen combinado con una sola lectura del dataset.
