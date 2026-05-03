const { success, error, created } = require('../lib/response');
const gemini = require('../lib/gemini');

/**
 * Normaliza la respuesta de Bedrock Risk Matrix al formato esperado por el frontend
 */
function normalizeRiskMatrixResponse(result, actividad) {
    // Si Bedrock devolvió rawText (no pudo parsear JSON), lanzar error para usar fallback
    if (result.rawText) {
        console.warn('[AI] Bedrock returned rawText instead of parsed JSON');
        throw new Error('Invalid JSON response from Bedrock');
    }

    // Si ya tiene la estructura correcta, retornar tal cual
    if (result.riesgos && result.riesgos[0]?.medidasExistentes) {
        return result;
    }

    // Normalizar la respuesta de Bedrock al formato del frontend
    const normalized = {
        titulo: result.titulo || `Matriz de Riesgos - ${actividad}`,
        fecha: result.fecha || new Date().toISOString().split('T')[0],
        riesgos: [],
        recomendaciones: result.recomendaciones || result.recomendacionesPrioritarias || []
    };

    // Normalizar cada riesgo
    if (result.riesgos && Array.isArray(result.riesgos)) {
        normalized.riesgos = result.riesgos.map((r, idx) => ({
            id: r.id || idx + 1,
            peligro: r.peligro || 'Peligro identificado',
            riesgo: r.riesgo || 'Riesgo asociado',
            probabilidad: r.probabilidadTexto || (typeof r.probabilidad === 'number' ? ['Raro', 'Improbable', 'Posible', 'Probable', 'Casi Seguro'][r.probabilidad - 1] : r.probabilidad) || 'Media',
            consecuencia: r.consecuenciaTexto || (typeof r.consecuencia === 'number' ? ['Leve', 'Menor', 'Moderada', 'Mayor', 'Grave'][r.consecuencia - 1] : r.consecuencia) || 'Moderada',
            nivelRiesgo: r.nivelRiesgo || 'Medio',
            medidasExistentes: r.medidasExistentes || r.controlesExistentes || [],
            medidasAdicionales: r.medidasAdicionales || r.controlesAdicionales || [],
            responsable: r.responsable || 'Supervisor',
            plazo: r.plazo || r.plazoImplementacion || '7 días'
        }));
    }

    // Validar que hay riesgos, si no, lanzar error para fallback
    if (normalized.riesgos.length === 0) {
        throw new Error('No risks found in Bedrock response');
    }

    return normalized;
}

/**
 * Normaliza la respuesta de Bedrock MIPER al formato esperado por el frontend
 */
function normalizeMIPERResponse(result, cargo) {
    // Si Bedrock devolvió rawText (no pudo parsear JSON), lanzar error para usar fallback
    if (result.rawText) {
        console.warn('[AI] Bedrock returned rawText instead of parsed JSON');
        throw new Error('Invalid JSON response from Bedrock');
    }

    // Si ya tiene la estructura correcta, retornar tal cual
    if (result.peligros && result.peligros[0]?.medidasControl && Array.isArray(result.peligros[0].medidasControl)) {
        return result;
    }

    const normalized = {
        cargo: result.cargo || cargo,
        fecha: result.fecha || new Date().toISOString().split('T')[0],
        actividades: result.actividades || [],
        peligros: [],
        resumen: result.resumen || { totalPeligros: 0, criticos: 0, altos: 0, medios: 0, bajos: 0 },
        recomendacionesPrioritarias: result.recomendacionesPrioritarias || result.planAccion?.map(a => a.accion) || []
    };

    // Normalizar cada peligro
    if (result.peligros && Array.isArray(result.peligros)) {
        normalized.peligros = result.peligros.map((p, idx) => {
            // Extraer medidas de control si vienen como objeto
            let medidasControl = [];
            let epp = [];

            if (p.medidasControl) {
                if (Array.isArray(p.medidasControl)) {
                    medidasControl = p.medidasControl;
                } else if (typeof p.medidasControl === 'object') {
                    // Si es un objeto con categorías
                    if (p.medidasControl.administrativas) {
                        medidasControl = [...(p.medidasControl.administrativas || [])];
                    }
                    if (p.medidasControl.ingenieria && p.medidasControl.ingenieria !== 'N/A') {
                        medidasControl.unshift(p.medidasControl.ingenieria);
                    }
                    if (p.medidasControl.sustitucion && p.medidasControl.sustitucion !== 'N/A') {
                        medidasControl.unshift(p.medidasControl.sustitucion);
                    }
                    if (p.medidasControl.eliminacion && p.medidasControl.eliminacion !== 'N/A') {
                        medidasControl.unshift(p.medidasControl.eliminacion);
                    }
                    epp = p.medidasControl.epp || [];
                }
            }

            return {
                id: p.id || idx + 1,
                peligro: p.peligro || 'Peligro identificado',
                riesgo: p.riesgo || 'Riesgo asociado',
                actividad: p.actividad || 'Actividad general',
                probabilidad: p.probabilidad || 'M',
                consecuencia: String(p.consecuencia) || '2',
                nivelRiesgo: p.nivelRiesgo || 'Medio',
                medidasControl: medidasControl.length > 0 ? medidasControl : ['Medida de control estándar'],
                epp: epp.length > 0 ? epp : (p.epp || ['EPP básico']),
                responsable: p.responsable || 'Supervisor',
                verificacion: p.verificacion || p.frecuenciaVerificacion || 'Verificación periódica'
            };
        });

        // Recalcular resumen si no viene
        if (!result.resumen || result.resumen.totalPeligros === 0) {
            normalized.resumen = {
                totalPeligros: normalized.peligros.length,
                criticos: normalized.peligros.filter(p => p.nivelRiesgo === 'Crítico').length,
                altos: normalized.peligros.filter(p => p.nivelRiesgo === 'Alto').length,
                medios: normalized.peligros.filter(p => p.nivelRiesgo === 'Medio').length,
                bajos: normalized.peligros.filter(p => p.nivelRiesgo === 'Bajo').length
            };
        }
    }

    // Validar que hay peligros, si no, lanzar error para fallback
    if (normalized.peligros.length === 0) {
        throw new Error('No hazards found in Bedrock response');
    }

    return normalized;
}

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

const { docClient } = require('../lib/dynamodb');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * POST /ai/miper - Generar matriz MIPER para un cargo
 */
module.exports.generateMIPER = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { cargo, actividades = [], contexto = '', tenantId } = body;

        if (!cargo) {
            return error('Se requiere especificar el cargo');
        }

        let historicalContext = '';
        if (tenantId) {
            try {
                // Fetch recent incidents for the tenant to contextualize risk
                const incidentsResult = await docClient.send(new QueryCommand({
                    TableName: process.env.INCIDENTS_TABLE,
                    IndexName: 'tenantId-fecha-index',
                    KeyConditionExpression: 'tenantId = :tenantId',
                    ExpressionAttributeValues: {
                        ':tenantId': tenantId
                    },
                    Limit: 10,
                    ScanIndexForward: false // Most recent first
                }));

                const incidents = incidentsResult.Items || [];
                if (incidents.length > 0) {
                    console.log(`[AI] Found ${incidents.length} historical incidents for context.`);
                    historicalContext = incidents.map(inc =>
                        `- [${inc.fecha}] ${inc.titulo || 'Incidente'}: ${inc.descripcion} (Gravedad: ${inc.gravedad})`
                    ).join('\n');
                }
            } catch (dbError) {
                console.warn('[AI] Failed to fetch historical incidents:', dbError);
                // Continue without historical context
            }
        }

        try {
            console.log('[AI] Calling Gemini generateMIPER for cargo:', cargo);
            const result = await gemini.generateMIPER(cargo, actividades, contexto, historicalContext);
            console.log('[AI] Gemini generateMIPER SUCCESS');
            const normalized = normalizeMIPERResponse(result, cargo);
            return success({ ...normalized, _source: 'gemini', _generatedAt: new Date().toISOString() });
        } catch (geminiError) {
            console.error('[AI] Gemini generateMIPER FAILED:', geminiError.name, geminiError.message);
            console.error('[AI] Full error:', JSON.stringify(geminiError, null, 2));
            const fallbackResult = FALLBACK_RESPONSES.miper(cargo);
            return success({ ...fallbackResult, _source: 'fallback', _error: geminiError.message });
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
            console.log('[AI] Calling Gemini generateRiskMatrix for actividad:', actividad);
            const result = await gemini.generateRiskMatrix(actividad, descripcion, ubicacion);
            console.log('[AI] Gemini generateRiskMatrix SUCCESS');
            const normalized = normalizeRiskMatrixResponse(result, actividad);
            return success({ ...normalized, _source: 'gemini', _generatedAt: new Date().toISOString() });
        } catch (geminiError) {
            console.error('[AI] Gemini generateRiskMatrix FAILED:', geminiError.name, geminiError.message);
            console.error('[AI] Full error:', JSON.stringify(geminiError, null, 2));
            const fallbackResult = FALLBACK_RESPONSES.riskMatrix(actividad);
            return success({ ...fallbackResult, _source: 'fallback', _error: bedrockError.message });
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
            console.log('[AI] Calling Gemini generateMitigationPlan for obra:', obra);
            const result = await gemini.generateMitigationPlan(obra, riesgos, duracion);
            console.log('[AI] Gemini generateMitigationPlan SUCCESS');
            return success({ ...result, _source: 'gemini', _generatedAt: new Date().toISOString() });
        } catch (geminiError) {
            console.error('[AI] Gemini generateMitigationPlan FAILED:', geminiError.name, geminiError.message);
            console.error('[AI] Full error:', JSON.stringify(geminiError, null, 2));
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
                _source: 'fallback',
                _error: bedrockError.message
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
            console.log('[AI] Calling Gemini generateDailyTalk for tema:', tema);
            const result = await gemini.generateDailyTalk(tema, contexto);
            console.log('[AI] Gemini generateDailyTalk SUCCESS');
            return success({ ...result, _source: 'gemini', _generatedAt: new Date().toISOString() });
        } catch (geminiError) {
            console.error('[AI] Gemini generateDailyTalk FAILED:', geminiError.name, geminiError.message);
            console.error('[AI] Full error:', JSON.stringify(geminiError, null, 2));
            const fallbackResult = FALLBACK_RESPONSES.dailyTalk(tema);
            return success({ ...fallbackResult, _source: 'fallback', _error: bedrockError.message });
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
            console.log('[AI] Calling Gemini analyzeIncident');
            const result = await gemini.analyzeIncident(descripcion, { tipo, gravedad, area });
            console.log('[AI] Gemini analyzeIncident SUCCESS');
            return success({ ...result, _source: 'gemini', _generatedAt: new Date().toISOString() });
        } catch (geminiError) {
            console.error('[AI] Gemini analyzeIncident FAILED:', geminiError.name, geminiError.message);
            console.error('[AI] Full error:', JSON.stringify(geminiError, null, 2));
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
                _source: 'fallback',
                _error: bedrockError.message
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
            console.log('[AI] Calling Gemini chat');
            const respuesta = await gemini.chat(mensaje);
            console.log('[AI] Gemini chat SUCCESS');
            return success({
                respuesta,
                timestamp: new Date().toISOString(),
                _source: 'gemini'
            });
        } catch (geminiError) {
            console.error('[AI] Gemini chat FAILED:', geminiError.name, geminiError.message);
            console.error('[AI] Full error:', JSON.stringify(geminiError, null, 2));
            const respuestaFallback = generarRespuestaFallback(mensaje);
            return success({
                respuesta: respuestaFallback,
                timestamp: new Date().toISOString(),
                _source: 'fallback',
                _error: bedrockError.message
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

/**
 * POST /ai/extract-incident - Extraer datos de incidente de audio/texto
 */
module.exports.extractIncident = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { texto } = body;

        if (!texto) {
            return error('Se requiere el texto para procesar');
        }

        try {
            console.log('[AI] Calling Gemini extractIncidentFromText');
            const result = await gemini.extractIncidentFromText(texto);
            console.log('[AI] Gemini extractIncidentFromText SUCCESS');
            return success({ ...result, _generatedAt: new Date().toISOString() });
        } catch (geminiError) {
            console.error('[AI] Gemini extractIncidentFromText FAILED:', geminiError.message);
            // Fallback: Return raw text in description if AI fails
            return success({
                tipo: 'incidente',
                descripcion: texto,
                gravedad: 'leve',
                _source: 'fallback'
            });
        }
    } catch (err) {
        console.error('Error extracting incident info:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /ai/transcribe - Transcribir audio a texto usando Gemini
 */
module.exports.transcribeAudio = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { audio, mimeType } = body;

        if (!audio) {
            return error('Se requiere el audio en base64');
        }

        console.log('[AI] Calling Gemini transcribeAudio');
        const text = await gemini.transcribeAudio(audio, mimeType);
        console.log('[AI] Gemini transcribeAudio SUCCESS, length:', text.length);

        return success({ text });
    } catch (err) {
        console.error('Error transcribing audio:', err);
        return error(err.message, 500);
    }
};
