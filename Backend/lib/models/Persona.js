/**
 * Persona Model (Refactored)
 * 
 * Identidad unificada. Reemplaza las entidades separadas User y Worker.
 * Un solo ID (personaId), un solo pinHash, sin sincronización dual.
 */

const { normalizeRol } = require('../utils/validation');

const ROLES = {
    admin: {
        nombre: 'Administrador Empresa',
        permisos: ['crear_usuarios', 'editar_usuarios', 'ver_usuarios', 'reset_pin',
                   'ver_reportes', 'gestionar_empresa', 'resolver_disputas',
                   'gestionar_obras', 'crear_obras', 'editar_obras', 'eliminar_obras',
                   'firmar_asistido']
    },
    jefe_obra: {
        nombre: 'Jefe de Obra',
        permisos: ['ver_trabajadores', 'crear_usuarios', 'editar_usuarios',
                   'gestionar_obras', 'editar_obras',
                   'crear_actividades', 'asignar_documentos',
                   'ver_reportes', 'firmar_relator', 'crear_capacitaciones',
                   'firmar_asistido']
    },
    supervisor: {
        nombre: 'Supervisor',
        permisos: ['firmar_relator', 'ver_trabajadores',
                   'registrar_asistencia', 'ver_reportes',
                   'gestionar_incidentes', 'firmar_asistido']
    },
    prevencionista: {
        nombre: 'Prevencionista',
        permisos: ['crear_actividades', 'asignar_documentos', 'ver_trabajadores',
                   'ver_reportes', 'crear_capacitaciones', 'firmar_asistido']
    },
    trabajador: {
        nombre: 'Trabajador',
        permisos: ['ver_documentos_asignados', 'firmar_documentos',
                   'registrar_asistencia', 'ver_perfil']
    }
};

class Persona {
    constructor(data) {
        // Identificador unico (reemplaza userId y workerId)
        this.personaId = data.personaId;
        this.tenantId = data.tenantId;

        // Datos personales
        //
        // El RUT se guarda cifrado (D-10): `rutCifrado` + `rutHmac` para
        // buscar. `this.rut` queda en claro en MEMORIA una vez que
        // `PersonaService` lo descifra — el resto del sistema (~60 lugares)
        // sigue leyendo `persona.rut` exactamente igual que siempre, el
        // límite async queda encerrado en PersonaService.
        //
        // Lee las dos formas: si el ítem trae `rut` en claro (ficha vieja, sin
        // migrar) se usa directo; si trae `rutCifrado`, `this.rut` queda `null`
        // hasta que `PersonaService._hidratar` lo complete. Nunca se vuelve a
        // ESCRIBIR en claro: `toDynamoItem` solo emite el formato nuevo.
        this.rut = data.rut || null;
        this._rutCifrado = data.rutCifrado || null;
        this._rutHmac = data.rutHmac || null;
        this.nombre = data.nombre;
        this.apellidoPaterno = data.apellidoPaterno || '';
        this.apellidoMaterno = data.apellidoMaterno || '';
        this.apellido = data.apellido || [this.apellidoPaterno, this.apellidoMaterno].filter(Boolean).join(' ');
        this.fechaNacimiento = data.fechaNacimiento || null;
        this.email = data.email || '';
        this.telefono = data.telefono || '';
        this.fotoPerfil = data.fotoPerfil || null;
        this.notificacionesSms = data.notificacionesSms || false;

        // Rol y contexto laboral
        this.rol = data.rol || 'trabajador';
        this.permisos = data.permisos || (ROLES[normalizeRol(this.rol)]?.permisos || []);
        // Cargo "principal" (legacy / display). El cargo real de trabajo vive en
        // cada asignación (persona × obra). Se conserva para los ~30 lugares que
        // solo muestran "el cargo de esta persona" en snapshots/firmas.
        this.cargo = data.cargo || '';

        // Asignaciones por obra: { obraId, cargos: string[], fechaIngreso, estado }.
        // Fuente de verdad del vínculo laboral. Soporta multi-cargo y multi-obra.
        // Shim de compatibilidad: personas antiguas (sin asignaciones) se derivan
        // de obraIds + cargo global; se materializan al primer guardado vía modelo.
        this.asignaciones = Persona._deriveAsignaciones(data);
        // obraIds queda como ESPEJO de las asignaciones (lo leen muchos sitios para
        // saber en qué obras está la persona). Nunca se escribe a mano: se deriva.
        this.obraIds = this.asignaciones.map((a) => a.obraId);

        // Historial de asignaciones finalizadas (auditoría, append-only). Cada tramo
        // por obra que termina (egreso o transferencia) queda registrado aquí sin
        // borrarse: { obraId, cargos, supervisorPersonaId, fechaIngreso, fechaEgreso,
        // asignadaPor, finalizadaPor, motivo }. No afecta a `asignaciones`/`obraIds`,
        // que reflejan SOLO las obras activas.
        this.historialAsignaciones = Array.isArray(data.historialAsignaciones) ? data.historialAsignaciones : [];

        // Evidencias persona-level con vigencia (examen de altura, SPDC anual, etc.).
        // Reutilizables entre obras mientras estén vigentes — no se re-piden por obra.
        // [{ tipo, fileKey?, nombre?, emitidoEn?, venceEn?, origenObraId?, estado }]
        this.evidencias = Array.isArray(data.evidencias) ? data.evidencias : [];

        // Ficha del colaborador (datos relevantes para SSO/DS44)
        this.contactoEmergencia = data.contactoEmergencia || { nombre: '', telefono: '', relacion: '' };
        this.nivelEscolar = data.nivelEscolar || '';
        // Cursos/certificaciones del colaborador (ej. manejo de extintores, altura fisica)
        // [{ nombre, institucion?, fecha?, vencimiento? }]
        this.cursos = data.cursos || [];

        // Acceso y autenticacion
        this.tieneAccesoWeb = data.tieneAccesoWeb || false;
        this._passwordHash = data.passwordHash || null;
        this._pinHash = data.pinHash || null;
        this.pinCreatedAt = data.pinCreatedAt || null;
        // Límite de intentos de PIN (H-2). No es un dato de negocio de la
        // persona: es el estado del contador de `lib/limitePin.js`. Se guarda
        // acá y no en tabla aparte porque el bloqueo tiene que leerse en el
        // mismo `getById` que ya carga `_pinHash` para verificar — una tabla
        // aparte sería una lectura más en cada intento de firma.
        this.pinIntentosFallidos = data.pinIntentosFallidos || 0;
        this.pinBloqueadaHasta = data.pinBloqueadaHasta || null;
        this.passwordTemporal = data.passwordTemporal || false;

        // Enrolamiento
        this.habilitado = data.habilitado || false;
        this.firmaEnrolamiento = data.firmaEnrolamiento || null;

        // Overrides de onboarding DS44 por obra (marcas manuales)
        this.onboardingDS44 = data.onboardingDS44 || {};

        // Estado
        this.estado = data.estado || 'pendiente';

        // Vigilancia de salud ocupacional (DS44) y restricción/traslado por EP.
        // Igual criterio que el RUT: cifradas en la tabla (D-10), en claro en
        // memoria una vez que `PersonaService._hidratar` las descifra. Si el
        // ítem trae el objeto en claro (ficha vieja, sin migrar) se usa directo
        // — con eso `this.vigilanciaSalud` NUNCA queda con el default "sin
        // vigilancia" por error: o viene en claro, o llega cifrada y
        // `_saludSinDescifrar` avisa que falta el paso async.
        const trailSalud = data.vigilanciaSaludCifrada || data.restriccionLaboralCifrada;
        this._vigilanciaSaludCifrada = data.vigilanciaSaludCifrada || null;
        this._restriccionLaboralCifrada = data.restriccionLaboralCifrada || null;
        this.vigilanciaSalud = data.vigilanciaSalud || (trailSalud ? null : {
            enVigilancia: false,
            protocolos: [],
            fechaUltimoExamen: null,
            aptitudLaboral: null,
            restricciones: []
        });
        // El default de restriccionLaboral ya es `null` en ambos casos (en
        // claro sin dato, o cifrada sin descifrar todavía): no hace falta
        // distinguir acá, `_restriccionLaboralCifrada` es la señal.
        this.restriccionLaboral = data.restriccionLaboral || null;

        // Preferencias
        this.preferencias = data.preferencias || {
            tema: 'dark',
            notificaciones: true,
            idioma: 'es'
        };

        // Auditoría de incorporación y desvinculación
        this.creadoPor = data.creadoPor || null;
        this.desvinculacion = data.desvinculacion || null;

        // Fecha de término del vínculo laboral.
        //
        // No es un dato de auditoría más: es el reloj desde el que se cuenta la
        // conservación de la evidencia de esta persona (5 años desde el término
        // del vínculo, por la prescripción de las acciones laborales y
        // previsionales). El sistema ya registraba `desvinculacion` cuando alguien
        // se desvinculaba por la vía formal, pero no cuando simplemente se le
        // cambiaba el estado a inactivo: en ese caso no había fecha desde la cual
        // contar, y sin fecha no hay retención que calcular.
        //
        // Lo escribe el servidor al pasar a 'inactivo' o 'desvinculado' (ver
        // PersonaService), nunca el cliente. Se limpia si la persona vuelve a
        // estar activa: el vínculo se reanudó y el reloj no corre.
        this.fechaTerminoVinculo = data.fechaTerminoVinculo
            || data.desvinculacion?.fechaDesvinculacion
            || null;

        // Metadata
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
        this.ultimoAcceso = data.ultimoAcceso || null;
    }

    // ─── Asignaciones / evidencias (helpers de modelo) ──────────────────────
    static _normalizeCargos(val) {
        if (Array.isArray(val)) return [...new Set(val.filter(Boolean))];
        return val ? [val] : [];
    }

    // Construye las asignaciones desde data; si no existen, las deriva del par
    // legacy obraIds + cargo (una asignación por obra, heredando el cargo global).
    static _deriveAsignaciones(data) {
        if (Array.isArray(data.asignaciones) && data.asignaciones.length) {
            return data.asignaciones
                .map((a) => ({
                    obraId: a.obraId,
                    cargos: Persona._normalizeCargos(a.cargos != null ? a.cargos : a.cargo),
                    // Supervisor (cuadrilla) de esta persona en esta obra. Es por-obra:
                    // una persona puede tener distinto supervisor en cada obra.
                    supervisorPersonaId: a.supervisorPersonaId || null,
                    // Prevencionista a cargo de ESTA persona (relevante cuando es
                    // supervisor): define la cadena trabajador→supervisor→prevencionista
                    // que scopea las charlas. También por-obra.
                    prevencionistaPersonaId: a.prevencionistaPersonaId || null,
                    fechaIngreso: a.fechaIngreso || null,
                    // Quién realizó la asignación (auditoría). Se conserva al historial.
                    asignadaPor: a.asignadaPor || null,
                    estado: a.estado || 'activa',
                }))
                .filter((a) => a.obraId);
        }
        return (data.obraIds || []).map((oid) => ({
            obraId: oid,
            cargos: data.cargo ? [data.cargo] : [],
            fechaIngreso: null,
            estado: 'activa',
        }));
    }

    // Cargos que la persona ejecuta en una obra concreta (vacío si no asignada).
    cargosEnObra(obraId) {
        const a = this.asignaciones.find((x) => x.obraId === obraId);
        return a ? a.cargos : [];
    }

    // Evidencia persona-level vigente de un tipo (o null). Sin venceEn => vigente.
    evidenciaVigente(tipo, ref = new Date()) {
        const refTime = ref instanceof Date ? ref.getTime() : new Date(ref).getTime();
        return (
            this.evidencias.find(
                (e) => e.tipo === tipo && (!e.venceEn || new Date(e.venceEn).getTime() >= refTime)
            ) || null
        );
    }

    /** ¿Falta descifrar el RUT? Cifrada y sin descifrar todavía = true. */
    get rutSinDescifrar() {
        return !!(this._rutCifrado && !this.rut);
    }

    /** ¿Falta descifrar la salud? Mismo criterio, para las dos juntas: se
     *  cifran con la misma llave del tenant, se descifran en el mismo paso. */
    get saludSinDescifrar() {
        return !!((this._vigilanciaSaludCifrada || this._restriccionLaboralCifrada) && this.vigilanciaSalud === null);
    }

    tienePinConfigurado() {
        return !!this._pinHash;
    }

    estaEnrolado() {
        return this.habilitado && this.tienePinConfigurado() && !!this.firmaEnrolamiento;
    }

    tienePermiso(permiso) {
        return this.permisos.includes(permiso);
    }

    /**
     * Genera PK y SK para DynamoDB
     */
    toDynamoKeys() {
        return {
            PK: `TENANT#${this.tenantId}`,
            SK: `PERSONA#${this.personaId}`
        };
    }

    /**
     * Convierte a item de DynamoDB
     */
    /**
     * Convierte a item de DynamoDB.
     *
     * Requiere `this._rutCifrado`/`this._rutHmac` (y, si hay salud, sus
     * versiones cifradas) YA calculados — este método no cifra nada, porque
     * cifrar es async y `toDynamoItem` no lo es. Quien construye la instancia
     * antes de guardarla (`PersonaService.crear`) tiene que haber llamado a
     * `cifradoCampo`/`llaveTenant` antes y pasado `rutCifrado`/`rutHmac` en el
     * `data` del constructor. Si faltan, se lanza acá y no en producción con un
     * `rutCifrado: undefined` silencioso.
     */
    toDynamoItem() {
        if (!this._rutCifrado || !this._rutHmac) {
            throw new Error('toDynamoItem: falta rutCifrado/rutHmac — el RUT nunca se escribe en claro');
        }
        // La salud siempre tiene un valor (al menos el default "sin vigilancia"
        // que pone el constructor), así que siempre hay algo que cifrar. Si no
        // está cifrado a esta altura, quien construyó la instancia se saltó el
        // paso — mejor que reviente acá y no que escriba un `undefined`.
        if (!this._vigilanciaSaludCifrada) {
            throw new Error('toDynamoItem: falta vigilanciaSaludCifrada — la salud nunca se escribe en claro');
        }
        // A diferencia de vigilanciaSalud, restriccionLaboral SÍ puede ser
        // legítimamente `null` (sin restricción). Se cifra igual —incluido el
        // `null`— para no repetir el error de condicionar el cifrado al
        // contenido, que es justo el patrón de falla silenciosa que se evitó
        // en las respuestas de encuesta.
        if (!this._restriccionLaboralCifrada) {
            throw new Error('toDynamoItem: falta restriccionLaboralCifrada — la salud nunca se escribe en claro');
        }
        return {
            ...this.toDynamoKeys(),
            personaId: this.personaId,
            tenantId: this.tenantId,
            rutCifrado: this._rutCifrado,
            rutHmac: this._rutHmac,
            nombre: this.nombre,
            apellidoPaterno: this.apellidoPaterno,
            apellidoMaterno: this.apellidoMaterno,
            apellido: this.apellido,
            fechaNacimiento: this.fechaNacimiento,
            email: this.email,
            telefono: this.telefono,
            fotoPerfil: this.fotoPerfil,
            notificacionesSms: this.notificacionesSms,
            rol: this.rol,
            permisos: this.permisos,
            cargo: this.cargo,
            obraIds: this.obraIds,
            asignaciones: this.asignaciones,
            historialAsignaciones: this.historialAsignaciones,
            evidencias: this.evidencias,
            contactoEmergencia: this.contactoEmergencia,
            nivelEscolar: this.nivelEscolar,
            cursos: this.cursos,
            tieneAccesoWeb: this.tieneAccesoWeb,
            passwordHash: this._passwordHash,
            pinHash: this._pinHash,
            pinCreatedAt: this.pinCreatedAt,
            pinIntentosFallidos: this.pinIntentosFallidos,
            pinBloqueadaHasta: this.pinBloqueadaHasta,
            passwordTemporal: this.passwordTemporal,
            habilitado: this.habilitado,
            firmaEnrolamiento: this.firmaEnrolamiento,
            onboardingDS44: this.onboardingDS44,
            estado: this.estado,
            vigilanciaSaludCifrada: this._vigilanciaSaludCifrada,
            restriccionLaboralCifrada: this._restriccionLaboralCifrada,
            preferencias: this.preferencias,
            creadoPor: this.creadoPor,
            desvinculacion: this.desvinculacion,
            fechaTerminoVinculo: this.fechaTerminoVinculo,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            ultimoAcceso: this.ultimoAcceso
        };
    }

    /**
     * Crea instancia desde item de DynamoDB
     */
    static fromDynamoItem(item) {
        if (!item) return null;
        return new Persona(item);
    }

    /**
     * Formato seguro para API (sin hashes).
     *
     * La vigilancia de la salud y la restricción laboral (Arts. 67 a 69) son
     * datos sensibles de una persona identificable y NO viajan por omisión:
     * sin ellos la ficha se ve igual, con ellos cualquier pantalla que liste
     * personas los repartía a todo el que pudiera ver la lista. Los incluye
     * quien resuelva que corresponde — el permiso `persona.vigilancia_salud`, o
     * la propia persona sobre su ficha — pasando `{ incluirSalud: true }`. Es el
     * mismo criterio que ya aplica `lib/documentos-salud.js` a los documentos.
     *
     * @param {{incluirSalud?: boolean}} [opciones]
     */
    toSafeFormat({ incluirSalud = false } = {}) {
        return {
            personaId: this.personaId,
            tenantId: this.tenantId,
            rut: this.rut,
            nombre: this.nombre,
            apellidoPaterno: this.apellidoPaterno,
            apellidoMaterno: this.apellidoMaterno,
            apellido: this.apellido,
            fechaNacimiento: this.fechaNacimiento,
            email: this.email,
            telefono: this.telefono,
            fotoPerfil: this.fotoPerfil,
            notificacionesSms: this.notificacionesSms,
            rol: this.rol,
            permisos: this.permisos,
            cargo: this.cargo,
            obraIds: this.obraIds,
            asignaciones: this.asignaciones,
            historialAsignaciones: this.historialAsignaciones,
            evidencias: this.evidencias,
            contactoEmergencia: this.contactoEmergencia,
            nivelEscolar: this.nivelEscolar,
            cursos: this.cursos,
            tieneAccesoWeb: this.tieneAccesoWeb,
            habilitado: this.habilitado,
            pinConfigurado: this.tienePinConfigurado(),
            enrolado: this.estaEnrolado(),
            estado: this.estado,
            passwordTemporal: this.passwordTemporal,
            onboardingDS44: this.onboardingDS44,
            ...(incluirSalud ? {
                vigilanciaSalud: this.vigilanciaSalud,
                restriccionLaboral: this.restriccionLaboral,
            } : {}),
            preferencias: this.preferencias,
            creadoPor: this.creadoPor,
            desvinculacion: this.desvinculacion,
            fechaTerminoVinculo: this.fechaTerminoVinculo,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            ultimoAcceso: this.ultimoAcceso
        };
    }
}

module.exports = { Persona, ROLES };
