/**
 * AWS Bedrock Client
 * Integración con modelos de IA Claude 3 para generación de contenido de prevención
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Configuración del cliente Bedrock
const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

// Modelo por defecto (Claude 3 Haiku es más rápido y económico para tareas simples)
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
// Para respuestas más elaboradas usar: 'anthropic.claude-3-sonnet-20240229-v1:0'

/**
 * Invoca un modelo de Bedrock con el prompt dado
 * @param {string} systemPrompt - Prompt del sistema que define el rol
 * @param {string} userMessage - Mensaje del usuario
 * @param {object} options - Opciones adicionales
 * @returns {Promise<string>} Respuesta del modelo
 */
async function invokeModel(systemPrompt, userMessage, options = {}) {
    const {
        modelId = DEFAULT_MODEL_ID,
        maxTokens = 4096,
        temperature = 0.7,
        jsonOutput = false
    } = options;

    const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [
            {
                role: 'user',
                content: userMessage
            }
        ]
    };

    try {
        const command = new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(payload)
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (responseBody.content && responseBody.content[0]) {
            const text = responseBody.content[0].text;

            // Si se espera JSON, intentar parsearlo
            if (jsonOutput) {
                try {
                    // Extraer JSON del texto (puede venir con markdown)
                    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ||
                        text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const jsonStr = jsonMatch[1] || jsonMatch[0];
                        return JSON.parse(jsonStr);
                    }
                    return JSON.parse(text);
                } catch (parseErr) {
                    console.warn('Failed to parse JSON response, returning raw text');
                    return { rawText: text };
                }
            }

            return text;
        }

        throw new Error('Empty response from Bedrock');
    } catch (error) {
        console.error('Bedrock invocation error:', error);
        throw error;
    }
}

/**
 * Genera una matriz MIPER para un cargo específico
 * @param {string} cargo - Nombre del cargo
 * @param {string[]} actividades - Lista de actividades del cargo
 * @param {string} contexto - Contexto adicional (tipo de obra, etc)
 */
async function generateMIPER(cargo, actividades, contexto = '') {
    const systemPrompt = `Eres un experto en prevención de riesgos laborales en Chile, especializado en el DS 44 y la elaboración de matrices MIPER (Matriz de Identificación de Peligros y Evaluación de Riesgos).

DEBES responder ÚNICAMENTE con un JSON válido, sin texto adicional ni markdown.

Utiliza la siguiente escala de evaluación:
- Probabilidad: A (Alta), M (Media), B (Baja)
- Consecuencia: 1 (Leve), 2 (Moderada), 3 (Grave), 4 (Fatal)
- Nivel de Riesgo: Crítico (A+3/4), Alto (A+2 o M+3/4), Medio (M+2 o B+3/4), Bajo (resto)`;

    const userMessage = `Genera una matriz MIPER completa para el cargo: "${cargo}"
${actividades.length > 0 ? `\nActividades principales: ${actividades.join(', ')}` : ''}
${contexto ? `\nContexto: ${contexto}` : ''}

Responde con este JSON exacto (mínimo 5 peligros identificados):
{
  "cargo": "${cargo}",
  "fecha": "${new Date().toISOString().split('T')[0]}",
  "actividades": [...],
  "peligros": [
    {
      "id": 1,
      "peligro": "descripción del peligro",
      "riesgo": "descripción del riesgo asociado",
      "actividad": "actividad donde ocurre",
      "probabilidad": "A|M|B",
      "consecuencia": "1|2|3|4",
      "nivelRiesgo": "Crítico|Alto|Medio|Bajo",
      "medidasControl": ["medida 1", "medida 2"],
      "epp": ["EPP requerido"],
      "responsable": "cargo responsable",
      "verificacion": "método de verificación"
    }
  ],
  "resumen": {
    "totalPeligros": número,
    "criticos": número,
    "altos": número,
    "medios": número,
    "bajos": número
  },
  "recomendacionesPrioritarias": ["recomendación 1", "recomendación 2"]
}`;

    return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.5 });
}

/**
 * Genera una matriz de riesgos para una actividad específica
 */
async function generateRiskMatrix(actividad, descripcion = '', ubicacion = '') {
    const systemPrompt = `Eres un experto en prevención de riesgos laborales en Chile, especializado en el DS 44.
DEBES responder ÚNICAMENTE con un JSON válido, sin texto adicional.`;

    const userMessage = `Genera una matriz de riesgos profesional para la actividad: "${actividad}"
${descripcion ? `\nDescripción: ${descripcion}` : ''}
${ubicacion ? `\nUbicación: ${ubicacion}` : ''}

Responde con este JSON (mínimo 4 riesgos):
{
  "titulo": "Matriz de Riesgos - ${actividad}",
  "fecha": "${new Date().toISOString().split('T')[0]}",
  "riesgos": [
    {
      "id": número,
      "peligro": "fuente de peligro",
      "riesgo": "descripción del riesgo",
      "probabilidad": "Alta|Media|Baja",
      "consecuencia": "Grave|Moderada|Leve",
      "nivelRiesgo": "Crítico|Alto|Medio|Bajo",
      "medidasExistentes": ["medida 1"],
      "medidasAdicionales": ["medida adicional"],
      "responsable": "cargo",
      "plazo": "X días"
    }
  ],
  "recomendaciones": ["recomendación general 1", "recomendación 2"]
}`;

    return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.5 });
}

/**
 * Genera un plan de mitigación/prevención
 */
async function generateMitigationPlan(obra, riesgos = [], duracion = 'mensual') {
    const systemPrompt = `Eres un experto en prevención de riesgos laborales en Chile.
DEBES responder ÚNICAMENTE con un JSON válido, sin texto adicional.`;

    const userMessage = `Genera un plan de prevención y mitigación para: "${obra}"
Duración: ${duracion}
${riesgos.length > 0 ? `\nRiesgos identificados: ${riesgos.join(', ')}` : ''}

Responde con este JSON:
{
  "titulo": "Plan de Prevención - ${obra}",
  "periodo": "${duracion}",
  "objetivos": ["objetivo 1", "objetivo 2"],
  "actividades": [
    {"actividad": "nombre", "frecuencia": "Diaria|Semanal|Mensual", "responsable": "cargo"}
  ],
  "capacitaciones": ["capacitación 1 (X horas)"],
  "inspecciones": [
    {"tipo": "nombre", "frecuencia": "frecuencia", "responsable": "cargo"}
  ],
  "epp": ["EPP 1", "EPP 2"],
  "indicadores": [
    {"nombre": "indicador", "meta": "valor meta", "formula": "cómo se calcula"}
  ],
  "procedimientosEmergencia": ["procedimiento 1"],
  "cronograma": [
    {"semana": 1, "actividades": ["actividad 1"]}
  ]
}`;

    return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.6 });
}

/**
 * Analiza un incidente con metodología árbol de causas
 */
async function analyzeIncident(descripcion, contexto = {}) {
    const systemPrompt = `Eres un experto investigador de accidentes laborales en Chile, especializado en la metodología de Árbol de Causas según DS 44.
DEBES responder ÚNICAMENTE con un JSON válido.`;

    const userMessage = `Analiza el siguiente incidente:
"${descripcion}"
${contexto.tipo ? `\nTipo: ${contexto.tipo}` : ''}
${contexto.gravedad ? `\nGravedad: ${contexto.gravedad}` : ''}
${contexto.area ? `\nÁrea: ${contexto.area}` : ''}

Responde con este JSON:
{
  "resumenIncidente": "resumen breve",
  "arbolDeCausas": {
    "hecho": "descripción del hecho",
    "causasInmediatas": {
      "actosSubestandar": ["acto 1"],
      "condicionesSubestandar": ["condición 1"]
    },
    "causasBasicas": {
      "factoresPersonales": ["factor 1"],
      "factoresTrabajo": ["factor 1"]
    },
    "faltaControl": ["falla de control 1"]
  },
  "clasificacion": {
    "tipo": "Accidente|Incidente|Casi-accidente",
    "gravedad": "Leve|Moderada|Grave|Fatal",
    "potencial": "descripción del potencial de daño"
  },
  "accionesCorrectivas": [
    {"accion": "descripción", "responsable": "cargo", "plazo": "X días", "prioridad": "Alta|Media|Baja"}
  ],
  "accionesPreventivas": [
    {"accion": "descripción", "responsable": "cargo", "plazo": "X días"}
  ],
  "leccionesAprendidas": ["lección 1"],
  "capacitacionRequerida": ["tema de capacitación"]
}`;

    return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.4 });
}

/**
 * Genera contenido para charla de 5 minutos
 */
async function generateDailyTalk(tema, contexto = '') {
    const systemPrompt = `Eres un experto en prevención de riesgos laborales.
DEBES responder ÚNICAMENTE con un JSON válido.`;

    const userMessage = `Genera contenido para una charla de 5 minutos sobre: "${tema}"
${contexto ? `\nContexto: ${contexto}` : ''}

Responde con este JSON:
{
  "titulo": "${tema}",
  "duracion": "5 minutos",
  "contenido": {
    "introduccion": "texto de introducción (30 segundos)",
    "puntosClaves": ["punto 1", "punto 2", "punto 3", "punto 4"],
    "ejemplos": ["ejemplo práctico 1", "ejemplo 2"],
    "buenasPracticas": ["práctica 1", "práctica 2"],
    "conclusion": "texto de conclusión y llamado a la acción",
    "preguntas": ["pregunta de verificación 1", "pregunta 2", "pregunta 3"]
  },
  "materialesApoyo": ["material sugerido"],
  "normativaRelacionada": ["norma o ley aplicable"]
}`;

    return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.7 });
}

/**
 * Chat general con el asistente
 */
async function chat(mensaje, historial = []) {
    const systemPrompt = `Eres un asistente experto en prevención de riesgos laborales en Chile.
Conoces profundamente:
- Decreto Supremo 44 (DS 44)
- Ley 16.744 sobre accidentes del trabajo
- Normativas de seguridad en construcción
- Gestión de EPP
- Procedimientos de trabajo seguro
- Investigación de accidentes
- Matrices de riesgo y MIPER
- Planes de prevención

Responde de manera clara, práctica y profesional.
Si es relevante, cita la normativa aplicable.
Usa emojis para hacer la respuesta más visual.
Ofrece ejemplos concretos cuando sea útil.`;

    return invokeModel(systemPrompt, mensaje, { temperature: 0.7 });
}

module.exports = {
    invokeModel,
    generateMIPER,
    generateRiskMatrix,
    generateMitigationPlan,
    analyzeIncident,
    generateDailyTalk,
    chat,
    DEFAULT_MODEL_ID
};
