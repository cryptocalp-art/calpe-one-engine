# Validación de la primera edición

30/09/2026. Todas las mutaciones de prueba se hicieron sobre datos sintéticos en carpetas temporales, eliminadas al terminar. No se aprobaron ni publicaron noticias reales.

## Resultado

- 6 pruebas automatizadas de modelo y API: PASS.
- Vista en Chromium a 1440 × 1080 y 390 × 844: PASS.
- Cero errores JavaScript en el recorrido comprobado.
- Portada, buscador sin tildes, lectura, fuentes, guardar lecturas y ampliar texto: PASS.
- Secciones, fútbol sin resultados, agenda sin eventos y ruta inesperada: PASS.
- Sin desbordamiento horizontal del documento en móvil; la navegación de secciones se desplaza dentro de su barra.
- Revisión humana desde la interfaz sobre una noticia sintética: PASS.
- Edición posterior elimina la aprobación; Brand Hold permanece activo: PASS.
- Importación de una imagen sintética con metadatos y asignación a una noticia sintética: PASS.
- Exportación pública desde el estado real sin aprobaciones: rechazada con `BRAND_HOLD`, como se esperaba.
- Los datos privados de revisión y permiso se excluyen de la vista descargable: PASS.

Las pruebas de la API y del modelo se reproducen con `npm run newsroom:test`. Las comprobaciones visuales y de interfaz se realizaron mediante un navegador de pruebas local. No se ejecutaron los workflows existentes ni llamadas a proveedores IA.

## Límites

Estas pruebas no certifican hechos periodísticos, permisos de imágenes aportadas en el futuro, autenticación remota, integración con Vento, entrega a redes, indexación o restauración de producción. La nueva edición es una vista previa y una mesa de trabajo local. El pipeline anterior permanece independiente.
