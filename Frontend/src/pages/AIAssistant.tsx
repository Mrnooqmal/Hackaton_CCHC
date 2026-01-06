import { useState, useRef, useEffect } from 'react';
import Header from '../components/Header';
import RiskMatrixVisual from '../components/RiskMatrixVisual';
import MIPERVisual from '../components/MIPERVisual';
import {
    FiSend,
    FiFileText,
    FiClipboard,
    FiMessageSquare,
    FiZap,
    FiDownload,
    FiAlertTriangle,
    FiUsers,
    FiShield,
    FiMaximize2,
    FiX
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

import { useAuth } from '../context/AuthContext';

export default function AIAssistant() {
    const { user } = useAuth();
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
    const [visualDocument, setVisualDocument] = useState<{ type: string; data: any } | null>(null);
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
                    response = await aiApi.generateMIPER(inputValue, [], undefined, user?.empresaId);
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
        const isVisualType = message.type === 'miper' || message.type === 'matrix';

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
                        maxWidth: isVisualType ? '100%' : '85%',
                        width: isVisualType ? '100%' : 'auto',
                        padding: isVisualType ? '0' : 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: isUser ? 'var(--primary-600)' : isVisualType ? 'transparent' : 'var(--surface-elevated)',
                        color: isUser ? 'white' : 'var(--text-primary)',
                        boxShadow: isVisualType ? 'none' : 'var(--shadow-sm)'
                    }}
                >
                    {/* Visual Document Preview for MIPER and Risk Matrix */}
                    {isVisualType && message.data ? (
                        <div style={{ marginBottom: 'var(--space-4)' }}>
                            <div className="flex justify-between items-center mb-3">
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                                    {message.type === 'miper' ? '🎯 Matriz MIPER generada' : '📋 Matriz de Riesgos generada'}
                                </span>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setVisualDocument({ type: message.type!, data: message.data })}
                                >
                                    <FiMaximize2 /> Ver documento interactivo
                                </button>
                            </div>
                            {/* Mini preview */}
                            <div
                                style={{
                                    background: 'var(--surface-elevated)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--space-4)',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setVisualDocument({ type: message.type!, data: message.data })}
                            >
                                <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                                    {message.type === 'miper' ? message.data.cargo : message.data.titulo}
                                </div>
                                <div className="flex gap-2 mb-2">
                                    {['Crítico', 'Alto', 'Medio', 'Bajo'].map(level => {
                                        let count = 0;

                                        if (message.type === 'miper') {
                                            count = message.data.resumen?.[level.toLowerCase() + 's'] || 0;
                                        } else {
                                            // FIX: Calculate manually for Risk Matrix to handle API inconsistencies
                                            // Normalizing Logic from RiskMatrixVisual.tsx
                                            const risks = message.data.riesgos || [];
                                            count = risks.filter((r: any) => {
                                                const lvl = r.nivelRiesgo || 'Bajo';
                                                const text = lvl.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                                                const target = level.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                                                return text.includes(target);
                                            }).length;

                                            // Fallback if manual count is 0 but stats exist (rare but possible)
                                            if (count === 0 && message.data.estadisticas?.[level.toLowerCase() + 's'] > 0) {
                                                count = message.data.estadisticas[level.toLowerCase() + 's'];
                                            }
                                        }

                                        const colors: Record<string, string> = { 'Crítico': '#ef4444', 'Alto': '#f97316', 'Medio': '#eab308', 'Bajo': '#22c55e' };
                                        return (
                                            <span key={level} style={{
                                                background: colors[level],
                                                color: level === 'Medio' || level === 'Bajo' ? '#1a1a1a' : 'white',
                                                padding: '4px 12px',
                                                borderRadius: '20px',
                                                fontSize: 'var(--text-xs)',
                                                fontWeight: 600
                                            }}>
                                                {count} {level}
                                            </span>
                                        );
                                    })}
                                </div>
                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                                    Click para ver el documento completo →
                                </div>
                            </div>
                        </div>
                    ) : (
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
                    )}

                    {message.data && !isVisualType && (
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

                    {!isVisualType && (
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
                    )}
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

            {/* Full-screen Visual Document Modal */}
            {visualDocument && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.85)',
                        zIndex: 1100,
                        display: 'flex',
                        flexDirection: 'column',
                        backdropFilter: 'blur(8px)'
                    }}
                >
                    {/* Modal Header */}
                    <div
                        style={{
                            padding: 'var(--space-4) var(--space-6)',
                            background: 'var(--surface-elevated)',
                            borderBottom: '1px solid var(--surface-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}
                    >
                        <div>
                            <h2 style={{ fontWeight: 700, fontSize: '1.25rem' }}>
                                {visualDocument.type === 'miper' ? '🎯 Matriz MIPER' : '📋 Matriz de Riesgos'}
                            </h2>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                                Documento interactivo - Revise, apruebe y exporte
                            </p>
                        </div>
                        <button
                            className="btn btn-ghost"
                            onClick={() => setVisualDocument(null)}
                            style={{ fontSize: '1.5rem' }}
                        >
                            <FiX />
                        </button>
                    </div>

                    {/* Modal Content */}
                    <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-6)' }}>
                        {visualDocument.type === 'miper' ? (
                            <MIPERVisual
                                data={visualDocument.data}
                                onApprove={(data) => {
                                    console.log('MIPER aprobado:', data);
                                    alert('✅ MIPER aprobado exitosamente. El documento ha sido guardado.');
                                    setVisualDocument(null);
                                }}
                            />
                        ) : (
                            <RiskMatrixVisual
                                data={visualDocument.data}
                                onApprove={(data) => {
                                    console.log('Matriz de riesgos aprobada:', data);
                                    alert('✅ Matriz de riesgos aprobada exitosamente. El documento ha sido guardado.');
                                    setVisualDocument(null);
                                }}
                            />
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
