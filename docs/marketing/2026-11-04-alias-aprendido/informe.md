# Alias aprendidos entre Meta y TikTok

Al guardar una asignación manual, «Recordar» registra el alias normalizado del nombre de campaña en esa asignación. FAT BURN_CB y CBO FAT BURN | CR comparten FAT BURN. Se eliminan separadores, diferencias de mayúsculas y prefijos/sufijos de campaña conocidos; los términos adicionales de producto no se descartan. No hay coincidencia difusa ni entrenamiento de un modelo.

El alias se usa en todas las cuentas de Meta y TikTok de la misma tienda, incluso si la campaña fuente no tiene actividad en el período. Copia el producto y el alcance exacto de variantes de la asignación fuente. Las asignaciones manuales y la exclusión «Sin asignar» prevalecen. Los automáticos no generan nuevos alias ni aprenden en cadena.

Si varias asignaciones enseñan el mismo alias a productos o selecciones diferentes, o el catálogo ya no puede verificar la selección, no se asigna automáticamente. Se muestra el conflicto. Desmarcar «Recordar» y guardar quita la aportación de esa campaña; otra asignación manual podría seguir enseñando el mismo alias. Un conflicto con un producto exacto del catálogo también exige revisión.

La API normaliza el nombre recibido y valida permisos, tienda, cuenta, producto y variantes con el catálogo del servidor. Ignora un campaign_alias forjado. Los nombres genéricos o largos no se aprenden. La migración aditiva agrega campaign_alias y su restricción; RLS y permisos exclusivos del servidor se conservan. Las asignaciones existentes no se convierten retroactivamente en reglas de aprendizaje.

Validación: 1.865 pruebas en 187 archivos, TypeScript, lint de build y compilación de producción. Incluye cruce entre plataformas/cuentas, conservación de selección, conflicto, corrección, exclusión, retirada de alias y límites de escritura. No se guardan asignaciones ficticias durante QA.
