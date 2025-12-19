import { useRef, useEffect, useState } from 'react';
import { FiCheck, FiRefreshCw } from 'react-icons/fi';

interface SignaturePadProps {
    onSign: (signatureData: string) => void;
    workerName?: string;
    workerRut?: string;
    disabled?: boolean;
}

export default function SignaturePad({ onSign, workerName, workerRut, disabled }: SignaturePadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);
    const [isSigned, setIsSigned] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = 150;

        // Set drawing style
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }, []);

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();

        if ('touches' in e) {
            return {
                x: e.touches[0].clientX - rect.left,
                y: e.touches[0].clientY - rect.top
            };
        }

        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (disabled || isSigned) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        const { x, y } = getCoordinates(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
        setIsDrawing(true);
        setHasSignature(true);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || disabled || isSigned) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        const { x, y } = getCoordinates(e);
        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
    };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasSignature(false);
        setIsSigned(false);
    };

    const confirmSignature = () => {
        const canvas = canvasRef.current;
        if (!canvas || !hasSignature) return;

        const signatureData = canvas.toDataURL('image/png');
        setIsSigned(true);
        onSign(signatureData);
    };

    return (
        <div className="signature-container">
            {workerName && (
                <div className="signature-info mb-4">
                    <div className="flex items-center gap-3">
                        <div className="avatar">{workerName.charAt(0).toUpperCase()}</div>
                        <div>
                            <div className="font-bold">{workerName}</div>
                            {workerRut && <div className="text-sm text-muted">{workerRut}</div>}
                        </div>
                    </div>
                </div>
            )}

            <div className={`signature-pad ${isSigned ? 'signed' : ''}`}>
                {isSigned ? (
                    <div className="flex flex-col items-center gap-2" style={{ padding: '20px' }}>
                        <FiCheck size={48} style={{ color: 'var(--success-500)' }} />
                        <span style={{ color: 'var(--success-500)', fontWeight: 600 }}>Firma registrada</span>
                        <span className="text-sm text-muted">
                            {new Date().toLocaleString('es-CL')}
                        </span>
                    </div>
                ) : (
                    <canvas
                        ref={canvasRef}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                        style={{ touchAction: 'none' }}
                    />
                )}
            </div>

            {!isSigned && (
                <div className="flex gap-3 mt-4">
                    <button
                        className="btn btn-secondary"
                        onClick={clearSignature}
                        disabled={!hasSignature || disabled}
                    >
                        <FiRefreshCw />
                        Limpiar
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={confirmSignature}
                        disabled={!hasSignature || disabled}
                        style={{ flex: 1 }}
                    >
                        <FiCheck />
                        Confirmar Firma
                    </button>
                </div>
            )}
        </div>
    );
}
