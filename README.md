# busca-alquileres-uy

Skill de Claude Code para buscar alquileres en Uruguay. Te hace un quiz corto con tus criterios (zonas, tipo, dormitorios, precio, anual o temporada, extras), busca en **Mercado Libre, InfoCasas, Gallito y Facebook Marketplace**, guarda todo en una base SQLite local y publica un buscador HTML como artefacto de Claude, con un link fijo que puedes compartir.

## Qué hace

- **Quiz:** una pregunta por vez. Los criterios quedan guardados en `criterios.json` para las próximas búsquedas.
- **Búsqueda:** usa el navegador integrado de la app de escritorio de Claude. Trae hasta 50 avisos por sitio en cada búsqueda, con los más nuevos primero, y descarta los precios que no tienen sentido como alquiler mensual (por día, por quincena, ventas).
- **Base de datos:** `datos/alquileres.db` acumula los avisos de todas las búsquedas sin duplicarlos y descarga la foto de cada uno.
- **Buscador:** un artefacto HTML con estilo de catálogo, con búsqueda por texto, filtros por sitio, zona, precio, dormitorios, tipo, nuevas, amueblado y con foto, y orden por precio o por fecha. Su link no cambia: cada búsqueda lo actualiza.
- **Facebook con cuidado:** reutiliza la sesión guardada, va a un ritmo pausado y revisa como máximo 100 publicaciones por día.
- **Búsqueda diaria:** al final ofrece programarla como tarea de la app.

## Requisitos

- La **app de escritorio de Claude** (pestaña Code), porque el skill usa su navegador integrado y sus artefactos.
- **Node.js 22.5 o más nuevo**, porque los scripts usan `node:sqlite` y no tienen otras dependencias.

## Instalación

Copia esta carpeta en tu carpeta de skills de Claude:

```bash
cp -r busca-alquileres-uy ~/.claude/skills/
```

En Windows la carpeta es `C:\Users\<tu usuario>\.claude\skills\`.

## Uso

En un chat de Claude escribe `/busca-alquileres-uy`, o pide algo como "busca alquiler en Pocitos". La primera vez:

1. Responde el quiz.
2. Cuando te lo pida, inicia sesión **tú** en Facebook y en Mercado Libre, en el panel del navegador de la app. Claude nunca escribe contraseñas. La sesión queda guardada para las próximas búsquedas.
3. Si un sitio muestra un captcha, te pregunta y tú lo resuelves en el navegador.
4. Al terminar te da el link de tu buscador. Es privado hasta que lo compartes desde su menú "Compartir".

## Archivos

| Archivo | Qué es |
|---|---|
| `SKILL.md` | Las instrucciones que sigue Claude |
| `scripts/db.mjs` | Esquema de la base SQLite |
| `scripts/guardar.mjs` | Guarda una búsqueda en la base, aplica el tope de 50 por sitio y descarga fotos |
| `scripts/generar-reporte.mjs` | Arma el buscador HTML desde la base |
| `plantilla/reporte.html` | Diseño del buscador |

El skill crea solo estos archivos con tus datos, que no conviene compartir: `criterios.json`, `artifact.json` (el link de tu buscador), `facebook_uso.json` y la carpeta `datos/`.

## Aviso

El skill recorre los sitios de forma automática. Algunos, sobre todo Facebook, no lo permiten en sus condiciones de uso. El ritmo pausado y el tope diario reducen el riesgo, pero tu cuenta podría recibir verificaciones o bloqueos. Úsalo bajo tu responsabilidad.

Los avisos, fotos y textos que guarda son de sus autores y de cada sitio. Úsalos para tu búsqueda personal, no los republiques.
