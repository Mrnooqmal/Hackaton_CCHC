import { useEffect, useState } from 'react';
import { getHello } from './api/hola';

function App() {
  const [mensaje, setMensaje] = useState("Cargando...");

  useEffect(() => {
    getHello()
      .then(data => setMensaje(data.mensaje))
      .catch(err => setMensaje("error: " + err.message));
  }, []);

  return (
    <div>
      <h1>Mi Hackaton App</h1>
      <p>Respuesta del backend: {mensaje}</p>
    </div>
  );
}

export default App;