// Genera datos/reporte.html a partir de la base SQLite.
// Uso: node scripts/generar-reporte.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { abrirDb, ahora, RAIZ, DATOS, PLATAFORMAS } from './db.mjs';

// El artefacto admite hasta 16 MB; las fotos usan como máximo 8 MB.
const PRESUPUESTO_FOTOS = 8_000_000;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

const db = abrirDb();

const publicaciones = db
  .prepare(`
    SELECT p.* FROM publicaciones p
    ORDER BY p.primera_vez DESC, coalesce(p.fecha_publicacion, '') DESC, p.id DESC
  `)
  .all();

let usados = 0;
for (const p of publicaciones) {
  p.extras = p.extras ? JSON.parse(p.extras) : [];
  const archivo = p.foto && join(DATOS, 'fotos', p.foto);
  p.foto = null;
  if (!archivo || !existsSync(archivo)) continue;
  const bytes = readFileSync(archivo);
  const uri = `data:${MIME[archivo.split('.').pop()] ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
  if (usados + uri.length > PRESUPUESTO_FOTOS) continue;
  usados += uri.length;
  p.foto = uri;
}

const corridas = db
  .prepare(`
    SELECT c.id, c.fecha, c.creada, c.notas,
      ${PLATAFORMAS.map(
        (pl) => `sum(p.plataforma = '${pl}') AS ${pl}, sum(p.plataforma = '${pl}' AND cp.nueva = 1) AS ${pl}_nuevas`
      ).join(',\n      ')}
    FROM corridas c
    LEFT JOIN corrida_publicaciones cp ON cp.corrida_id = c.id
    LEFT JOIN publicaciones p ON p.id = cp.publicacion_id
    GROUP BY c.id
    ORDER BY c.id DESC
    LIMIT 60
  `)
  .all()
  // Los criterios del usuario (presupuesto, zonas) no se incluyen: el reporte puede ser público.
  .map((c) => ({ ...c, notas: JSON.parse(c.notas ?? '{}') }));

const datos = { generado: ahora(), publicaciones, corridas };
const json = JSON.stringify(datos).replace(/</g, '\\u003c');
let plantilla = readFileSync(join(RAIZ, 'plantilla', 'reporte.html'), 'utf8');
// Una búsqueda con nombre (busquedas/<nombre>/criterios.json) lleva su nombre en el título del artefacto.
const criteriosPropios = join(DATOS, 'criterios.json');
const nombre = existsSync(criteriosPropios) && JSON.parse(readFileSync(criteriosPropios, 'utf8')).nombre;
if (typeof nombre === 'string' && nombre.trim()) {
  const titulo = nombre.trim().replace(/[<>&"]/g, '');
  plantilla = plantilla.replace('<title>Busca Alquileres UY</title>', () => `<title>${titulo}</title>`);
}
const salida = join(DATOS, 'reporte.html');
writeFileSync(salida, plantilla.replace('__DATOS__', () => json));

console.log(JSON.stringify({
  archivo: salida,
  publicaciones: publicaciones.length,
  con_foto: publicaciones.filter((p) => p.foto).length,
  corridas: corridas.length,
  megas: +(Buffer.byteLength(json) / 1e6).toFixed(2),
}));
