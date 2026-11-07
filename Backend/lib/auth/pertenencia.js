/**
 * ¿Es de la empresa de la sesión? Para los identificadores que llegan del
 * cliente como OBJETO del acto (la persona a la que se le registra una ausencia,
 * la obra de una solicitud de firma): el cliente puede nombrar a quién o a qué
 * se refiere, pero no puede salir de su empresa.
 *
 * `PersonaService.getById` y `ObraService.getById` resuelven por índices
 * globales: con el id a mano devuelven la persona o la obra de cualquier
 * empresa. Quien use esto responde **404** si devuelve null, nunca 403: que el
 * identificador exista en otra empresa tampoco corresponde contarlo.
 *
 * Un fallo de lectura se ve desde afuera igual que "no es de tu empresa" (las
 * dos cosas responden 404), pero queda medible (`conNeutro`).
 */

const { conNeutro } = require('../degradacion');
const { PersonaService } = require('../services/PersonaService');
const { ObraService } = require('../services/ObraService');

const personaService = new PersonaService();
const obraService = new ObraService();

async function personaDeLaEmpresa(personaId, sesion) {
    if (!personaId || typeof personaId !== 'string' || !sesion?.tenantId) return null;
    const p = await conNeutro('persona.pertenencia', () => personaService.getById(personaId), null);
    return p && p.tenantId === sesion.tenantId ? p : null;
}

async function obraDeLaEmpresa(obraId, sesion) {
    if (!obraId || typeof obraId !== 'string' || !sesion?.tenantId) return null;
    const o = await conNeutro('obra.pertenencia', () => obraService.getById(obraId), null);
    return o && o.tenantId === sesion.tenantId ? o : null;
}

/** Todas o ninguna: devuelve las personas, o null si alguna no es de la empresa. */
async function personasDeLaEmpresa(ids, sesion) {
    const personas = [];
    for (const id of new Set(ids)) {
        const p = await personaDeLaEmpresa(id, sesion);
        if (!p) return null;
        personas.push(p);
    }
    return personas;
}

module.exports = { personaDeLaEmpresa, obraDeLaEmpresa, personasDeLaEmpresa };
