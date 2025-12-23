/**
 * AWS Bedrock Client
 * Integración con modelos de IA para generación de contenido de prevención
 * Soporta Amazon Titan y Anthropic Claude
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Configuración del cliente Bedrock
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Modelo por defecto - Claude Haiku (mejor para seguir instrucciones JSON)
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

// Modelos alternativos para fallback
const FALLBACK_MODELS = [
  'anthropic.claude-3-haiku-20240307-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'amazon.titan-text-express-v1',
  'amazon.titan-tg1-large'
];

/**
 * Calcula el nivel de riesgo según matriz 5x5 estándar chilena
 * @param {string} probabilidad - A (Alta), M (Media), B (Baja)
 * @param {string} consecuencia - 1 (Leve), 2 (Moderada), 3 (Grave), 4 (Fatal)
 * @returns {string} Nivel de riesgo calculado
 */
function calcularNivelRiesgo(probabilidad, consecuencia) {
  const matriz = {
    'A-4': 'Crítico', 'A-3': 'Crítico', 'A-2': 'Alto', 'A-1': 'Medio',
    'M-4': 'Crítico', 'M-3': 'Alto', 'M-2': 'Medio', 'M-1': 'Bajo',
    'B-4': 'Alto', 'B-3': 'Medio', 'B-2': 'Bajo', 'B-1': 'Bajo'
  };
  return matriz[`${probabilidad}-${consecuencia}`] || 'Medio';
}

/**
 * Construye el payload según el modelo
 */
function buildPayload(modelId, systemPrompt, userMessage, maxTokens, temperature) {
  if (modelId.startsWith('amazon.titan')) {
    // Formato Amazon Titan
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`;
    return {
      inputText: fullPrompt,
      textGenerationConfig: {
        maxTokenCount: maxTokens,
        temperature: temperature,
        topP: 0.9,
        stopSequences: []
      }
    };
  } else if (modelId.startsWith('anthropic.claude')) {
    // Formato Anthropic Claude
    return {
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
  }
  throw new Error(`Modelo no soportado: ${modelId}`);
}

/**
 * Extrae el texto de respuesta según el modelo
 */
function extractResponse(modelId, responseBody) {
  if (modelId.startsWith('amazon.titan')) {
    // Respuesta Titan
    if (responseBody.results && responseBody.results[0]) {
      return responseBody.results[0].outputText;
    }
    throw new Error('Empty response from Titan');
  } else if (modelId.startsWith('anthropic.claude')) {
    // Respuesta Claude
    if (responseBody.content && responseBody.content[0]) {
      return responseBody.content[0].text;
    }
    throw new Error('Empty response from Claude');
  }
  throw new Error(`Modelo no soportado: ${modelId}`);
}

/**
 * Invoca un modelo de Bedrock con el prompt dado
 * Intenta con múltiples modelos si el primero falla
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

  // Lista de modelos a intentar (el solicitado primero, luego fallbacks)
  const modelsToTry = [modelId, ...FALLBACK_MODELS.filter(m => m !== modelId)];
  let lastError = null;

  for (const currentModel of modelsToTry) {
    try {
      console.log(`[Bedrock] Trying model: ${currentModel}`);

      const payload = buildPayload(currentModel, systemPrompt, userMessage, maxTokens, temperature);

      const command = new InvokeModelCommand({
        modelId: currentModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload)
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const text = extractResponse(currentModel, responseBody);
      console.log(`[Bedrock] Success with model: ${currentModel}`);

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
    } catch (error) {
      console.error(`[Bedrock] Model ${currentModel} failed:`, error.message);
      lastError = error;
      // Continuar con el siguiente modelo
    }
  }

  // Si todos los modelos fallaron, lanzar el último error
  console.error('[Bedrock] All models failed');
  throw lastError;
}

/**
 * Genera una matriz MIPER para un cargo específico
 * @param {string} cargo - Nombre del cargo
 * @param {string[]} actividades - Lista de actividades del cargo
 * @param {string} contexto - Contexto adicional (tipo de obra, etc)
 */
async function generateMIPER(cargo, actividades, contexto = '') {
  const systemPrompt = `Eres un experto consultor senior en prevención de riesgos laborales en Chile con 20+ años de experiencia.
Especializado en el Decreto Supremo 44 (DS 44) y la elaboración de matrices MIPER profesionales.

REGLAS ESTRICTAS:
1. DEBES responder ÚNICAMENTE con un JSON válido, sin texto adicional ni markdown.
2. Identifica MÍNIMO 6 peligros distintos y relevantes para el cargo.
3. La evaluación de riesgo DEBE ser coherente:
   - Probabilidad: A (Alta - ocurre frecuentemente), M (Media - puede ocurrir), B (Baja - poco probable)
   - Consecuencia: 1 (Leve - primeros auxilios), 2 (Moderada - tratamiento médico), 3 (Grave - incapacidad temporal), 4 (Fatal/Muy Grave - muerte o incapacidad permanente)
   - Nivel de Riesgo calculado según matriz: Crítico (A+3/4 o M+4), Alto (A+2 o M+3 o B+4), Medio (A+1 o M+2 o B+3), Bajo (M+1 o B+1/2)
4. Las medidas de control deben seguir la jerarquía: Eliminación > Sustitución > Controles de Ingeniería > Controles Administrativos > EPP
5. Sé específico al contexto chileno: menciona normativas aplicables (DS 594, NCh, etc.)`;

  const userMessage = `Genera una matriz MIPER profesional y completa para el cargo: "${cargo}"
${actividades.length > 0 ? `\nActividades principales del cargo: ${actividades.join(', ')}` : ''}
${contexto ? `\nContexto de la obra/empresa: ${contexto}` : ''}

Responde SOLO con este JSON (sin markdown ni texto adicional):
{
  "cargo": "${cargo}",
  "fecha": "${new Date().toISOString().split('T')[0]}",
  "version": "1.0",
  "elaboradoPor": "Sistema IA de Prevención",
  "actividades": ["actividad 1", "actividad 2", ...],
  "peligros": [
    {
      "id": 1,
      "categoria": "Mecánico|Físico|Químico|Biológico|Ergonómico|Psicosocial",
      "peligro": "descripción específica del peligro",
      "riesgo": "descripción del riesgo asociado y posibles daños",
      "actividad": "actividad donde se presenta",
      "probabilidad": "A|M|B",
      "consecuencia": "1|2|3|4",
      "nivelRiesgo": "Crítico|Alto|Medio|Bajo",
      "colorRiesgo": "#FF0000|#FFA500|#FFFF00|#00FF00",
      "medidasControl": {
        "eliminacion": "medida o N/A",
        "sustitucion": "medida o N/A",
        "ingenieria": "medida o N/A",
        "administrativas": ["medida 1", "medida 2"],
        "epp": ["EPP específico 1", "EPP 2"]
      },
      "normativaAplicable": "DS 594 Art. X, NCh XXX, etc.",
      "responsable": "cargo responsable de verificar",
      "frecuenciaVerificacion": "Diaria|Semanal|Mensual",
      "requiereCapacitacion": true|false
    }
  ],
  "resumen": {
    "totalPeligros": número,
    "criticos": número,
    "altos": número,
    "medios": número,
    "bajos": número,
    "porcentajeCriticoAlto": número
  },
  "planAccion": [
    {
      "prioridad": 1,
      "accion": "acción prioritaria",
      "peligroRelacionado": "peligro al que responde",
      "plazo": "Inmediato|7 días|15 días|30 días",
      "responsable": "cargo",
      "recursos": "recursos necesarios"
    }
  ],
  "capacitacionesRequeridas": [
    {
      "tema": "nombre del curso/charla",
      "duracion": "X horas",
      "frecuencia": "Inducción|Anual|Semestral",
      "obligatoria": true|false
    }
  ],
  "eppObligatorio": ["EPP 1", "EPP 2", ...],
  "recomendacionesPrioritarias": ["recomendación 1", "recomendación 2", ...]
}`;

  return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.4 });
}

/**
 * Genera una matriz de riesgos visual 5x5 para una actividad específica
 */
async function generateRiskMatrix(actividad, descripcion = '', ubicacion = '') {
  const systemPrompt = `Eres un experto consultor senior en prevención de riesgos laborales en Chile.
Especializado en el DS 44 y la generación de matrices de riesgo profesionales.

REGLAS:
1. Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional.
2. El nivel de riesgo debe calcularse correctamente según la matriz 5x5 estándar.
3. Incluye datos para visualización de la matriz de calor.
4. Las coordenadas de la matriz son: probabilidad (1-5 eje Y), consecuencia (1-5 eje X).`;

  const userMessage = `Genera una matriz de riesgos visual y profesional para: "${actividad}"
${descripcion ? `\nDescripción detallada: ${descripcion}` : ''}
${ubicacion ? `\nUbicación/Contexto: ${ubicacion}` : ''}

Responde SOLO con este JSON:
{
  "titulo": "Matriz de Riesgos - ${actividad}",
  "fecha": "${new Date().toISOString().split('T')[0]}",
  "actividad": "${actividad}",
  "matrizVisual": {
    "ejeX": ["Insignificante", "Menor", "Moderada", "Mayor", "Catastrófica"],
    "ejeY": ["Raro", "Improbable", "Posible", "Probable", "Casi Seguro"],
    "celdas": [
      {"x": 1, "y": 1, "nivel": "Bajo", "color": "#22c55e"},
      {"x": 2, "y": 1, "nivel": "Bajo", "color": "#22c55e"},
      {"x": 3, "y": 1, "nivel": "Medio", "color": "#eab308"},
      {"x": 4, "y": 1, "nivel": "Alto", "color": "#f97316"},
      {"x": 5, "y": 1, "nivel": "Alto", "color": "#f97316"},
      {"x": 1, "y": 2, "nivel": "Bajo", "color": "#22c55e"},
      {"x": 2, "y": 2, "nivel": "Medio", "color": "#eab308"},
      {"x": 3, "y": 2, "nivel": "Medio", "color": "#eab308"},
      {"x": 4, "y": 2, "nivel": "Alto", "color": "#f97316"},
      {"x": 5, "y": 2, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 1, "y": 3, "nivel": "Bajo", "color": "#22c55e"},
      {"x": 2, "y": 3, "nivel": "Medio", "color": "#eab308"},
      {"x": 3, "y": 3, "nivel": "Alto", "color": "#f97316"},
      {"x": 4, "y": 3, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 5, "y": 3, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 1, "y": 4, "nivel": "Medio", "color": "#eab308"},
      {"x": 2, "y": 4, "nivel": "Alto", "color": "#f97316"},
      {"x": 3, "y": 4, "nivel": "Alto", "color": "#f97316"},
      {"x": 4, "y": 4, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 5, "y": 4, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 1, "y": 5, "nivel": "Alto", "color": "#f97316"},
      {"x": 2, "y": 5, "nivel": "Alto", "color": "#f97316"},
      {"x": 3, "y": 5, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 4, "y": 5, "nivel": "Crítico", "color": "#ef4444"},
      {"x": 5, "y": 5, "nivel": "Crítico", "color": "#ef4444"}
    ]
  },
  "riesgos": [
    {
      "id": 1,
      "codigo": "R-001",
      "peligro": "fuente de peligro",
      "riesgo": "descripción del riesgo",
      "consecuencias": ["consecuencia 1", "consecuencia 2"],
      "probabilidad": 3,
      "probabilidadTexto": "Posible",
      "consecuencia": 4,
      "consecuenciaTexto": "Mayor",
      "nivelRiesgo": "Crítico|Alto|Medio|Bajo",
      "colorRiesgo": "#ef4444|#f97316|#eab308|#22c55e",
      "posicionMatriz": {"x": 4, "y": 3},
      "controlesExistentes": ["control 1"],
      "controlesAdicionales": ["control propuesto"],
      "riesgoResidual": "Medio",
      "responsable": "cargo",
      "plazoImplementacion": "7 días",
      "estadoControl": "Pendiente|En Proceso|Implementado"
    }
  ],
  "estadisticas": {
    "total": número,
    "criticos": número,
    "altos": número,
    "medios": número,
    "bajos": número
  },
  "recomendacionesPrioritarias": ["recomendación 1", "recomendación 2"],
  "proximaRevision": "fecha sugerida"
}`;

  return invokeModel(systemPrompt, userMessage, { jsonOutput: true, temperature: 0.4 });
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
  calcularNivelRiesgo,
  DEFAULT_MODEL_ID
};
