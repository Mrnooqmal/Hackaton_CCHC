const { success, error } = require('../lib/response');

/**
 * Prompts preconfigurados para el dominio de prevención de riesgos
 */
const PREVENTION_PROMPTS = {
    riskMatrix: `Eres un experto en prevención de riesgos laborales en Chile, especializado en el DS 44.
Genera una matriz de riesgos profesional y completa para la actividad indicada.

La matriz debe incluir:
1. Identificación del peligro
2. Descripción del riesgo
3. Probabilidad (Alta/Media/Baja)
4. Consecuencia (Grave/Moderada/Leve)
5. Nivel de riesgo (Crítico/Alto/Medio/Bajo)
6. Medidas de control existentes
7. Medidas de control adicionales recomendadas
8. Responsable de implementación
9. Plazo sugerido

Formato tu respuesta como un JSON estructurado.`,

    preventionPlan: `Eres un experto en prevención de riesgos laborales en Chile.
Genera un plan de prevención detallado para la obra o actividad indicada.

El plan debe incluir:
1. Objetivos del plan
2. Alcance
3. Actividades preventivas programadas (con frecuencia)
4. Capacitaciones requeridas
5. Inspecciones y controles
6. EPP requeridos
7. Procedimientos de emergencia
8. Indicadores de gestión
9. Responsabilidades

Formato tu respuesta de manera estructurada y profesional.`,

    incidentAnalysis: `Eres un experto en investigación de accidentes laborales en Chile.
Analiza el incidente descrito y proporciona:

1. Análisis de causas (método árbol de causas según DS 44)
2. Causas inmediatas identificadas
3. Causas básicas/raíz
4. Factores contribuyentes
5. Acciones correctivas recomendadas
6. Acciones preventivas para evitar recurrencia
7. Lecciones aprendidas
8. Recomendaciones de capacitación

Sé específico y práctico en tus recomendaciones.`,

    dailyTalk: `Eres un experto en prevención de riesgos laborales.
Genera contenido para una charla de 5 minutos sobre el tema indicado.

La charla debe incluir:
1. Introducción al tema (30 segundos)
2. Puntos clave (3-4 puntos principales)
3. Ejemplos prácticos de la construcción
4. Buenas prácticas
5. Conclusión y llamado a la acción
6. Preguntas de verificación (2-3 preguntas)

El contenido debe ser conciso, práctico y fácil de comunicar verbalmente.`,

    assistant: `Eres un asistente experto en prevención de riesgos laborales en Chile.
Conoces profundamente:
- Decreto Supremo 44 (DS 44)
- Ley 16.744 sobre accidentes del trabajo
- Normativas de seguridad en construcción
- Gestión de EPP
- Procedimientos de trabajo seguro
- Investigación de accidentes
- Matrices de riesgo
- Planes de prevención

Responde de manera clara, práctica y profesional.
Si es relevante, cita la normativa aplicable.
Ofrece ejemplos concretos cuando sea útil.`
};

/**
 * Simulador de respuestas de IA (para demo sin API key)
 * En producción, esto se conectaría a Bedrock, OpenAI o Gemini
 */
const simulateAIResponse = async (prompt, context, type) => {
    // Simulación de delay de API
    await new Promise(resolve => setTimeout(resolve, 500));

    const responses = {
        riskMatrix: {
            titulo: `Matriz de Riesgos - ${context.actividad || 'Actividad General'}`,
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
                },
                {
                    id: 3,
                    peligro: 'Exposición a ruido',
                    riesgo: 'Pérdida auditiva',
                    probabilidad: 'Alta',
                    consecuencia: 'Moderada',
                    nivelRiesgo: 'Medio',
                    medidasExistentes: ['Protección auditiva'],
                    medidasAdicionales: ['Rotación de personal', 'Medición de ruido'],
                    responsable: 'Prevencionista',
                    plazo: '15 días'
                }
            ],
            recomendaciones: [
                'Implementar programa de inspecciones semanales',
                'Reforzar capacitación en trabajos de alto riesgo',
                'Documentar todas las medidas en registro digital'
            ]
        },

        preventionPlan: {
            titulo: `Plan de Prevención - ${context.obra || 'Obra General'}`,
            periodo: 'Mensual',
            objetivos: [
                'Reducir tasa de accidentabilidad en 20%',
                'Lograr 100% de cumplimiento en capacitaciones',
                'Mantener cero accidentes fatales'
            ],
            actividades: [
                { actividad: 'Charla diaria 5 minutos', frecuencia: 'Diaria', responsable: 'Supervisor' },
                { actividad: 'Inspección de EPP', frecuencia: 'Diaria', responsable: 'Jefe cuadrilla' },
                { actividad: 'ART por cuadrilla', frecuencia: 'Diaria', responsable: 'Supervisor' },
                { actividad: 'Inspección de andamios', frecuencia: 'Semanal', responsable: 'Prevencionista' },
                { actividad: 'Reunión comité paritario', frecuencia: 'Mensual', responsable: 'Prevencionista' },
                { actividad: 'Simulacro de emergencia', frecuencia: 'Trimestral', responsable: 'Prevencionista' }
            ],
            capacitaciones: [
                'Inducción general (8 horas)',
                'Trabajo en altura (4 horas)',
                'Manejo de sustancias peligrosas (2 horas)',
                'Primeros auxilios (4 horas)'
            ],
            indicadores: [
                { nombre: 'Tasa de accidentabilidad', meta: '< 2%', formula: 'Accidentes x 100 / Trabajadores' },
                { nombre: 'Cumplimiento capacitaciones', meta: '100%', formula: 'Capacitados / Total x 100' },
                { nombre: 'Cumplimiento inspecciones', meta: '> 95%', formula: 'Realizadas / Programadas x 100' }
            ]
        },

        dailyTalk: {
            titulo: context.tema || 'Uso correcto del casco de seguridad',
            duracion: '5 minutos',
            contenido: {
                introduccion: 'Buenos días equipo. Hoy hablaremos sobre la importancia del uso correcto del casco de seguridad, un elemento fundamental que nos protege de lesiones graves en la cabeza.',
                puntosClaves: [
                    'El casco debe usarse siempre que estemos en obra, sin excepción',
                    'Revisar el casco antes de cada uso: buscar grietas, deformaciones o daños',
                    'Ajustar correctamente el barbiquejo para que el casco no se caiga',
                    'Reemplazar el casco después de cualquier impacto, aunque no se vea dañado'
                ],
                ejemplos: [
                    'Un compañero evitó una lesión grave cuando le cayó una herramienta desde altura',
                    'El casco también protege del sol y la lluvia, manteniéndonos cómodos'
                ],
                conclusion: 'Recuerden: el casco es nuestra primera línea de defensa. Úsenlo siempre y correctamente.',
                preguntas: [
                    '¿Cada cuánto tiempo debemos revisar nuestro casco?',
                    '¿Qué debemos hacer si el casco sufre un impacto?',
                    '¿Por qué es importante el barbiquejo?'
                ]
            }
        },

        chat: {
            respuesta: generarRespuestaChat(context.mensaje || '')
        }
    };

    return responses[type] || responses.chat;
};

function generarRespuestaChat(mensaje) {
    const mensajeLower = mensaje.toLowerCase();

    if (mensajeLower.includes('ds 44') || mensajeLower.includes('decreto')) {
        return `El Decreto Supremo 44 (DS 44) entró en vigencia en febrero de 2024 y moderniza la gestión preventiva en Chile. 

**Puntos clave:**

1. **Gestión Preventiva Obligatoria**: Todas las empresas deben tener una matriz de riesgos y programas de trabajo preventivo.

2. **Capacitación**: Mínimo 8 horas anuales por trabajador.

3. **Departamento de Prevención**: Obligatorio para empresas con 100+ trabajadores.

4. **Comités Paritarios**: Con mayores facultades de investigación.

5. **Registro Digital**: Toda la gestión preventiva debe quedar documentada.

¿Necesitas más información sobre algún aspecto específico del DS 44?`;
    }

    if (mensajeLower.includes('epp') || mensajeLower.includes('equipo de protección')) {
        return `Los Equipos de Protección Personal (EPP) básicos en construcción incluyen:

**Obligatorios:**
- 🪖 Casco de seguridad
- 👓 Lentes de seguridad
- 🦺 Chaleco reflectante
- 🥾 Zapatos de seguridad con punta de acero
- 🧤 Guantes según la tarea

**Según actividad:**
- Arnés y línea de vida (trabajo en altura)
- Protección auditiva (zonas ruidosas)
- Mascarilla (exposición a polvo/químicos)
- Protección facial (soldadura)

**Importante:** La entrega de EPP debe quedar registrada con firma del trabajador según DS 44.`;
    }

    if (mensajeLower.includes('charla') || mensajeLower.includes('5 minutos')) {
        return `La charla diaria de 5 minutos es una herramienta fundamental de prevención.

**Requisitos según DS 44:**
- Debe realizarse al inicio de cada jornada
- Temas relacionados con los riesgos del día
- Registro de asistencia con firma de todos
- Firma del relator (supervisor)

**Temas sugeridos para esta semana:**
1. Orden y limpieza en el área de trabajo
2. Uso correcto de escaleras
3. Hidratación y protección solar
4. Comunicación de peligros
5. Manejo manual de cargas

¿Quieres que genere el contenido para alguna charla específica?`;
    }

    if (mensajeLower.includes('accidente') || mensajeLower.includes('incidente')) {
        return `Ante un accidente laboral, sigue estos pasos:

**Inmediatamente:**
1. Asegurar la escena y evitar más lesiones
2. Prestar primeros auxilios si es necesario
3. Llamar a emergencias si es grave
4. Notificar al supervisor y prevencionista

**Documentación (DS 44):**
1. Declaración Individual de Accidente (DIAT)
2. Investigación con metodología árbol de causas
3. Investigación del jefe directo
4. Acta del comité paritario (si aplica)

**Plazos:**
- Denuncia a la mutual: 24 horas
- Investigación: 48 horas máximo

¿Necesitas ayuda con la investigación de un accidente específico?`;
    }

    return `Entiendo tu consulta. Como asistente de prevención de riesgos, puedo ayudarte con:

📋 **Documentación DS 44**
- Matrices de riesgo
- Planes de prevención
- Procedimientos de trabajo seguro

📚 **Capacitación**
- Contenido para charlas de 5 minutos
- Material de inducción
- Evaluaciones

🔍 **Investigación**
- Análisis de accidentes
- Identificación de causas
- Acciones correctivas

💡 **Consultas Generales**
- Normativa vigente
- EPP requeridos
- Buenas prácticas

¿En qué te puedo ayudar específicamente?`;
}

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

        const response = await simulateAIResponse(
            PREVENTION_PROMPTS.assistant,
            { mensaje, ...contexto },
            'chat'
        );

        return success({
            respuesta: response.respuesta,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Error in AI chat:', err);
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

        const response = await simulateAIResponse(
            PREVENTION_PROMPTS.riskMatrix,
            { actividad, descripcion, ubicacion },
            'riskMatrix'
        );

        return success(response);
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
        const { obra, tipo, duracion } = body;

        if (!obra) {
            return error('Se requiere especificar la obra');
        }

        const response = await simulateAIResponse(
            PREVENTION_PROMPTS.preventionPlan,
            { obra, tipo, duracion },
            'preventionPlan'
        );

        return success(response);
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
        const { tema } = body;

        if (!tema) {
            return error('Se requiere especificar el tema');
        }

        const response = await simulateAIResponse(
            PREVENTION_PROMPTS.dailyTalk,
            { tema },
            'dailyTalk'
        );

        return success(response);
    } catch (err) {
        console.error('Error generating daily talk:', err);
        return error(err.message, 500);
    }
};
