import { useState, useRef, useEffect } from 'react';
import Header from '../components/Header';
import {
    FiSend,
    FiFileText,
    FiClipboard,
    FiMessageSquare,
    FiZap,
    FiDownload,
    FiAlertTriangle,
    FiUsers,
    FiShield
} from 'react-icons/fi';
import { aiApi, type MIPERResult, type RiskMatrixResult, type IncidentAnalysisResult, type DailyTalkResult, type PreventionPlanResult } from '../api/client';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    type?: 'text' | 'matrix' | 'plan' | 'talk' | 'miper' | 'incident';
    data?: any;
}

const QUICK_ACTIONS = [
    {
        id: 'miper',
        icon: FiUsers,
        label: 'Matriz MIPER',
        description: 'Generar matriz por cargo/actividad',
        color: 'var(--danger-500)',
        placeholder: 'Ej: Albañil, Soldador, Electricista'
    },
    {
        id: 'matrix',
        icon: FiClipboard,
        label: 'Matriz de Riesgos',
        description: 'Crear matriz para una actividad',
        color: 'var(--warning-500)',
        placeholder: 'Ej: Soldadura en altura, Excavación'
    },
    {
        id: 'plan',
        icon: FiFileText,
        label: 'Plan de Prevención',
        description: 'Generar plan mensual',
        color: 'var(--primary-500)',
        placeholder: 'Ej: Edificio Residencial Torre A'
    },
    {
        id: 'incident',
        icon: FiAlertTriangle,
        label: 'Analizar Incidente',
        description: 'Investigación con árbol de causas',
        color: 'var(--accent-500)',
        placeholder: 'Describa el incidente ocurrido...'
    },
    {
        id: 'talk',
        icon: FiMessageSquare,
        label: 'Charla 5 Min',
        description: 'Contenido para charla diaria',
        color: 'var(--info-500)',
        placeholder: 'Ej: Uso correcto del arnés'
    },
];

const EXAMPLE_PROMPTS = [
    '¿Qué dice el DS 44 sobre capacitaciones?',
    '¿Cuáles son los EPP para trabajo en altura?',
    '¿Cómo hago una matriz MIPER?',
    'Genera charla sobre orden y limpieza',
];

// Mapeo de nivel de riesgo a colores
const RISK_LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
    'Crítico': { bg: 'var(--danger-100)', text: 'var(--danger-700)' },
    'Alto': { bg: 'var(--warning-100)', text: 'var(--warning-700)' },
    'Medio': { bg: 'var(--info-100)', text: 'var(--info-700)' },
    'Bajo': { bg: 'var(--success-100)', text: 'var(--success-700)' },
};

export default function AIAssistant() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            role: 'assistant',
            content: '¡Hola! Soy tu asistente de prevención de riesgos con IA. Puedo ayudarte con:\n\n🎯 **Matriz MIPER** - Por cargo específico\n📋 **Matrices de riesgo** - Por actividad\n📝 **Planes de prevención** - Programas completos\n🔍 **Análisis de incidentes** - Árbol de causas DS 44\n💬 **Charlas de 5 minutos** - Contenido listo\n\n¿En qué puedo ayudarte hoy?',
            timestamp: new Date(),
            type: 'text'
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeAction, setActiveAction] = useState<string | null>(null);
    const [actionInput, setActionInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const addMessage = (role: 'user' | 'assistant', content: string, type?: string, data?: any) => {
        const newMessage: Message = {
            id: Date.now().toString(),
            role,
            content,
            timestamp: new Date(),
            type: type as any,
            data
        };
        setMessages(prev => [...prev, newMessage]);
        return newMessage;
    };

    const sendMessage = async () => {
        if (!input.trim() || loading) return;

        const userMessage = input.trim();
        setInput('');
        addMessage('user', userMessage);
        setLoading(true);

        try {
            const response = await aiApi.chat(userMessage);

            if (response.success && response.data) {
                addMessage('assistant', response.data.respuesta);
            } else {
                addMessage('assistant', 'Lo siento, hubo un error. Por favor intenta de nuevo.');
            }
        } catch (error) {
            addMessage('assistant', 'Error de conexión. Verifica que el servidor esté activo.');
        } finally {
            setLoading(false);
        }
    };

    const handleQuickAction = async (actionId: string) => {
        if (!actionInput.trim()) return;

        setLoading(true);
        const inputValue = actionInput.trim();
        setActionInput('');
        setActiveAction(null);

        let userMessage = '';

        switch (actionId) {
            case 'miper':
                userMessage = `🎯 Genera matriz MIPER para: ${inputValue}`;
                break;
            case 'matrix':
                userMessage = `📋 Genera matriz de riesgos para: ${inputValue}`;
                break;
            case 'plan':
                userMessage = `📝 Genera plan de prevención para: ${inputValue}`;
                break;
            case 'incident':
                userMessage = `🔍 Analiza el incidente: ${inputValue}`;
                break;
            case 'talk':
                userMessage = `💬 Genera charla de 5 minutos sobre: ${inputValue}`;
                break;
        }

        addMessage('user', userMessage);

        try {
            let response;
            let formattedContent = '';
            let data: any = null;

            switch (actionId) {
                case 'miper':
                    response = await aiApi.generateMIPER(inputValue);
                    if (response.success && response.data) {
                        data = response.data;
                        formattedContent = formatMIPERResponse(response.data);
                    }
                    break;
                case 'matrix':
                    response = await aiApi.generateRiskMatrix(inputValue);
                    if (response.success && response.data) {
                        data = response.data;
                        formattedContent = formatRiskMatrixResponse(response.data);
                    }
                    break;
                case 'plan':
                    response = await aiApi.generatePreventionPlan(inputValue);
                    if (response.success && response.data) {
                        data = response.data;
                        formattedContent = formatPreventionPlanResponse(response.data);
                    }
                    break;
                case 'incident':
                    response = await aiApi.analyzeIncident(inputValue);
                    if (response.success && response.data) {
                        data = response.data;
                        formattedContent = formatIncidentResponse(response.data);
                    }
                    break;
                case 'talk':
                    response = await aiApi.generateDailyTalk(inputValue);
                    if (response.success && response.data) {
                        data = response.data;
                        formattedContent = formatDailyTalkResponse(response.data);
                    }
                    break;
            }

            if (formattedContent) {
                addMessage('assistant', formattedContent, actionId, data);
            } else {
                addMessage('assistant', 'Hubo un error generando el contenido. Por favor intenta de nuevo.');
            }
        } catch (error) {
            addMessage('assistant', 'Error de conexión. Verifica que el servidor esté activo.');
        } finally {
            setLoading(false);
        }
    };

    // Formatters para cada tipo de respuesta
    const formatMIPERResponse = (data: MIPERResult): string => {
        const fallbackNote = data._fallback ? '\n\n⚠️ *Respuesta generada localmente (modo sin conexión)*' : '';
        return `## 🎯 Matriz MIPER - ${data.cargo}

**Fecha:** ${data.fecha}
**Actividades:** ${data.actividades.join(', ')}

### 📊 Resumen de Riesgos
- 🔴 Críticos: **${data.resumen.criticos}**
- 🟠 Altos: **${data.resumen.altos}**
- 🟡 Medios: **${data.resumen.medios}**
- 🟢 Bajos: **${data.resumen.bajos}**

### 🔍 Peligros Identificados

${data.peligros.map((p, i) => `
**${i + 1}. ${p.peligro}**
- 📌 Riesgo: ${p.riesgo}
- ⚡ Nivel: **${p.nivelRiesgo}** (P:${p.probabilidad} × C:${p.consecuencia})
- 🛡️ Control: ${p.medidasControl.join(', ')}
- 🦺 EPP: ${p.epp.join(', ')}
- 👤 Responsable: ${p.responsable}
`).join('\n')}

### 📋 Recomendaciones Prioritarias
${data.recomendacionesPrioritarias.map(r => `- ${r}`).join('\n')}${fallbackNote}`;
    };

    const formatRiskMatrixResponse = (data: RiskMatrixResult): string => {
        const fallbackNote = data._fallback ? '\n\n⚠️ *Respuesta generada localmente*' : '';
        return `## 📋 ${data.titulo}

**Fecha:** ${data.fecha}

### Riesgos Identificados

${data.riesgos.map((r, i) => `
**${i + 1}. ${r.peligro}**
- Riesgo: ${r.riesgo}
- Nivel: **${r.nivelRiesgo}** (${r.probabilidad} × ${r.consecuencia})
- Medidas existentes: ${r.medidasExistentes.join(', ')}
- Medidas adicionales: ${r.medidasAdicionales.join(', ')}
- Responsable: ${r.responsable} | Plazo: ${r.plazo}
`).join('\n')}

### Recomendaciones Generales
${data.recomendaciones.map(r => `- ${r}`).join('\n')}${fallbackNote}`;
    };

    const formatPreventionPlanResponse = (data: PreventionPlanResult): string => {
        const fallbackNote = data._fallback ? '\n\n⚠️ *Respuesta generada localmente*' : '';
        return `## 📝 ${data.titulo}

**Período:** ${data.periodo}

### Objetivos
${data.objetivos.map(o => `- ${o}`).join('\n')}

### Actividades Programadas
${data.actividades.map(a => `- **${a.actividad}** (${a.frecuencia}) - ${a.responsable}`).join('\n')}

### Capacitaciones Requeridas
${data.capacitaciones.map(c => `- ${c}`).join('\n')}

### Indicadores de Gestión
${data.indicadores.map(i => `- **${i.nombre}:** Meta ${i.meta}`).join('\n')}${fallbackNote}`;
    };

    const formatIncidentResponse = (data: IncidentAnalysisResult): string => {
        const fallbackNote = data._fallback ? '\n\n⚠️ *Requiere revisión por prevencionista*' : '';
        return `## 🔍 Análisis de Incidente

**Resumen:** ${data.resumenIncidente}

### 📌 Clasificación
- Tipo: **${data.clasificacion.tipo}**
- Gravedad: **${data.clasificacion.gravedad}**
- Potencial: ${data.clasificacion.potencial}

### 🌳 Árbol de Causas

**Hecho:** ${data.arbolDeCausas.hecho}

**Causas Inmediatas:**
- Actos: ${data.arbolDeCausas.causasInmediatas.actosSubestandar.join(', ')}
- Condiciones: ${data.arbolDeCausas.causasInmediatas.condicionesSubestandar.join(', ')}

**Causas Básicas:**
- F. Personales: ${data.arbolDeCausas.causasBasicas.factoresPersonales.join(', ')}
- F. Trabajo: ${data.arbolDeCausas.causasBasicas.factoresTrabajo.join(', ')}

### ✅ Acciones Correctivas
${data.accionesCorrectivas.map(a => `- **${a.prioridad}:** ${a.accion} (${a.responsable}, ${a.plazo})`).join('\n')}

### 🛡️ Acciones Preventivas
${data.accionesPreventivas.map(a => `- ${a.accion} (${a.responsable}, ${a.plazo})`).join('\n')}

### 💡 Lecciones Aprendidas
${data.leccionesAprendidas.map(l => `- ${l}`).join('\n')}${fallbackNote}`;
    };

    const formatDailyTalkResponse = (data: DailyTalkResult): string => {
        const fallbackNote = data._fallback ? '\n\n⚠️ *Respuesta generada localmente*' : '';
        return `## 💬 ${data.titulo}

**Duración:** ${data.duracion}

### 📢 Introducción
${data.contenido.introduccion}

### 📌 Puntos Clave
${data.contenido.puntosClaves.map((p, i) => `${i + 1}. ${p}`).join('\n')}

### 💡 Ejemplos Prácticos
${data.contenido.ejemplos.map(e => `- ${e}`).join('\n')}

### ✅ Conclusión
${data.contenido.conclusion}

### ❓ Preguntas de Verificación
${data.contenido.preguntas.map((p, i) => `${i + 1}. ${p}`).join('\n')}

${data.normativaRelacionada ? `**Normativa:** ${data.normativaRelacionada.join(', ')}` : ''}${fallbackNote}`;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const renderMessage = (message: Message) => {
        const isUser = message.role === 'user';

        return (
            <div
                key={message.id}
                className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
                style={{ marginBottom: 'var(--space-4)' }}
            >
                <div
                    className="avatar avatar-sm"
                    style={{
                        background: isUser ? 'var(--primary-500)' : 'linear-gradient(135deg, var(--accent-500), var(--primary-500))',
                        flexShrink: 0
                    }}
                >
                    {isUser ? '👤' : '🤖'}
                </div>

                <div
                    style={{
                        maxWidth: '85%',
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: isUser ? 'var(--primary-600)' : 'var(--surface-elevated)',
                        color: isUser ? 'white' : 'var(--text-primary)',
                        boxShadow: 'var(--shadow-sm)'
                    }}
                >
                    <div
                        style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}
                        dangerouslySetInnerHTML={{
                            __html: message.content
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/## (.*?)(\n|$)/g, '<h3 style="margin: 12px 0 8px; font-size: 1.15rem; color: var(--primary-400);">$1</h3>')
                                .replace(/### (.*?)(\n|$)/g, '<h4 style="margin: 10px 0 6px; font-size: 1rem; color: var(--text-secondary);">$1</h4>')
                                .replace(/📌|🔍|📋|📝|💬|🎯|⚡|🛡️|🦺|👤|🌳|✅|💡|📢|❓|🔴|🟠|🟡|🟢|⚠️/g, '<span style="font-size: 1.1em;">$&</span>')
                                .replace(/\n/g, '<br/>')
                        }}
                    />

                    {message.data && (
                        <div className="mt-4 flex gap-2">
                            <button className="btn btn-secondary btn-sm">
                                <FiDownload />
                                Descargar PDF
                            </button>
                            <button className="btn btn-ghost btn-sm">
                                <FiShield />
                                Guardar
                            </button>
                        </div>
                    )}

                    <div
                        className="text-sm mt-2"
                        style={{ opacity: 0.6, fontSize: '0.75rem' }}
                    >
                        {message.timestamp.toLocaleTimeString('es-CL', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                        {message.data?._fallback && ' • Modo offline'}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <Header title="Asistente IA de Prevención" />

            <div className="page-content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-height) - var(--space-12))' }}>
                {/* Quick Actions */}
                <div className="grid mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                    {QUICK_ACTIONS.map((action) => {
                        const Icon = action.icon;
                        const isActive = activeAction === action.id;

                        return (
                            <div
                                key={action.id}
                                className="card"
                                style={{
                                    cursor: 'pointer',
                                    padding: 'var(--space-3)',
                                    border: isActive ? `2px solid ${action.color}` : '1px solid var(--surface-border)',
                                    transition: 'all 0.2s'
                                }}
                                onClick={() => setActiveAction(isActive ? null : action.id)}
                            >
                                <div className="flex items-center gap-2">
                                    <div
                                        className="avatar avatar-sm"
                                        style={{ background: action.color, width: '32px', height: '32px' }}
                                    >
                                        <Icon size={14} />
                                    </div>
                                    <div>
                                        <div className="font-semibold" style={{ fontSize: 'var(--text-sm)' }}>{action.label}</div>
                                        <div className="text-xs text-muted">{action.description}</div>
                                    </div>
                                </div>

                                {isActive && (
                                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder={action.placeholder}
                                                value={actionInput}
                                                onChange={(e) => setActionInput(e.target.value)}
                                                className="form-input"
                                                style={{ fontSize: 'var(--text-sm)' }}
                                                onKeyDown={(e) => e.key === 'Enter' && handleQuickAction(action.id)}
                                                autoFocus
                                            />
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => handleQuickAction(action.id)}
                                                disabled={!actionInput.trim() || loading}
                                            >
                                                <FiZap />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Chat Area */}
                <div
                    className="card"
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}
                >
                    {/* Messages */}
                    <div
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: 'var(--space-4)'
                        }}
                    >
                        {messages.map(renderMessage)}

                        {loading && (
                            <div className="flex gap-3" style={{ marginBottom: 'var(--space-4)' }}>
                                <div className="avatar avatar-sm" style={{ background: 'linear-gradient(135deg, var(--accent-500), var(--primary-500))' }}>
                                    🤖
                                </div>
                                <div
                                    style={{
                                        padding: 'var(--space-4)',
                                        borderRadius: 'var(--radius-lg)',
                                        background: 'var(--surface-elevated)',
                                    }}
                                >
                                    <div className="flex gap-2 items-center">
                                        <div className="spinner" style={{ width: '16px', height: '16px' }} />
                                        <span className="text-muted">Generando con IA...</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Example prompts */}
                    {messages.length === 1 && (
                        <div
                            className="flex gap-2 flex-wrap"
                            style={{ padding: '0 var(--space-4) var(--space-4)' }}
                        >
                            {EXAMPLE_PROMPTS.map((prompt, i) => (
                                <button
                                    key={i}
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setInput(prompt)}
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input Area */}
                    <div
                        style={{
                            padding: 'var(--space-4)',
                            borderTop: '1px solid var(--surface-border)'
                        }}
                    >
                        <div className="flex gap-3">
                            <input
                                type="text"
                                placeholder="Escribe tu consulta sobre prevención de riesgos..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="form-input"
                                style={{ flex: 1 }}
                                disabled={loading}
                            />
                            <button
                                className="btn btn-primary"
                                onClick={sendMessage}
                                disabled={!input.trim() || loading}
                            >
                                <FiSend />
                                Enviar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
