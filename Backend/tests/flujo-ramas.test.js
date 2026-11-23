const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const INFRA = path.join(__dirname, '..', '..', 'infra');
const AYUDANTE = path.join(INFRA, 'rama-del-ambiente.sh');
const leer = (nombre) => fs.readFileSync(path.join(INFRA, nombre), 'utf8');

const git = (cwd, ...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@e', GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@e' },
}).trim();

const exigir = (raiz, sha, ambiente) => spawnSync('bash', ['-c', `source "${AYUDANTE}"; exigir_rama_del_ambiente "$1" "$2" "$3"`, 'x', raiz, sha, ambiente], { encoding: 'utf8' });

function repoDePrueba() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-ramas-'));
    const origen = path.join(base, 'origen.git');
    const clon = path.join(base, 'clon');
    git(base, 'init', '--quiet', '--bare', '-b', 'main', origen);
    git(base, 'clone', '--quiet', origen, clon);
    const commit = (mensaje) => { git(clon, 'commit', '--quiet', '--allow-empty', '-m', mensaje); return git(clon, 'rev-parse', 'HEAD'); };
    const enMain = commit('en main');
    git(clon, 'push', '--quiet', 'origin', 'HEAD:main');
    git(clon, 'switch', '--quiet', '-c', 'pruebas');
    const enPruebas = commit('en pruebas');
    git(clon, 'push', '--quiet', 'origin', 'pruebas');
    git(clon, 'switch', '--quiet', '-c', 'tarea');
    const enTarea = commit('en una rama de tarea');
    git(clon, 'push', '--quiet', 'origin', 'tarea');
    const sinPush = commit('sin push');
    git(clon, 'fetch', '--quiet', 'origin');
    return { base, clon, enMain, enPruebas, enTarea, sinPush };
}

test('dev se despliega solo desde pruebas, y prod solo desde main', () => {
    const r = repoDePrueba();
    try {
        assert.equal(exigir(r.clon, r.enPruebas, 'dev').status, 0);
        assert.equal(exigir(r.clon, r.enMain, 'dev').status, 0, 'lo que ya está en main también está en pruebas');
        assert.equal(exigir(r.clon, r.enMain, 'prod').status, 0);

        const prodDesdePruebas = exigir(r.clon, r.enPruebas, 'prod');
        assert.notEqual(prodDesdePruebas.status, 0);
        assert.match(prodDesdePruebas.stderr, /no está en origin\/main: prod se despliega solo desde main/);

        for (const ambiente of ['dev', 'prod']) {
            assert.notEqual(exigir(r.clon, r.enTarea, ambiente).status, 0, `rama de tarea en ${ambiente}`);
            assert.notEqual(exigir(r.clon, r.sinPush, ambiente).status, 0, `sin push en ${ambiente}`);
        }
        assert.notEqual(exigir(r.clon, r.enPruebas, 'qa').status, 0);
    } finally {
        fs.rmSync(r.base, { recursive: true, force: true });
    }
});

test('sin origin/pruebas o sin origin/main no despliega, y lo dice', () => {
    const r = repoDePrueba();
    try {
        git(r.clon, 'update-ref', '-d', 'refs/remotes/origin/pruebas');
        const sin = exigir(r.clon, r.enPruebas, 'dev');
        assert.notEqual(sin.status, 0);
        assert.match(sin.stderr, /No existe origin\/pruebas/);
    } finally {
        fs.rmSync(r.base, { recursive: true, force: true });
    }
});

test('los tres scripts de despliegue exigen la rama del ambiente después de traer origin', () => {
    const casos = {
        'desplegar-backend.sh': 'exigir_rama_del_ambiente "$RAIZ" "$SHA" "$STAGE"',
        'desplegar-frontend.sh': 'exigir_rama_del_ambiente "$RAIZ" "$SHA" "$AMBIENTE"',
        'desplegar-infra-frontend.sh': 'exigir_rama_del_ambiente "$RAIZ" "$SHA" "$([ -n "$SOLO_DEV" ] && echo dev || echo prod)"',
    };
    for (const [nombre, llamada] of Object.entries(casos)) {
        const s = leer(nombre);
        assert.ok(s.includes('source "$(dirname "$0")/rama-del-ambiente.sh"'), nombre);
        assert.ok(s.includes(llamada), nombre);
        assert.ok(s.indexOf('fetch --quiet origin') < s.indexOf(llamada), `${nombre}: trae origin antes de mirar la rama`);
        assert.ok(!/branch -r --contains/.test(s), `${nombre}: ya no basta con estar en cualquier rama remota`);
    }
});

test('el flujo y los scripts no dependen de un repositorio en particular', () => {
    const archivos = [
        ...fs.readdirSync(INFRA).filter((f) => f.endsWith('.sh')).map((f) => path.join(INFRA, f)),
        path.join(__dirname, '..', '..', 'docs', 'flujo-de-trabajo.md'),
    ];
    for (const archivo of archivos) {
        const s = fs.readFileSync(archivo, 'utf8');
        assert.ok(!/github\.com|git@|Hackaton_CCHC|Mrnooqmal/i.test(s), path.basename(archivo));
    }
});
