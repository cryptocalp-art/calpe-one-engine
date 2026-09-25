# CALPE ONE ENGINE

Primer módulo del motor editorial automático de CALPE ONE.

## RADAR

Busca noticias actuales y relevantes para Calpe/Calp y Marina Alta mediante OpenAI Responses API + web search.

Genera:
- título
- resumen
- fuente
- URL
- fecha de publicación cuando existe
- categoría
- relevancia
- motivo de relevancia
- fecha de detección
- fingerprint para deduplicación

Los resultados se guardan en `data/candidates.json`.

## Configuración

En GitHub:
Settings → Secrets and variables → Actions → New repository secret

Nombre:

`OPENAI_API_KEY`

Opcional:

Actions → Variables

Nombre:

`OPENAI_MODEL`

Valor recomendado actualmente:

`gpt-6-astra`

## Ejecución

En GitHub:

Actions → CALPE ONE RADAR → Run workflow

También queda programado una vez por hora.

Este módulo NO publica noticias. Solo detecta y estructura candidatos reales.
