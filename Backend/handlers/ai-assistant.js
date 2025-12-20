const { success, error, created } = require('../lib/response');
const bedrock = require('../lib/bedrock');

/**
 * Respuestas de fallback en caso de que Bedrock falle
 */
const FALLBACK_RESPONSES = {
    miper: (cargo) => ({
        cargo,
        fecha: new Date().toISOString().split('T')[0],
        actividades: ['Actividades generales del cargo'],
        peligros: [
            {
                id: 1,
                peligro: 'Caída a distinto nivel',
                riesgo: 'Lesiones graves por caída',
                actividad: 'Trabajo en altura',
                probabilidad: 'M',
                consecuencia: '3',
                nivelRiesgo: 'Alto',
                medidasControl: ['Uso de arnés de seguridad', 'Líneas de vida'],
                epp: ['Arnés', 'Casco', 'Zapatos de seguridad'],
                responsable: 'Supervisor',
                verificacion: 'Inspección diaria'
            },
            {
                id: 2,
                peligro: 'Atrapamiento por máquinas',
                riesgo: 'Lesiones en extremidades',
                actividad: 'Operación de maquinaria',
                probabilidad: 'B',
                consecuencia: '3',
                nivelRiesgo: 'Medio',
                medidasControl: ['Guardas de protección', 'Bloqueo/etiquetado'],
                epp: ['Guantes', 'Ropa ajustada'],
                responsable: 'Operador',
                verificacion: 'Check list pre-operacional'
            },
            {
                id: 3,
                peligro: 'Exposición a ruido',
                riesgo: 'Pérdida auditiva',
                actividad: 'Trabajo cerca de equipos',
                probabilidad: 'A',
                consecuencia: '2',
                nivelRiesgo: 'Medio',
                medidasControl: ['Protección auditiva', 'Rotación de personal'],
                epp: ['Tapones auditivos', 'Orejeras'],
                responsable: 'Prevencionista',
                verificacion: 'Medición de ruido'
            }
        ],
        resumen: { totalPeligros: 3, criticos: 0, altos: 1, medios: 2, bajos: 0 },
        recomendacionesPrioritarias: [
            'Implementar programa de capacitación específico',
            'Realizar inspecciones semanales de EPP'
        ],
        _fallback: true
    }),

    riskMatrix: (actividad) => ({
        titulo: `Matriz de Riesgos - ${actividad}`,
        fecha: new Date().toISOString().split('T')[0],
        riesgos: [
            {
                id: 1,
                peligro: 'Trabajo en altura',
                riesgo: 'Caída a distinto nivel',
                probabilidad: 'Media',
                consecuencia: 'Grave',
                nivelRiesgo: 'Alto',
                medidasExistentes: ['Uso de arnés', 'Línea de vida'],
                medidasAdicionales: ['Capacitación específica', 'Inspección diaria de equipos'],
                responsable: 'Supervisor de obra',
                plazo: '7 días'
            },
            {
                id: 2,
                peligro: 'Materiales en suspensión',
                riesgo: 'Golpe por caída de objetos',
                probabilidad: 'Media',
                consecuencia: 'Moderada',
                nivelRiesgo: 'Medio',
                medidasExistentes: ['Casco de seguridad', 'Delimitación de área'],
                medidasAdicionales: ['Redes de contención', 'Señalización'],
                responsable: 'Jefe de cuadrilla',
                plazo: '3 días'
            }
        ],
        recomendaciones: [
            'Implementar programa de inspecciones semanales',
            'Documentar todas las medidas en registro digital'
        ],
        _fallback: true
    }),

    dailyTalk: (tema) => ({
        titulo: tema || 'Charla de Seguridad',
        duracion: '5 minutos',
        contenido: {
            introduccion: 'Buenos días equipo. Hoy hablaremos sobre un tema importante para nuestra seguridad.',
            puntosClaves: [
                'La seguridad es responsabilidad de todos',
                'Siempre usar el EPP adecuado',
                'Reportar cualquier condición insegura',
                'Seguir los procedimientos establecidos'
            ],
            ejemplos: [
                'Un compañero evitó un accidente por usar correctamente su EPP',
                'La comunicación oportuna permitió corregir una condición peligrosa'
            ],
            buenasPracticas: [
                'Revisar el área antes de comenzar',
                'Mantener orden y limpieza'
            ],
            conclusion: 'Recuerden: todos merecemos volver sanos a casa. La seguridad empieza por cada uno de nosotros.',
            preguntas: [
                '¿Cuál es el EPP básico para esta tarea?',
                '¿A quién reportamos una condición insegura?',
                '¿Por qué es importante el orden y limpieza?'
            ]
        },
        materialesApoyo: ['Afiches de seguridad', 'Checklist de revisión'],
        normativaRelacionada: ['DS 44', 'Ley 16.744'],
        _fallback: true
    })
};

/**
 * POST /ai/miper - Generar matriz MIPER para un cargo
 */
module.exports.generateMIPER = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { cargo, actividades = [], contexto = '' } = body;

        if (!cargo) {
            return error('Se requiere especificar el cargo');
        }

        try {
            const result = await bedrock.generateMIPER(cargo, actividades, contexto);
            return success(result);
        } catch (bedrockError) {
            console.error('Bedrock error, using fallback:', bedrockError.message);
            return success(FALLBACK_RESPONSES.miper(cargo));
        }
    } catch (err) {
        console.error('Error generating MIPER:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /ai/risk-matrix - Generar matriz de riesgos
 */
module.exports.generateRiskMatrix = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { actividad, descripcion, ubicacion } = body;

        if (!actividad) {
            return error('Se requiere especificar la actividad');
        }

        try {
            const result = await bedrock.generateRiskMatrix(actividad, descripcion, ubicacion);
            return success(result);
        } catch (bedrockError) {
            console.error('Bedrock error, using fallback:', bedrockError.message);
            return success(FALLBACK_RESPONSES.riskMatrix(actividad));
        }
    } catch (err) {
        console.error('Error generating risk matrix:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /ai/prevention-plan - Generar plan de prevención
 */
module.exports.generatePreventionPlan = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { obra, riesgos = [], duracion = 'mensual' } = body;

        if (!obra) {
            return error('Se requiere especificar la obra');
        }

        try {
            const result = await bedrock.generateMitigationPlan(obra, riesgos, duracion);
            return success(result);
        } catch (bedrockError) {
            console.error('Bedrock error, using fallback:', bedrockError.message);
            // Fallback similar structure
            return success({
                titulo: `Plan de Prevención - ${obra}`,
                periodo: duracion,
                objetivos: [
                    'Reducir tasa de accidentabilidad',
                    'Lograr 100% de cumplimiento en capacitaciones',
                    'Mantener cero accidentes'
                ],
                actividades: [
                    { actividad: 'Charla diaria 5 minutos', frecuencia: 'Diaria', responsable: 'Supervisor' },
                    { actividad: 'Inspección de EPP', frecuencia: 'Diaria', responsable: 'Jefe cuadrilla' },
                    { actividad: 'ART por cuadrilla', frecuencia: 'Diaria', responsable: 'Supervisor' }
                ],
                capacitaciones: ['Inducción general', 'Trabajo en altura', 'Primeros auxilios'],
                indicadores: [
                    { nombre: 'Tasa de accidentabilidad', meta: '< 2%', formula: 'Accidentes x 100 / Trabajadores' }
                ],
                _fallback: true
            });
        }
    } catch (err) {
        console.error('Error generating prevention plan:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /ai/daily-talk - Generar contenido para charla de 5 minutos
 */
module.exports.generateDailyTalk = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { tema, contexto = '' } = body;

        if (!tema) {
            return error('Se requiere especificar el tema');
        }

        try {
            const result = await bedrock.generateDailyTalk(tema, contexto);
            return success(result);
        } catch (bedrockError) {
            console.error('Bedrock error, using fallback:', bedrockError.message);
            return success(FALLBACK_RESPONSES.dailyTalk(tema));
        }
    } catch (err) {
        console.error('Error generating daily talk:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /ai/analyze-incident - Analizar incidente con árbol de causas
 */
module.exports.analyzeIncident = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { descripcion, tipo, gravedad, area } = body;

        if (!descripcion) {
            return error('Se requiere la descripción del incidente');
        }

        try {
            const result = await bedrock.analyzeIncident(descripcion, { tipo, gravedad, area });
            return success(result);
        } catch (bedrockError) {
            console.error('Bedrock error, using fallback:', bedrockError.message);
            return success({
                resumenIncidente: descripcion.substring(0, 100) + '...',
                arbolDeCausas: {
                    hecho: descripcion,
                    causasInmediatas: {
                        actosSubestandar: ['Acto inseguro identificado'],
                        condicionesSubestandar: ['Condición insegura identificada']
                    },
                    causasBasicas: {
                        factoresPersonales: ['Factor personal a investigar'],
                        factoresTrabajo: ['Factor del trabajo a investigar']
                    },
                    faltaControl: ['Falla en el sistema de gestión']
                },
                clasificacion: {
                    tipo: tipo || 'Incidente',
                    gravedad: gravedad || 'Por evaluar',
                    potencial: 'Requiere evaluación detallada'
                },
                accionesCorrectivas: [
                    { accion: 'Investigación detallada requerida', responsable: 'Prevencionista', plazo: '48 horas', prioridad: 'Alta' }
                ],
                accionesPreventivas: [
                    { accion: 'Revisión de procedimientos', responsable: 'Supervisión', plazo: '7 días' }
                ],
                leccionesAprendidas: ['Pendiente de conclusiones de investigación'],
                capacitacionRequerida: ['Reforzamiento de procedimientos'],
                _fallback: true
            });
        }
    } catch (err) {
        console.error('Error analyzing incident:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /ai/chat - Chat con el asistente de IA
 */
module.exports.chat = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { mensaje, contexto } = body;

        if (!mensaje) {
            return error('Se requiere un mensaje');
        }

        try {
            const respuesta = await bedrock.chat(mensaje);
            return success({
                respuesta,
                timestamp: new Date().toISOString()
            });
        } catch (bedrockError) {
            console.error('Bedrock error, using fallback chat:', bedrockError.message);
            // Fallback con respuestas predefinidas
            const respuestaFallback = generarRespuestaFallback(mensaje);
            return success({
                respuesta: respuestaFallback,
                timestamp: new Date().toISOString(),
                _fallback: true
            });
        }
    } catch (err) {
        console.error('Error in AI chat:', err);
        return error(err.message, 500);
    }
};

/**
 * Genera respuesta fallback basada en palabras clave
 */
function generarRespuestaFallback(mensaje) {
    const mensajeLower = mensaje.toLowerCase();

    if (mensajeLower.includes('ds 44') || mensajeLower.includes('decreto')) {
        return `El **Decreto Supremo 44** entró en vigencia en febrero de 2024 y moderniza la gestión preventiva en Chile.

📋 **Puntos clave:**
1. Gestión Preventiva Obligatoria
2. Mínimo 8 horas capacitación anual por trabajador
3. Departamento de Prevención obligatorio (100+ trabajadores)
4. Comités Paritarios con mayores facultades
5. Registro Digital obligatorio

¿Necesitas más información sobre algún aspecto específico?`;
    }

    if (mensajeLower.includes('miper') || mensajeLower.includes('matriz')) {
        return `La **Matriz MIPER** (Matriz de Identificación de Peligros y Evaluación de Riesgos) es una herramienta fundamental del DS 44.

📊 **Componentes:**
- Identificación de peligros
- Evaluación de riesgos (probabilidad x consecuencia)
- Medidas de control
- Responsables y plazos

💡 Puedo generarte una matriz MIPER completa para cualquier cargo. Solo indica el cargo y las actividades principales.`;
    }

    if (mensajeLower.includes('epp') || mensajeLower.includes('protección')) {
        return `🦺 **EPP Básico en Construcción:**
- Casco de seguridad
- Lentes de seguridad
- Chaleco reflectante
- Zapatos de seguridad
- Guantes según tarea

⚠️ **Según actividad:**
- Arnés (trabajo en altura)
- Protección auditiva
- Mascarilla (polvo/químicos)

La entrega de EPP debe registrarse con firma según DS 44.`;
    }

    return `Soy tu asistente de prevención de riesgos. Puedo ayudarte con:

📋 **Matrices de riesgo y MIPER**
📝 **Planes de prevención**
🔍 **Análisis de incidentes**
💬 **Charlas de 5 minutos**
📚 **Consultas sobre DS 44**

¿En qué te puedo ayudar?`;
}
