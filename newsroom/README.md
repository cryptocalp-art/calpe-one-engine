# CALPE ONE — Periódico y mesa editorial v1

Primera edición navegable, 30/09/2026. Se añade al motor existente en `newsroom/`; no sustituye `docs/`, no ejecuta los redactores y no modifica ningún workflow de publicación.

## Abrir

Requiere Node.js 20 o posterior; el proyecto ya utiliza Node 24. No necesita instalar paquetes adicionales para esta edición.

Desde la raíz del repositorio:

```sh
npm run newsroom:preview
```

Abre `http://127.0.0.1:4317`. Portada y mesa editorial se sirven exclusivamente a este equipo. En Windows también puedes abrir `newsroom/Abrir_CALPE_ONE.cmd`.

Para generar una vista previa de lectura, transportable en un único HTML:

```sh
npm run newsroom:build
```

El resultado está en `newsroom-output/preview/index.html`. Puede abrirse con doble clic, sin servidor. La mesa editorial requiere el servidor local y no se incluye en la vista descargable. Las lecturas guardadas son una preferencia de cada navegador.

## Incluido

- Portada, archivo, secciones y lectura individual de las noticias de `data/archive.json`.
- Buscador por titular, entradilla y sección; navegación por teclado y diseño adaptable.
- Deporte local con filtros de fútbol, baloncesto y cantera; estados vacíos explícitos cuando no existe contenido.
- Lecturas guardadas en este navegador, tamaño de texto, impresión y copia del enlace.
- Fuentes y cautelas del expediente visibles en cada noticia.
- Mesa local para editar texto, registrar aprobación o cambios solicitados y consultar el historial.
- Importación de PNG/JPEG/WebP con autor, crédito, permiso, referencia de la autorización, lugar, fecha, tema y tipo de imagen.
- Sugerencias de imágenes por etiquetas; la elección final es humana. Sin imagen se usa un gráfico editorial identificado.

La agenda está preparada como sección, pero no contiene eventos confirmados. No se inventan horarios, crónicas, fotografías ni resultados deportivos.

## Alcance exacto de los bloqueos

El estado inicial de esta nueva edición tiene `brandHold: true` y cero aprobaciones. Las noticias importadas del archivo no heredan una aprobación humana por el hecho de tener estado `PUBLISHED` en el motor anterior.

Una aprobación se vincula mediante SHA-256 al titular, entradilla, cuerpo, sección, fuentes, fecha, cautelas, expediente e imagen. Cambios posteriores la invalidan. El servidor exige una confirmación expresa al aprobar. La decisión no publica nada.

`npm run newsroom:export` rechaza la exportación si Brand Hold continúa activo. Tampoco exporta noticias sin aprobación vigente, con controles de calidad incompletos, fuentes no válidas, cuerpo insuficiente o imagen sin derechos revisados. No existe un botón ni una API para levantar Brand Hold en esta versión.

**Estos controles solo gobiernan `newsroom/`. No corrigen ni desactivan el pipeline anterior de GitHub, no leen el Brand Hold de Vento y no bloquean sus redes.** La integración común y su prueba deben preceder a la publicación definitiva. No se debe tratar esta entrega como un cierre de los bloqueos del informe técnico.

## Estado y acceso

El estado editorial y su auditoría se guardan en `newsroom/state/editorial.json`; las imágenes en `newsroom/state/media/`. Están excluidos de Git. Los guardados son atómicos, las escrituras están serializadas y las peticiones antiguas se rechazan por revisión y hash de contenido.

El servidor escucha solo en `127.0.0.1`. Valida Host, origen y un token de sesión en memoria para las escrituras; no admite CORS ni carga de SVG. El nombre del revisor es una declaración local de la persona que utiliza el equipo, **no una identidad remota autenticada**. No exponer este servidor en Internet ni añadir un proxy público: antes harían falta autenticación, roles y persistencia del servidor.

Las referencias privadas del permiso, los nombres de revisores y las observaciones de aprobación no se incluyen en el HTML de lectura. Los datos de fuente y las cautelas informativas sí se conservan.

Para conservar una instalación, detener el servidor y copiar íntegramente `newsroom/state/`, junto con el código y el archivo de noticias correspondiente. Una copia aislada del JSON no incluye las fotografías. Esta recomendación no constituye una prueba de restauración de Vento.

Variables opcionales de desarrollo: `CALPE_NEWSROOM_PORT`, `CALPE_NEWSROOM_STATE` y `CALPE_NEWSROOM_DATA_ROOT`. No son credenciales. Las dos últimas permiten ejecutar pruebas con datos sintéticos en directorios temporales sin tocar el estado real.

## Validación

```sh
npm run newsroom:test
```

Pruebas con datos sintéticos: Brand Hold incluso tras aprobación; invalidación por cambios de contenido; derechos y fuentes; estado ausente o corrupto; exclusión de metadatos privados y escape de HTML; API local con origen, token, confirmación humana, persistencia y rechazo de revisiones obsoletas.

La vista inicial entregada se genera con 35 noticias del commit `8266b2b493d989a5850dbbe33c992f9307178e41` (30/09/2026, 00:30:17 UTC). Su contenido no ha sido revalidado periodísticamente para esta entrega. El código lee el archivo disponible en cada ejecución.

## Pendiente para abrir la edición al público

1. Unificar la aprobación y Brand Hold de Vento, web y redes; decidir la fuente canónica.
2. Configurar identidad del editor, autenticación y almacenamiento en el alojamiento elegido.
3. Confirmar titularidad, textos legales y canal de rectificación; aprobar contenido y fotografías.
4. Integrar fuentes deportivas y agenda con fechas verificadas, sin duplicar el motor existente.
5. Preparar rutas públicas permanentes, SEO por noticia y despliegue controlado. La vista actual usa rutas con `#` y no debe confundirse con el sitio definitivo indexable.

No se han realizado llamadas de IA editorial, envíos a redes, aprobaciones de noticias reales ni despliegues con esta entrega.
