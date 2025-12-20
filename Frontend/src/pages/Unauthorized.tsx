export default function Unauthorized() {
    return (
        <div className="flex items-center justify-center h-screen bg-surface-base">
            <div className="card max-w-md w-full text-center">
                <div className="text-danger-500 text-5xl mb-4">🚫</div>
                <h2 className="text-xl font-bold mb-2">Acceso No Autorizado</h2>
                <p className="text-muted mb-6">No tiene los permisos suficientes para acceder a esta sección.</p>
                <button
                    className="btn btn-primary w-full"
                    onClick={() => window.location.href = '/'}
                >
                    Volver al Dashboard
                </button>
            </div>
        </div>
    );
}
