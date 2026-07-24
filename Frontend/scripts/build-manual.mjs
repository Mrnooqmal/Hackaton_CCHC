/**
 * Construye el manual (VitePress en manual-src/) y lo deja en public/manual/,
 * desde donde Vite lo sirve en dev y lo incluye en dist/ al hacer build.
 *
 * Se ejecuta automáticamente vía "predev" y "prebuild" (package.json).
 * Multiplataforma (Windows/Linux/Mac): todo con Node, sin cp/xcopy.
 *
 * Si nada cambió en manual-src desde la última construcción, no hace nada
 * (compara mtimes contra public/manual/.build-stamp) para no frenar el dev.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // Frontend/
const srcDir = path.join(root, 'manual-src');
const outDir = path.join(root, 'public', 'manual');
const distDir = path.join(srcDir, '.vitepress', 'dist');
const stampFile = path.join(outDir, '.build-stamp');

// Sin fuentes del manual (ej. un deploy que solo trae el build) → nada que hacer.
if (!fs.existsSync(srcDir)) process.exit(0);

// mtime más reciente de las fuentes (md, config, imágenes), ignorando artefactos.
const IGNORAR = new Set(['node_modules', 'dist', 'cache', '.temp']);
function ultimaModificacion(dir) {
    let max = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORAR.has(entry.name)) continue;
        const p = path.join(dir, entry.name);
        max = Math.max(max, entry.isDirectory() ? ultimaModificacion(p) : fs.statSync(p).mtimeMs);
    }
    return max;
}

const fuentes = ultimaModificacion(srcDir);
if (fs.existsSync(stampFile) && Number(fs.readFileSync(stampFile, 'utf8')) >= fuentes) {
    console.log('[manual] sin cambios en manual-src — se usa el build existente');
    process.exit(0);
}

console.log('[manual] construyendo el manual (manual-src → public/manual)…');

// Dependencias del manual (solo la primera vez o tras borrar node_modules).
if (!fs.existsSync(path.join(srcDir, 'node_modules'))) {
    console.log('[manual] instalando dependencias de manual-src…');
    execSync('npm ci', { cwd: srcDir, stdio: 'inherit' });
}

execSync('npx vitepress build', { cwd: srcDir, stdio: 'inherit' });

// Reemplazo limpio: borra el build anterior y copia el nuevo.
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(distDir, outDir, { recursive: true });
fs.writeFileSync(stampFile, String(Date.now()));

console.log('[manual] listo — servido en /manual/ (dev) e incluido en dist/ (build)');
