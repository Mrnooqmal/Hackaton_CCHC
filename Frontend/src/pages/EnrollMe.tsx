export default function EnrollMe() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-surface-base">
            <div className="card max-w-md w-full text-center">
                <div className="text-primary-500 text-5xl mb-4">✍️</div>
                <h2 className="text-xl font-bold mb-2">Enrolamiento Pendiente</h2>
                <p className="text-muted mb-6">Para habilitar su cuenta, debe realizar su firma de enrolamiento. Esto vinculará su identidad digital a este sistema.</p>
                {/* Aquí iría el flujo de firma inicial */}
                <p className="italic text-sm">[Próximamente: Interfaz de firma de enrolamiento de usuario]</p>
                <button
                    className="btn btn-primary mt-6 w-full"
                    onClick={() => window.location.href = '/'}
                >
                    Volver al Inicio (Demo)
                </button>
            </div>
        </div>
    );
}
