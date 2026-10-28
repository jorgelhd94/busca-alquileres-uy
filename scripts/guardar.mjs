// Guarda una corrida en SQLite.
// Uso: node scripts/guardar.mjs <corrida.json>
// Guarda como máximo 50 publicaciones por plataforma, priorizando las de
// fecha de publicación más reciente (y, a igual fecha, las que nunca se vieron).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirDb, hoy, ahora, normalizarUrl, PLATAFORMAS, DATOS } from './db.mjs';

const MAX_POR_PLATAFORMA = 50;
const MAX_BYTES_FOTO = 150_000;

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node scripts/guardar.mjs <corrida.json>');
  process.exit(1);
}

const entrada = JSON.parse(readFileSync(archivo, 'utf8'));
const db = abrirDb();
const buscarPorUrl = db.prepare('SELECT id FROM publicaciones WHERE url = ?');

const porPlataforma = new Map(PLATAFORMAS.map((p) => [p, new Map()]));
const errores = [];
for (const p of entrada.publicaciones ?? []) {
  if (!PLATAFORMAS.includes(p.plataforma)) {
    errores.push(`plataforma desconocida: ${p.plataforma}`);
    continue;
  }
  if (!p.url || !p.titulo) {
    errores.push(`falta url o título: ${JSON.stringify(p).slice(0, 80)}`);
    continue;
  }
  const url = normalizarUrl(p.url);
  porPlataforma.get(p.plataforma).set(url, { ...p, url, yaVista: Boolean(buscarPorUrl.get(url)) });
}

// Más recientes primero; sin fecha al final; a igual fecha, las no vistas primero.
function ordenar(a, b) {
  const fa = a.fecha_publicacion ?? '';
  const fb = b.fecha_publicacion ?? '';
  if (fa !== fb) return fa < fb ? 1 : -1;
  return Number(a.yaVista) - Number(b.yaVista);
}

const fecha = hoy();
const upsert = db.prepare(`
  INSERT INTO publicaciones (plataforma, url, titulo, departamento, zona, tipo, dormitorios,
    precio, moneda, extras, descripcion, fecha_publicacion, imagen_url, primera_vez, ultima_vez)
  VALUES (:plataforma, :url, :titulo, :departamento, :zona, :tipo, :dormitorios,
    :precio, :moneda, :extras, :descripcion, :fecha_publicacion, :imagen_url, :fecha, :fecha)
  ON CONFLICT(url) DO UPDATE SET
    titulo = excluded.titulo,
    departamento = coalesce(excluded.departamento, departamento),
    zona = coalesce(excluded.zona, zona),
    tipo = coalesce(excluded.tipo, tipo),
    dormitorios = coalesce(excluded.dormitorios, dormitorios),
    precio = coalesce(excluded.precio, precio),
    moneda = coalesce(excluded.moneda, moneda),
    extras = coalesce(excluded.extras, extras),
    descripcion = coalesce(excluded.descripcion, descripcion),
    fecha_publicacion = coalesce(excluded.fecha_publicacion, fecha_publicacion),
    imagen_url = coalesce(excluded.imagen_url, imagen_url),
    ultima_vez = excluded.ultima_vez,
    veces_visto = veces_visto + 1
  RETURNING id, foto, imagen_url
`);
const enlazar = db.prepare(
  'INSERT OR IGNORE INTO corrida_publicaciones (corrida_id, publicacion_id, nueva) VALUES (?, ?, ?)'
);

const resumen = {};
const sinFoto = [];
db.exec('BEGIN');
const { lastInsertRowid: corridaId } = db
  .prepare('INSERT INTO corridas (fecha, creada, criterios, notas) VALUES (?, ?, ?, ?)')
  .run(fecha, ahora(), JSON.stringify(entrada.criterios ?? null), JSON.stringify(entrada.notas ?? {}));

for (const [plataforma, mapa] of porPlataforma) {
  const candidatas = [...mapa.values()].sort(ordenar);
  const elegidas = candidatas.slice(0, MAX_POR_PLATAFORMA);
  for (const p of elegidas) {
    const fila = upsert.get({
      plataforma,
      url: p.url,
      titulo: p.titulo,
      departamento: p.departamento ?? null,
      zona: p.zona ?? null,
      tipo: p.tipo ?? null,
      dormitorios: Number.isFinite(p.dormitorios) ? p.dormitorios : null,
      precio: Number.isFinite(p.precio) ? p.precio : null,
      moneda: p.moneda ?? null,
      extras: Array.isArray(p.extras) ? JSON.stringify(p.extras) : null,
      descripcion: p.descripcion ?? null,
      fecha_publicacion: p.fecha_publicacion ?? null,
      imagen_url: p.imagen_url ?? null,
      fecha,
    });
    enlazar.run(corridaId, fila.id, p.yaVista ? 0 : 1);
    if (!fila.foto && fila.imagen_url) sinFoto.push(fila);
  }
  resumen[plataforma] = {
    recibidas: candidatas.length,
    guardadas: elegidas.length,
    nuevas: elegidas.filter((p) => !p.yaVista).length,
    fuera_por_tope: Math.max(0, candidatas.length - MAX_POR_PLATAFORMA),
  };
}
db.exec('COMMIT');

// Descarga las fotos nuevas. Las páginas de los sitios no se pueden cargar desde el
// artefacto, así que la foto se guarda en local y el reporte la incrusta.
const guardarFoto = db.prepare('UPDATE publicaciones SET foto = ? WHERE id = ?');
let fotos = 0;
for (const fila of sinFoto) {
  try {
    const r = await fetch(fila.imagen_url, { signal: AbortSignal.timeout(15_000) });
    const tipo = r.headers.get('content-type') ?? '';
    if (!r.ok || !tipo.startsWith('image/')) continue;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES_FOTO) continue;
    const ext = tipo.split('/')[1].split(';')[0].replace('jpeg', 'jpg');
    const nombre = `${fila.id}.${ext}`;
    writeFileSync(join(DATOS, 'fotos', nombre), bytes);
    guardarFoto.run(nombre, fila.id);
    fotos++;
  } catch {
    // Sin foto: el reporte muestra un recuadro en su lugar.
  }
}

console.log(JSON.stringify({ corrida: Number(corridaId), fecha, resumen, fotos_descargadas: fotos, errores }, null, 2));
