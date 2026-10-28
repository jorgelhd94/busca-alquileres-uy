// Base SQLite compartida por guardar.mjs y generar-reporte.mjs.
// Usa node:sqlite (Node 22.13+ sin opciones; en 22.5 a 22.12 pide --experimental-sqlite), sin dependencias externas.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATOS = process.env.ALQUILERES_DATOS ?? join(RAIZ, 'datos');
export const PLATAFORMAS = ['mercadolibre', 'infocasas', 'gallito', 'facebook'];

const ZONA_HORARIA = 'America/Montevideo';

// Sitios donde el aviso se identifica por la ruta: ahí el query es solo rastreo y se puede quitar.
const SIN_QUERY = [
  /(^|\.)infocasas\.com\.uy$/,
  /(^|\.)gallito\.com\.uy$/,
  /(^|\.)facebook\.com$/,
  /^(apartamento|casa|articulo|inmueble|terreno|local|oficina)\.mercadolibre\.com\.uy$/,
];

export function hoy() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONA_HORARIA });
}

export function ahora() {
  return new Date().toLocaleString('sv-SE', { timeZone: ZONA_HORARIA });
}

// Normaliza la URL de un aviso para que el mismo aviso no se guarde dos veces.
// Lanza un error si no es una URL absoluta http(s): una URL relativa o javascript: no se guarda.
export function normalizarUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`protocolo no permitido: ${u.protocol}`);
  u.hash = '';
  if (SIN_QUERY.some((re) => re.test(u.hostname))) u.search = '';
  return u.toString().replace(/\/$/, '');
}

export function abrirDb() {
  mkdirSync(join(DATOS, 'fotos'), { recursive: true });
  const db = new DatabaseSync(join(DATOS, 'alquileres.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS corridas (
      id        INTEGER PRIMARY KEY,
      fecha     TEXT NOT NULL,
      creada    TEXT NOT NULL,
      criterios TEXT,
      notas     TEXT
    );

    CREATE TABLE IF NOT EXISTS publicaciones (
      id                INTEGER PRIMARY KEY,
      plataforma        TEXT NOT NULL,
      url               TEXT NOT NULL UNIQUE,
      titulo            TEXT NOT NULL,
      departamento      TEXT,
      zona              TEXT,
      tipo              TEXT,
      dormitorios       INTEGER,
      precio            REAL,
      moneda            TEXT,
      extras            TEXT,
      descripcion       TEXT,
      fecha_publicacion TEXT,
      imagen_url        TEXT,
      foto              TEXT,
      primera_vez       TEXT NOT NULL,
      ultima_vez        TEXT NOT NULL,
      veces_visto       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS corrida_publicaciones (
      corrida_id     INTEGER NOT NULL REFERENCES corridas(id),
      publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      nueva          INTEGER NOT NULL,
      PRIMARY KEY (corrida_id, publicacion_id)
    );
  `);
  return db;
}
