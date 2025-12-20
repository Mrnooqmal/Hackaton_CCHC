import { useState, useRef, useEffect } from 'react';
import Header from '../components/Header';
import {
    FiSend,
    FiFileText,
    FiClipboard,
    FiMessageSquare,
    FiZap,
    FiDownload
} from 'react-icons/fi';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    type?: 'text' | 'matrix' | 'plan' | 'talk';
    data?: any;
}

const QUICK_ACTIONS = [
    {
        id: 'matrix',
        icon: FiClipboard,
        label: 'Generar Matriz de Riesgos',
        description: 'Crear matriz de riesgos para una actividad',
        color: 'var(--warning-500)'
    },
    {
        id: 'plan',
        icon: FiFileText,
        label: 'Plan de Prevención',
        description: 'Generar plan de prevención mensual',
        color: 'var(--primary-500)'
    },
    {
        id: 'talk',
        icon: FiMessageSquare,
        label: 'Charla 5 Minutos',
        description: 'Contenido para charla diaria',
        color: 'var(--info-500)'
    },
];

const EXAMPLE_PROMPTS = [
    '¿Qué dice el DS 44 sobre capacitaciones?',
    '¿Qué EPP se requiere para trabajo en altura?',
    '¿Cómo investigo un accidente laboral?',
    'Temas para charlas de seguridad en verano',
];

export default function AIAssistant() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            role: 'assistant',
            content: '¡Hola! Soy tu asistente de prevención de riesgos. Puedo ayudarte con:\n\n📋 **Matrices de riesgo** - Genera matrices profesionales\n📝 **Planes de prevención** - Programas mensuales completos\n💬 **Charlas de 5 minutos** - Contenido listo para usar\n❓ **Consultas DS 44** - Normativa y buenas prácticas\n\n¿En qué puedo ayudarte hoy?',
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
            const response = await fetch(`${API_BASE_URL}/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensaje: userMessage })
            });

            const result = await response.json();

            if (result.success && result.data) {
                addMessage('assistant', result.data.respuesta);
            } else {
                addMessage('assistant', 'Lo siento, hubo un error procesando tu consulta. Por favor intenta de nuevo.');
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
        const input = actionInput.trim();
        setActionInput('');
        setActiveAction(null);

        let endpoint = '';
        let body = {};
        let userMessage = '';

        switch (actionId) {
            case 'matrix':
                endpoint = '/ai/risk-matrix';
                body = { actividad: input };
                userMessage = `Genera una matriz de riesgos para: ${input}`;
                break;
            case 'plan':
                endpoint = '/ai/prevention-plan';
                body = { obra: input };
                userMessage = `Genera un plan de prevención para: ${input}`;
                break;
            case 'talk':
                endpoint = '/ai/daily-talk';
                body = { tema: input };
                userMessage = `Genera contenido para charla de 5 minutos sobre: ${input}`;
                break;
        }

        addMessage('user', userMessage);

        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const result = await response.json();

            if (result.success && result.data) {
                const formattedContent = formatActionResponse(actionId, result.data);
                addMessage('assistant', formattedContent, actionId, result.data);
            } else {
                addMessage('assistant', 'Hubo un error generando el contenido. Por favor intenta de nuevo.');
            }
        } catch (error) {
            addMessage('assistant', 'Error de conexión. Verifica que el servidor esté activo.');
        } finally {
            setLoading(false);
        }
    };

    const formatActionResponse = (actionId: string, data: any): string => {
        switch (actionId) {
            case 'matrix':
                return `## 📋 ${data.titulo}\n\n**Fecha:** ${data.fecha}\n\n### Riesgos Identificados:\n\n${data.riesgos.map((r: any, i: number) =>
                    `**${i + 1}. ${r.peligro}**\n- Riesgo: ${r.riesgo}\n- Nivel: **${r.nivelRiesgo}** (${r.probabilidad} x ${r.consecuencia})\n- Medidas: ${r.medidasExistentes.join(', ')}\n- Responsable: ${r.responsable}`
                ).join('\n\n')}\n\n### Recomendaciones:\n${data.recomendaciones.map((r: string) => `- ${r}`).join('\n')}`;

            case 'plan':
                return `## 📝 ${data.titulo}\n\n**Período:** ${data.periodo}\n\n### Objetivos:\n${data.objetivos.map((o: string) => `- ${o}`).join('\n')}\n\n### Actividades Programadas:\n${data.actividades.map((a: any) => `- **${a.actividad}** (${a.frecuencia}) - ${a.responsable}`).join('\n')}\n\n### Capacitaciones Requeridas:\n${data.capacitaciones.map((c: string) => `- ${c}`).join('\n')}\n\n### Indicadores de Gestión:\n${data.indicadores.map((i: any) => `- **${i.nombre}:** Meta ${i.meta}`).join('\n')}`;

            case 'talk':
                return `## 💬 ${data.titulo}\n\n**Duración:** ${data.duracion}\n\n### Introducción:\n${data.contenido.introduccion}\n\n### Puntos Clave:\n${data.contenido.puntosClaves.map((p: string) => `- ${p}`).join('\n')}\n\n### Ejemplos Prácticos:\n${data.contenido.ejemplos.map((e: string) => `- ${e}`).join('\n')}\n\n### Conclusión:\n${data.contenido.conclusion}\n\n### Preguntas de Verificación:\n${data.contenido.preguntas.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}`;

            default:
                return JSON.stringify(data, null, 2);
        }
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
                        background: isUser ? 'var(--primary-500)' : 'var(--accent-500)',
                        flexShrink: 0
                    }}
                >
                    {isUser ? '👤' : '🤖'}
                </div>

                <div
                    style={{
                        maxWidth: '80%',
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: isUser ? 'var(--primary-600)' : 'var(--surface-elevated)',
                        color: isUser ? 'white' : 'var(--text-primary)'
                    }}
                >
                    <div
                        style={{ whiteSpace: 'pre-wrap' }}
                        dangerouslySetInnerHTML={{
                            __html: message.content
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/## (.*?)(\n|$)/g, '<h3 style="margin: 8px 0; font-size: 1.1rem;">$1</h3>')
                                .replace(/### (.*?)(\n|$)/g, '<h4 style="margin: 8px 0; font-size: 1rem; color: var(--primary-400);">$1</h4>')
                                .replace(/\n/g, '<br/>')
                        }}
                    />

                    {message.data && (
                        <div className="mt-4">
                            <button className="btn btn-secondary btn-sm">
                                <FiDownload />
                                Descargar PDF
                            </button>
                        </div>
                    )}

                    <div
                        className="text-sm text-muted mt-2"
                        style={{ opacity: 0.7 }}
                    >
                        {message.timestamp.toLocaleTimeString('es-CL', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
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
                <div className="grid grid-cols-3 mb-4">
                    {QUICK_ACTIONS.map((action) => {
                        const Icon = action.icon;
                        const isActive = activeAction === action.id;

                        return (
                            <div
                                key={action.id}
                                className="card"
                                style={{
                                    cursor: 'pointer',
                                    border: isActive ? `2px solid ${action.color}` : undefined
                                }}
                                onClick={() => setActiveAction(isActive ? null : action.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className="avatar"
                                        style={{ background: action.color }}
                                    >
                                        <Icon />
                                    </div>
                                    <div>
                                        <div className="font-bold">{action.label}</div>
                                        <div className="text-sm text-muted">{action.description}</div>
                                    </div>
                                </div>

                                {isActive && (
                                    <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder={
                                                    action.id === 'matrix' ? 'Ej: Soldadura en altura' :
                                                        action.id === 'plan' ? 'Ej: Edificio Residencial Torre A' :
                                                            'Ej: Uso correcto del arnés'
                                                }
                                                value={actionInput}
                                                onChange={(e) => setActionInput(e.target.value)}
                                                className="form-input"
                                                onKeyDown={(e) => e.key === 'Enter' && handleQuickAction(action.id)}
                                            />
                                            <button
                                                className="btn btn-primary"
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
                                <div className="avatar avatar-sm" style={{ background: 'var(--accent-500)' }}>
                                    🤖
                                </div>
                                <div
                                    style={{
                                        padding: 'var(--space-4)',
                                        borderRadius: 'var(--radius-lg)',
                                        background: 'var(--surface-elevated)',
                                    }}
                                >
                                    <div className="flex gap-1">
                                        <div className="spinner" style={{ width: '16px', height: '16px' }} />
                                        <span className="text-muted">Pensando...</span>
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
                                    onClick={() => {
                                        setInput(prompt);
                                    }}
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
