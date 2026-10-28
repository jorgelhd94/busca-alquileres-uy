// Guarda una corrida en SQLite.
// Uso: node scripts/guardar.mjs <corrida.json>
// Guarda como máximo 50 publicaciones por plataforma, repartidas entre zonas y, dentro de cada zona,
// priorizando las de fecha de publicación más reciente (y, a igual fecha, las que nunca se vieron).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { abrirDb, hoy, ahora, normalizarUrl, detectarDuracion, DURACIONES, PLATAFORMAS, DATOS } from './db.mjs';

const MAX_POR_PLATAFORMA = 50;
const MAX_BYTES_FOTO = 150_000;
const DESCARGAS_EN_PARALELO = 6;
const ESPERA_FOTO_MS = 10_000;
// Los avisos que no aparecen en ninguna búsqueda durante este tiempo se borran de la base.
const DIAS_PARA_BORRAR = 60;
// Servidores de imágenes de cada sitio: las fotos solo se bajan de aquí (ver normalizarImagen).
const HOSTS_DE_FOTOS = [/(^|\.)mlstatic\.com$/, /(^|\.)infocasas\.com\.uy$/, /(^|\.)gallito\.com$/, /(^|\.)fbcdn\.net$/];
const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node scripts/guardar.mjs <corrida.json>');
  process.exit(1);
}

const entrada = JSON.parse(readFileSync(archivo, 'utf8'));
const db = abrirDb();
const buscarPorUrl = db.prepare('SELECT id FROM publicaciones WHERE url = ?');

// node:sqlite solo acepta texto, números o null: cualquier otra cosa se descarta en vez de romper la corrida.
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const duracionIndicada = (v) => {
  const lista = [].concat(v ?? []).filter((d) => DURACIONES.includes(d));
  return lista.length ? DURACIONES.filter((d) => lista.includes(d)).join(',') : null;
};

const porPlataforma = new Map(PLATAFORMAS.map((p) => [p, new Map()]));
const errores = [];
for (const p of entrada.publicaciones ?? []) {
  const resumen = JSON.stringify(p).slice(0, 80);
  if (!PLATAFORMAS.includes(p?.plataforma)) {
    errores.push(`plataforma desconocida: ${resumen}`);
    continue;
  }
  const titulo = texto(p.titulo);
  let url;
  try {
    url = normalizarUrl(p.url);
  } catch (e) {
    errores.push(`url inválida (${e.message}): ${resumen}`);
    continue;
  }
  if (!titulo) {
    errores.push(`falta título: ${resumen}`);
    continue;
  }
  let imagen = null;
  try {
    imagen = p.imagen_url ? normalizarImagen(p.imagen_url) : null;
  } catch {
    imagen = null;
  }
  porPlataforma.get(p.plataforma).set(url, {
    url,
    titulo,
    departamento: texto(p.departamento),
    zona: texto(p.zona),
    tipo: texto(p.tipo),
    dormitorios: numero(p.dormitorios),
    precio: numero(p.precio),
    moneda: texto(p.moneda),
    extras: Array.isArray(p.extras) ? JSON.stringify(p.extras.filter((e) => typeof e === 'string')) : null,
    descripcion: texto(p.descripcion),
    fecha_publicacion: fecha(p.fecha_publicacion),
    // La que indicó el agente, si es válida; si no, la que se lee en el título, la descripción o la URL.
    duracion: duracionIndicada(p.duracion) ?? detectarDuracion(`${titulo} ${texto(p.descripcion) ?? ''} ${url}`),
    imagen_url: imagen,
    yaVista: Boolean(buscarPorUrl.get(url)),
  });
}

// Las fotos solo se bajan por https y de los servidores de imágenes de cada sitio, nunca de otra dirección
// (por ejemplo de la red local), porque la URL sale de páginas de terceros.
// Conservan su query: muchos CDN lo usan para firmar el link.
function normalizarImagen(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port || !HOSTS_DE_FOTOS.some((re) => re.test(u.hostname))) return null;
  return u.toString();
}

// Más recientes primero; sin fecha al final; a igual fecha, las no vistas primero.
function ordenar(a, b) {
  const fa = a.fecha_publicacion ?? '';
  const fb = b.fecha_publicacion ?? '';
  if (fa !== fb) return fa < fb ? 1 : -1;
  return Number(a.yaVista) - Number(b.yaVista);
}

// Elige hasta `max` avisos tomando por turnos de cada zona, así el tope no se lo lleva la primera zona buscada.
function elegir(candidatas, max) {
  const zonas = new Map();
  for (const p of candidatas) {
    const z = p.zona ?? p.departamento ?? '';
    if (!zonas.has(z)) zonas.set(z, []);
    zonas.get(z).push(p);
  }
  const colas = [...zonas.values()].map((lista) => lista.sort(ordenar));
  const elegidas = [];
  while (elegidas.length < max && colas.some((c) => c.length)) {
    for (const c of colas) if (c.length && elegidas.length < max) elegidas.push(c.shift());
  }
  return elegidas;
}

const dia = hoy();
const upsert = db.prepare(`
  INSERT INTO publicaciones (plataforma, url, titulo, departamento, zona, tipo, dormitorios,
    precio, moneda, extras, descripcion, fecha_publicacion, duracion, imagen_url, primera_vez, ultima_vez)
  VALUES (:plataforma, :url, :titulo, :departamento, :zona, :tipo, :dormitorios,
    :precio, :moneda, :extras, :descripcion, :fecha_publicacion, :duracion, :imagen_url, :dia, :dia)
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
    duracion = CASE WHEN excluded.duracion <> '' THEN excluded.duracion ELSE duracion END,
    imagen_url = coalesce(excluded.imagen_url, imagen_url),
    ultima_vez = excluded.ultima_vez,
    veces_visto = veces_visto + 1
  RETURNING id, foto, imagen_url, primera_vez
`);
const enlazar = db.prepare(
  'INSERT OR IGNORE INTO corrida_publicaciones (corrida_id, publicacion_id, nueva) VALUES (?, ?, ?)'
);

const resumen = {};
const sinFoto = [];
db.exec('BEGIN');
const { lastInsertRowid: corridaId } = db
  .prepare('INSERT INTO corridas (fecha, creada, criterios, notas) VALUES (?, ?, ?, ?)')
  .run(dia, ahora(), JSON.stringify(entrada.criterios ?? null), JSON.stringify(entrada.notas ?? {}));

for (const [plataforma, mapa] of porPlataforma) {
  const candidatas = [...mapa.values()];
  const elegidas = elegir(candidatas, MAX_POR_PLATAFORMA);
  let guardadas = 0, nuevas = 0, nuevasHoy = 0;
  for (const { yaVista, ...p } of elegidas) {
    // Un aviso que SQLite rechaza se anota y se sigue con el resto: nunca se pierde la corrida entera.
    try {
      const fila = upsert.get({ plataforma, ...p, dia });
      enlazar.run(corridaId, fila.id, yaVista ? 0 : 1);
      guardadas++;
      if (!yaVista) nuevas++;
      if (fila.primera_vez === dia) nuevasHoy++;
      if (fila.foto == null && fila.imagen_url) sinFoto.push(fila);
    } catch (e) {
      errores.push(`no se pudo guardar (${e.message}): ${p.url}`);
    }
  }
  resumen[plataforma] = {
    recibidas: candidatas.length,
    guardadas,
    nuevas,
    nuevas_hoy: nuevasHoy,
    fuera_por_tope: Math.max(0, candidatas.length - MAX_POR_PLATAFORMA),
  };
}

// Limpieza: borra los avisos que no se vieron en los últimos DIAS_PARA_BORRAR días.
const limite = new Date(Date.now() - DIAS_PARA_BORRAR * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Montevideo' });
const viejas = db.prepare('SELECT id, foto FROM publicaciones WHERE ultima_vez < ?').all(limite);
for (const v of viejas) {
  db.prepare('DELETE FROM corrida_publicaciones WHERE publicacion_id = ?').run(v.id);
  db.prepare('DELETE FROM publicaciones WHERE id = ?').run(v.id);
}
db.exec('COMMIT');
for (const v of viejas) if (v.foto) rmSync(join(DATOS, 'fotos', v.foto), { force: true });

// Descarga las fotos nuevas en paralelo. El artefacto no puede cargar imágenes de otros sitios,
// así que la foto se guarda en local y el reporte la incrusta. Si falla, `foto` queda en '' y no se reintenta.
const guardarFoto = db.prepare('UPDATE publicaciones SET foto = ? WHERE id = ?');
async function descargar(fila) {
  try {
    // La base puede tener URLs guardadas antes de la lista de servidores permitidos: se vuelven a validar.
    if (!normalizarImagen(fila.imagen_url)) throw new Error('servidor no permitido');
    // Sin seguir redirecciones: una redirección podría llevar a otra dirección.
    const r = await fetch(fila.imagen_url, { redirect: 'manual', signal: AbortSignal.timeout(ESPERA_FOTO_MS) });
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim();
    const ext = EXTENSIONES[tipo];
    if (r.status !== 200 || !ext) throw new Error('sin imagen');
    if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES_FOTO) throw new Error('muy grande');
    // Lee de a partes y corta apenas pasa el límite, sin cargar en memoria una respuesta enorme.
    const partes = [];
    let total = 0;
    for await (const parte of r.body) {
      total += parte.length;
      if (total > MAX_BYTES_FOTO) throw new Error('muy grande');
      partes.push(parte);
    }
    const bytes = Buffer.concat(partes);
    const nombre = `${fila.id}.${ext}`;
    writeFileSync(join(DATOS, 'fotos', nombre), bytes);
    guardarFoto.run(nombre, fila.id);
    return true;
  } catch {
    guardarFoto.run('', fila.id);
    return false;
  }
}
let fotos = 0;
const cola = [...sinFoto];
await Promise.all(Array.from({ length: DESCARGAS_EN_PARALELO }, async () => {
  while (cola.length) if (await descargar(cola.shift())) fotos++;
}));

console.log(JSON.stringify({
  corrida: Number(corridaId), fecha: dia, resumen, fotos_descargadas: fotos, borradas_por_viejas: viejas.length, errores,
}, null, 2));
