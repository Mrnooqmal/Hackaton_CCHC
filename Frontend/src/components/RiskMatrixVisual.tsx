import React, { useState } from 'react';
import { FiAlertTriangle, FiCheck, FiInfo, FiX, FiDownload, FiTarget, FiShield } from 'react-icons/fi';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface RiskItem {
    id: number;
    codigo?: string;
    peligro: string;
    riesgo: string;
    probabilidad: number;
    probabilidadTexto?: string;
    consecuencia: number;
    consecuenciaTexto?: string;
    nivelRiesgo: string;
    colorRiesgo?: string;
    posicionMatriz?: { x: number; y: number };
    controlesExistentes?: string[];
    controlesAdicionales?: string[];
    riesgoResidual?: string;
    responsable?: string;
    plazoImplementacion?: string;
    estadoControl?: string;
}

interface PlanMitigacion {
    prioridad: number;
    riesgoId: number;
    accion: string;
    responsable: string;
    plazo: string;
    recursos?: string;
    indicador?: string;
}

interface RiskMatrixData {
    titulo: string;
    fecha: string;
    obra?: string;
    actividad?: string;
    riesgos: RiskItem[];
    estadisticas?: {
        total: number;
        criticos: number;
        altos: number;
        medios: number;
        bajos: number;
    };
    planMitigacion?: PlanMitigacion[];
    recomendacionesPrioritarias?: string[];
    _fallback?: boolean;
}

interface RiskMatrixVisualProps {
    data: RiskMatrixData;
    onApprove?: (data: RiskMatrixData) => void;
    onExport?: () => void;
}

const NIVEL_COLORS: Record<string, string> = {
    'Crítico': '#dc2626',
    'Alto': '#ea580c',
    'Medio': '#ca8a04',
    'Bajo': '#16a34a'
};

const PROBABILITY_LABELS = ['Muy Baja', 'Baja', 'Media', 'Alta', 'Muy Alta'];
const IMPACT_LABELS = ['Insignificante', 'Menor', 'Moderado', 'Mayor', 'Catastrófico'];

// Matriz de colores 5x5 (probabilidad Y, impacto X)
const MATRIX_LEVELS: string[][] = [
    ['Bajo', 'Bajo', 'Medio', 'Alto', 'Alto'],       // Prob 1 (Muy Baja)
    ['Bajo', 'Medio', 'Medio', 'Alto', 'Crítico'],   // Prob 2 (Baja)
    ['Bajo', 'Medio', 'Alto', 'Crítico', 'Crítico'], // Prob 3 (Media)
    ['Medio', 'Alto', 'Alto', 'Crítico', 'Crítico'], // Prob 4 (Alta)
    ['Alto', 'Alto', 'Crítico', 'Crítico', 'Crítico'] // Prob 5 (Muy Alta)
];

// Helper to parse prob/mpact values safely
const parseMetricValue = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;

    // Check if it's a string number "3"
    const num = Number(val);
    if (!isNaN(num)) return num;

    // Check for text labels
    const text = String(val).toLowerCase();
    if (text.includes('muy alta') || text.includes('catastrófica') || text.includes('catastrofico')) return 5;
    if (text.includes('alta') || text.includes('mayor')) return 4;
    if (text.includes('media') || text.includes('moderada')) return 3;
    if (text.includes('baja') || text.includes('menor')) return 2;
    if (text.includes('muy baja') || text.includes('insignificante')) return 1;

    return 0;
}

// Helper to normalize risk level string (handle accents, case)
const normalizeRiskLevel = (level: string): string => {
    if (!level) return 'Bajo';
    const text = level.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove accents

    if (text.includes('critico')) return 'Crítico';
    if (text.includes('alto')) return 'Alto';
    if (text.includes('medio') || text.includes('moderado')) return 'Medio';
    if (text.includes('bajo')) return 'Bajo';

    return 'Medio'; // Fallback
};

export default function RiskMatrixVisual({ data, onApprove, onExport }: RiskMatrixVisualProps) {
    const [selectedRisk, setSelectedRisk] = useState<RiskItem | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);

    const getRisksInCell = (impacto: number, probabilidad: number) => {
        return data.riesgos.filter(r => {
            const rProb = parseMetricValue(r.posicionMatriz?.y) || parseMetricValue(r.probabilidad);
            const rImp = parseMetricValue(r.posicionMatriz?.x) || parseMetricValue(r.consecuencia);
            return rImp === impacto && rProb === probabilidad;
        });
    };

    const getCellLevel = (impacto: number, probabilidad: number): string => {
        return MATRIX_LEVELS[probabilidad - 1]?.[impacto - 1] || 'Medio';
    };

    const getCellColor = (level: string): string => {
        // Normalize checking
        const norm = normalizeRiskLevel(level);
        return NIVEL_COLORS[norm] || '#666';
    };

    // Calculate stats dynamic based on MATRIX COORDINATES to ensure consistency with visual map
    // We ignore the text label 'nivelRiesgo' for stats counting, relying on PxI instead.
    const calculatedStats = {
        total: data.riesgos.length,
        criticos: 0,
        altos: 0,
        medios: 0,
        bajos: 0
    };

    data.riesgos.forEach(r => {
        const p = parseMetricValue(r.posicionMatriz?.y) || parseMetricValue(r.probabilidad);
        const i = parseMetricValue(r.posicionMatriz?.x) || parseMetricValue(r.consecuencia);

        // Default to 'Medio' if coords are missing, but usually they exist if dots are shown
        const level = (p > 0 && i > 0) ? (MATRIX_LEVELS[p - 1]?.[i - 1] || 'Medio') : 'Medio';

        const norm = normalizeRiskLevel(level); // 'Crítico', 'Alto', 'Medio', 'Bajo'

        if (norm === 'Crítico') calculatedStats.criticos++;
        else if (norm === 'Alto') calculatedStats.altos++;
        else if (norm === 'Medio') calculatedStats.medios++;
        else calculatedStats.bajos++;
    });

    // FIX: Always use calculated stats to ensure consistency with the visual matrix
    const stats = calculatedStats;

    // Generar plan de mitigación basado en riesgos críticos y altos
    const generatedMitigationPlan = data.planMitigacion || data.riesgos
        .filter(r => {
            const level = normalizeRiskLevel(r.nivelRiesgo);
            return level === 'Crítico' || level === 'Alto';
        })
        .map((r, i) => ({
            prioridad: i + 1,
            riesgoId: r.id,
            accion: r.controlesAdicionales?.[0] || `Implementar controles para: ${r.peligro}`,
            responsable: r.responsable || 'Prevencionista',
            plazo: r.plazoImplementacion || (normalizeRiskLevel(r.nivelRiesgo) === 'Crítico' ? 'Inmediato' : '7 días')
        }));

    const handleExportPDF = () => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.width;

        // --- 1. Header ---
        doc.setFillColor(30, 58, 95); // #1e3a5f Dark Blue
        doc.rect(0, 0, pageWidth, 40, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('MATRIZ DE RIESGOS', 20, 20);

        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text(data.obra || data.titulo || 'Proyecto', 20, 30);

        doc.setFontSize(10);
        doc.text(`Fecha: ${data.fecha}`, pageWidth - 20, 20, { align: 'right' });
        if (data.actividad) {
            doc.text(`Actividad: ${data.actividad}`, pageWidth - 20, 30, { align: 'right' });
        }

        let currentY = 50;

        // --- 2. Stats Summary ---
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Resumen Ejecutivo', 20, currentY);
        currentY += 5;

        autoTable(doc, {
            startY: currentY,
            head: [['Total Riesgos', 'Críticos', 'Altos', 'Medios', 'Bajos']],
            body: [[
                stats.total,
                stats.criticos,
                stats.altos,
                stats.medios,
                stats.bajos
            ]],
            theme: 'grid',
            headStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: 'bold' },
            styles: { halign: 'center' }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;

        // --- 3. Visual Matrix (5x5) ---
        const matrixTopY = currentY;
        const matrixLeftX = 60;
        const cellSize = 12;

        doc.text('Mapa de Calor (5x5)', 20, matrixTopY + 5);

        // Axis Labels
        doc.setFontSize(8);
        doc.text('PROBABILIDAD', matrixLeftX - 25, matrixTopY + 35, { angle: 90 });
        doc.text('IMPACTO', matrixLeftX + 25, matrixTopY + 10 + (5 * cellSize) + 12);

        // Legend Data extraction (for side table)
        const legendData: any[] = [];

        // Draw 5x5 Grid (Rows: Prob 5(top) to 1(bottom), Cols: Impact 1(left) to 5(right))
        const probs = [5, 4, 3, 2, 1]; // Rows
        const impacts = [1, 2, 3, 4, 5]; // Cols

        probs.forEach((prob, rIndex) => {
            impacts.forEach((imp, cIndex) => {
                const x = matrixLeftX + (cIndex * cellSize);
                const y = matrixTopY + (rIndex * cellSize) + 10;

                // Determine Cell Color/Level
                const level = MATRIX_LEVELS[prob - 1]?.[imp - 1] || 'Medio';
                const colorHex = NIVEL_COLORS[level] || '#666';

                // Convert Hex to RGB for jsPDF
                const r = parseInt(colorHex.slice(1, 3), 16);
                const g = parseInt(colorHex.slice(3, 5), 16);
                const b = parseInt(colorHex.slice(5, 7), 16);

                doc.setFillColor(r, g, b);
                doc.rect(x, y, cellSize, cellSize, 'F');
                doc.setDrawColor(255, 255, 255);
                doc.rect(x, y, cellSize, cellSize, 'S');

                // Count risks in this cell - FIX: Use robust parsing
                const risksInCell = data.riesgos.filter(r => {
                    const rProb = parseMetricValue(r.posicionMatriz?.y) || parseMetricValue(r.probabilidad);
                    const rImp = parseMetricValue(r.posicionMatriz?.x) || parseMetricValue(r.consecuencia);
                    return rProb === prob && rImp === imp;
                });

                if (risksInCell.length > 0) {
                    // Draw count
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'bold');
                    doc.text(risksInCell.length.toString(), x + cellSize / 2, y + cellSize / 2 + 3, { align: 'center' });

                    // Add to Legend Data
                    legendData.push([
                        `P${prob}-I${imp}`, // Coord
                        level,
                        risksInCell.map(r => `• (R${r.id}) ${r.peligro}`).join('\n')
                    ]);
                }
            });

            // Row Labels (Prob)
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(7);
            doc.text(`${PROBABILITY_LABELS[prob - 1]} (${prob})`, matrixLeftX - 2, matrixTopY + (rIndex * cellSize) + 18, { align: 'right' });
        });

        // Col Labels (Impact)
        impacts.forEach((imp, cIndex) => {
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(7);
            doc.text(`${imp}`, matrixLeftX + (cIndex * cellSize) + 6, matrixTopY + 10 + (5 * cellSize) + 5, { align: 'center' });
        });

        // --- 4. Side Legend Table ---
        if (legendData.length > 0) {
            autoTable(doc, {
                startY: matrixTopY,
                margin: { left: matrixLeftX + (5 * cellSize) + 10 },
                head: [['Coord.', 'Nivel', 'Riesgos en Cuadrante']],
                body: legendData,
                theme: 'plain',
                styles: { fontSize: 6, cellPadding: 2, overflow: 'linebreak' },
                headStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: 'bold' },
                columnStyles: {
                    0: { cellWidth: 15, fontStyle: 'bold' },
                    1: { cellWidth: 15 },
                    2: { cellWidth: 60 }
                }
            });
        }

        const legendFinalY = (doc as any).lastAutoTable.finalY || (matrixTopY + 90); // Fallback if no legend
        const matrixFinalY = matrixTopY + 90;
        currentY = Math.max(legendFinalY, matrixFinalY) + 10;

        // --- 5. Validating Page Break for Details ---
        if (currentY > 250) { doc.addPage(); currentY = 20; }

        // --- 6. Detailed Table ---
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Inventario de Riesgos', 20, currentY);
        currentY += 5;

        const risksBody = data.riesgos.map(r => {
            const controls = [
                ...(r.controlesExistentes || []),
                ...(r.controlesAdicionales || [])
            ];
            const controlsText = controls.length > 0 ? controls.map(c => `• ${c}`).join('\n') : 'Sin controles definidos';

            return [
                `R${r.id}`,
                r.peligro,
                r.riesgo,
                `${r.probabilidad} x ${r.consecuencia} = ${r.nivelRiesgo}`,
                controlsText,
                r.responsable || 'N/A'
            ];
        });

        autoTable(doc, {
            startY: currentY,
            head: [['ID', 'Peligro', 'Riesgo', 'Evaluación', 'Controles', 'Resp.']],
            body: risksBody,
            styles: { fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [30, 58, 95] },
            columnStyles: {
                0: { cellWidth: 10, fontStyle: 'bold' },
                1: { cellWidth: 35 },
                2: { cellWidth: 40 },
                3: { cellWidth: 20 },
                4: { cellWidth: 'auto' },
                5: { cellWidth: 20 }
            }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;

        // --- 7. Mitigation Plan ---
        if (generatedMitigationPlan.length > 0) {
            if (currentY > 250) { doc.addPage(); currentY = 20; }
            doc.text('Plan de Mitigación', 20, currentY);
            currentY += 5;

            const planBody = generatedMitigationPlan.map(p => [
                p.prioridad,
                p.accion,
                p.plazo,
                p.responsable
            ]);

            autoTable(doc, {
                startY: currentY,
                head: [['Prio.', 'Acción Requerida', 'Plazo', 'Responsable']],
                body: planBody,
                theme: 'striped',
                headStyles: { fillColor: [234, 88, 12] }, // Orange
            });
        }

        doc.save(`Riesgos_${(data.titulo || 'Proyecto').replace(/\s+/g, '_')}_${data.fecha}.pdf`);
        onExport?.();
    };

    return (
        <div className="risk-matrix-container" style={{
            background: 'var(--surface-elevated)',
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
        }}>
            {/* Header con gradiente */}
            <div style={{
                background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)',
                padding: 'var(--space-6)',
                color: 'white'
            }}>
                <div className="flex justify-between items-start">
                    <div>
                        <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'rgba(255,255,255,0.15)',
                            padding: '4px 12px',
                            borderRadius: '20px',
                            fontSize: 'var(--text-xs)',
                            marginBottom: '8px'
                        }}>
                            <FiTarget size={14} />
                            MATRIZ DE RIESGOS
                        </div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '4px' }}>
                            {data.obra || data.titulo || 'Evaluación de Riesgos'}
                        </h2>
                        <p style={{ opacity: 0.8, fontSize: 'var(--text-sm)' }}>
                            {data.actividad && `Actividad: ${data.actividad} • `}
                            Generado el {data.fecha}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="btn btn-sm"
                            onClick={handleExportPDF}
                            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white' }}
                        >
                            <FiDownload /> Exportar PDF
                        </button>
                        {onApprove && (
                            <button
                                className="btn btn-sm"
                                onClick={() => onApprove(data)}
                                style={{ background: 'white', color: '#1e3a5f' }}
                            >
                                <FiCheck /> Aprobar
                            </button>
                        )}
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <div style={{ background: 'rgba(255,255,255,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats.total}</div>
                        <div style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>Total Riesgos</div>
                    </div>
                    {[
                        { label: 'Críticos', count: stats.criticos, color: NIVEL_COLORS['Crítico'] },
                        { label: 'Altos', count: stats.altos, color: NIVEL_COLORS['Alto'] },
                        { label: 'Medios', count: stats.medios, color: NIVEL_COLORS['Medio'] },
                        { label: 'Bajos', count: stats.bajos, color: NIVEL_COLORS['Bajo'] }
                    ].map(item => (
                        <div key={item.label} style={{
                            background: item.color,
                            padding: 'var(--space-3)',
                            borderRadius: 'var(--radius-lg)',
                            textAlign: 'center'
                        }}>
                            <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{item.count}</div>
                            <div style={{ fontSize: 'var(--text-xs)', opacity: 0.9 }}>{item.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Matrix Section */}
            <div style={{ padding: 'var(--space-6)' }}>
                <h3 style={{
                    fontSize: 'var(--text-lg)',
                    fontWeight: 700,
                    marginBottom: 'var(--space-4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span style={{
                        background: 'var(--primary-500)',
                        color: 'white',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--text-sm)'
                    }}>1</span>
                    Matriz Probabilidad vs Impacto
                </h3>

                {/* Visual 5x5 Matrix */}
                <div style={{
                    display: 'flex',
                    gap: 'var(--space-4)',
                    background: 'var(--surface-overlay)',
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-lg)'
                }}>
                    {/* Y-axis label */}
                    <div style={{
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        transform: 'rotate(180deg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        color: 'var(--primary-600)',
                        fontSize: 'var(--text-sm)',
                        letterSpacing: '1px'
                    }}>
                        PROBABILIDAD →
                    </div>

                    <div style={{ flex: 1 }}>
                        {/* Matrix Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '100px repeat(5, 1fr)', gap: '3px' }}>
                            {/* Empty corner */}
                            <div></div>
                            {/* X-axis labels (Impact) */}
                            {IMPACT_LABELS.map((label, i) => (
                                <div key={i} style={{
                                    textAlign: 'center',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary)',
                                    padding: '8px 4px'
                                }}>
                                    {label}
                                    <div style={{ fontSize: '9px', opacity: 0.7 }}>({i + 1})</div>
                                </div>
                            ))}

                            {/* Matrix rows - from top (high probability) to bottom (low) */}
                            {[...PROBABILITY_LABELS].reverse().map((probLabel, rowIdx) => {
                                const probValue = 5 - rowIdx;
                                return (
                                    <React.Fragment key={rowIdx}>
                                        {/* Y-axis label for this row */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'flex-end',
                                            paddingRight: '8px',
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            color: 'var(--text-secondary)'
                                        }}>
                                            <div style={{ textAlign: 'right' }}>
                                                {probLabel}
                                                <div style={{ fontSize: '9px', opacity: 0.7 }}>({probValue})</div>
                                            </div>
                                        </div>

                                        {/* Cells for this row */}
                                        {[1, 2, 3, 4, 5].map(impValue => {
                                            const risksHere = getRisksInCell(impValue, probValue);
                                            const cellLevel = getCellLevel(impValue, probValue);
                                            const cellColor = getCellColor(cellLevel);
                                            const isHovered = hoveredCell?.x === impValue && hoveredCell?.y === probValue;

                                            return (
                                                <div
                                                    key={impValue}
                                                    style={{
                                                        background: cellColor,
                                                        aspectRatio: '1',
                                                        borderRadius: '8px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        cursor: risksHere.length > 0 ? 'pointer' : 'default',
                                                        transition: 'all 0.2s',
                                                        transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                                                        boxShadow: isHovered ? '0 8px 20px rgba(0,0,0,0.3)' : 'none',
                                                        position: 'relative',
                                                        zIndex: isHovered ? 10 : 1,
                                                        minHeight: '60px'
                                                    }}
                                                    onMouseEnter={() => setHoveredCell({ x: impValue, y: probValue })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                    onClick={() => risksHere.length > 0 && setSelectedRisk(risksHere[0])}
                                                >
                                                    {risksHere.length > 0 ? (
                                                        <>
                                                            <div style={{
                                                                background: 'white',
                                                                borderRadius: '50%',
                                                                width: '32px',
                                                                height: '32px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontWeight: 800,
                                                                fontSize: 'var(--text-base)',
                                                                color: cellColor,
                                                                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                                                            }}>
                                                                {risksHere.length}
                                                            </div>
                                                            <div style={{
                                                                fontSize: '8px',
                                                                color: 'white',
                                                                marginTop: '4px',
                                                                textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                                                            }}>
                                                                {risksHere.map(r => `R${r.id}`).join(', ')}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div style={{
                                                            fontSize: '9px',
                                                            color: 'rgba(255,255,255,0.6)',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {cellLevel}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        {/* X-axis label */}
                        <div style={{
                            textAlign: 'center',
                            marginTop: 'var(--space-3)',
                            fontWeight: 700,
                            color: 'var(--primary-600)',
                            fontSize: 'var(--text-sm)',
                            letterSpacing: '1px'
                        }}>
                            ← IMPACTO / CONSECUENCIA →
                        </div>
                    </div>

                    {/* Legend */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: 'var(--space-2)',
                        minWidth: '100px'
                    }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                            LEYENDA
                        </div>
                        {[
                            { level: 'Crítico', color: NIVEL_COLORS['Crítico'], desc: 'Acción inmediata' },
                            { level: 'Alto', color: NIVEL_COLORS['Alto'], desc: 'Prioridad alta' },
                            { level: 'Medio', color: NIVEL_COLORS['Medio'], desc: 'Acción planificada' },
                            { level: 'Bajo', color: NIVEL_COLORS['Bajo'], desc: 'Monitorear' }
                        ].map(item => (
                            <div key={item.level} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '4px',
                                    background: item.color
                                }}></div>
                                <div>
                                    <div style={{ fontSize: '11px', fontWeight: 600 }}>{item.level}</div>
                                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{item.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Risk List */}
            <div style={{ padding: '0 var(--space-6) var(--space-6)' }}>
                <h3 style={{
                    fontSize: 'var(--text-lg)',
                    fontWeight: 700,
                    marginBottom: 'var(--space-4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span style={{
                        background: 'var(--primary-500)',
                        color: 'white',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--text-sm)'
                    }}>2</span>
                    Detalle de Riesgos Identificados
                </h3>

                <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))' }}>
                    {data.riesgos.map((risk) => (
                        <div
                            key={risk.id}
                            style={{
                                background: 'var(--surface-overlay)',
                                borderRadius: 'var(--radius-lg)',
                                padding: 'var(--space-4)',
                                borderLeft: `5px solid ${risk.colorRiesgo || NIVEL_COLORS[risk.nivelRiesgo] || '#666'}`,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onClick={() => setSelectedRisk(risk)}
                        >
                            <div className="flex justify-between items-start">
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '8px' }}>
                                        <span style={{
                                            background: 'var(--surface-elevated)',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            fontSize: 'var(--text-xs)',
                                            fontWeight: 700,
                                            color: risk.colorRiesgo || NIVEL_COLORS[risk.nivelRiesgo]
                                        }}>
                                            R{risk.id}
                                        </span>
                                        <span style={{
                                            background: risk.colorRiesgo || NIVEL_COLORS[risk.nivelRiesgo],
                                            color: 'white',
                                            padding: '2px 10px',
                                            borderRadius: '12px',
                                            fontSize: 'var(--text-xs)',
                                            fontWeight: 600
                                        }}>
                                            {risk.nivelRiesgo}
                                        </span>
                                    </div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{risk.peligro}</div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{risk.riesgo}</div>
                                </div>
                                <div style={{
                                    background: 'var(--surface-elevated)',
                                    padding: '8px 12px',
                                    borderRadius: 'var(--radius-md)',
                                    textAlign: 'center',
                                    minWidth: '60px'
                                }}>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>P×I</div>
                                    <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                                        {risk.probabilidad}×{risk.consecuencia}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Plan de Mitigación */}
            <div style={{
                padding: 'var(--space-6)',
                background: 'linear-gradient(180deg, var(--surface-overlay) 0%, var(--surface-elevated) 100%)',
                borderTop: '1px solid var(--surface-border)'
            }}>
                <h3 style={{
                    fontSize: 'var(--text-lg)',
                    fontWeight: 700,
                    marginBottom: 'var(--space-4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span style={{
                        background: 'var(--success-500)',
                        color: 'white',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--text-sm)'
                    }}>3</span>
                    <FiShield style={{ marginRight: '4px' }} />
                    Plan de Mitigación Recomendado
                </h3>

                {generatedMitigationPlan.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        {generatedMitigationPlan.slice(0, 5).map((action, i) => {
                            const relatedRisk = data.riesgos.find(r => r.id === action.riesgoId);
                            return (
                                <div key={i} style={{
                                    background: 'var(--surface-elevated)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--space-4)',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 'var(--space-3)'
                                }}>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        background: action.prioridad <= 2 ? NIVEL_COLORS['Crítico'] : action.prioridad <= 4 ? NIVEL_COLORS['Alto'] : NIVEL_COLORS['Medio'],
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'white',
                                        fontWeight: 700,
                                        flexShrink: 0
                                    }}>
                                        {action.prioridad}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{action.accion}</div>
                                        {relatedRisk && (
                                            <div style={{
                                                fontSize: 'var(--text-xs)',
                                                color: 'var(--text-muted)',
                                                marginBottom: '8px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                <span style={{
                                                    background: relatedRisk.colorRiesgo || NIVEL_COLORS[relatedRisk.nivelRiesgo],
                                                    color: 'white',
                                                    padding: '1px 6px',
                                                    borderRadius: '4px',
                                                    fontSize: '10px'
                                                }}>R{relatedRisk.id}</span>
                                                {relatedRisk.peligro}
                                            </div>
                                        )}
                                        <div className="flex gap-4" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                                            <span>📅 {action.plazo}</span>
                                            <span>👤 {action.responsable}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div style={{
                        textAlign: 'center',
                        padding: 'var(--space-6)',
                        color: 'var(--text-muted)',
                        background: 'var(--surface-overlay)',
                        borderRadius: 'var(--radius-lg)'
                    }}>
                        <FiInfo size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
                        <div>No se requieren acciones de mitigación urgentes</div>
                        <div style={{ fontSize: 'var(--text-sm)' }}>Todos los riesgos están en niveles aceptables</div>
                    </div>
                )}

                {/* Recommendations */}
                {data.recomendacionesPrioritarias && data.recomendacionesPrioritarias.length > 0 && (
                    <div style={{
                        marginTop: 'var(--space-4)',
                        background: 'var(--info-500)' + '15',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-4)',
                        border: '1px solid var(--info-500)'
                    }}>
                        <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--info-600)', marginBottom: 'var(--space-2)' }}>
                            💡 Recomendaciones Adicionales
                        </h4>
                        <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                            {data.recomendacionesPrioritarias.map((rec, i) => (
                                <li key={i} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>{rec}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Footer with Export */}
            <div style={{
                padding: 'var(--space-4) var(--space-6)',
                background: 'var(--surface-overlay)',
                borderTop: '1px solid var(--surface-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                    {data._fallback && '⚠️ Generado en modo offline • '}
                    Documento generado por IA - Requiere validación del prevencionista
                </div>
                <button
                    className="btn btn-primary"
                    onClick={handleExportPDF}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <FiDownload />
                    Exportar como PDF
                </button>
            </div>

            {/* Risk Detail Modal */}
            {selectedRisk && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        backdropFilter: 'blur(4px)'
                    }}
                    onClick={() => setSelectedRisk(null)}
                >
                    <div
                        style={{
                            background: 'var(--surface-elevated)',
                            borderRadius: 'var(--radius-xl)',
                            padding: 'var(--space-6)',
                            maxWidth: '600px',
                            width: '90%',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{
                                        background: 'var(--surface-overlay)',
                                        padding: '4px 12px',
                                        borderRadius: '6px',
                                        fontWeight: 700,
                                        color: selectedRisk.colorRiesgo || NIVEL_COLORS[selectedRisk.nivelRiesgo]
                                    }}>
                                        R{selectedRisk.id}
                                    </span>
                                    <span style={{
                                        background: selectedRisk.colorRiesgo || NIVEL_COLORS[selectedRisk.nivelRiesgo],
                                        color: 'white',
                                        padding: '4px 12px',
                                        borderRadius: '20px',
                                        fontWeight: 600
                                    }}>
                                        {selectedRisk.nivelRiesgo}
                                    </span>
                                </div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedRisk.peligro}</h3>
                            </div>
                            <button onClick={() => setSelectedRisk(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                <FiX size={24} />
                            </button>
                        </div>

                        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>{selectedRisk.riesgo}</p>

                        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Probabilidad</div>
                                <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{selectedRisk.probabilidad}/5</div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                                    {PROBABILITY_LABELS[selectedRisk.probabilidad - 1]}
                                </div>
                            </div>
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Impacto</div>
                                <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{selectedRisk.consecuencia}/5</div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                                    {IMPACT_LABELS[selectedRisk.consecuencia - 1]}
                                </div>
                            </div>
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Responsable</div>
                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{selectedRisk.responsable || 'Por asignar'}</div>
                            </div>
                        </div>

                        {selectedRisk.controlesExistentes && selectedRisk.controlesExistentes.length > 0 && (
                            <div style={{ marginBottom: 'var(--space-4)' }}>
                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <FiCheck color="var(--success-500)" /> Controles Existentes
                                </div>
                                <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                                    {selectedRisk.controlesExistentes.map((c, i) => (
                                        <li key={i} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{c}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {selectedRisk.controlesAdicionales && selectedRisk.controlesAdicionales.length > 0 && (
                            <div style={{ marginBottom: 'var(--space-4)' }}>
                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <FiAlertTriangle color="var(--warning-500)" /> Controles Adicionales Requeridos
                                </div>
                                <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                                    {selectedRisk.controlesAdicionales.map((c, i) => (
                                        <li key={i} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{c}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex gap-3 mt-6">
                            <button className="btn btn-secondary flex-1" onClick={() => setSelectedRisk(null)}>
                                Cerrar
                            </button>
                            <button className="btn btn-primary flex-1">
                                <FiCheck /> Marcar como Controlado
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
