import { PanelResumen } from "@/components/panel/PanelResumen";

// Panel (inicio): resumen de la tienda elegida en el menú lateral. El tablero
// del agente de voz que vivía aquí ya no se usa; /api/dashboard y sus
// componentes siguen en el repo para quien los importe.
export default function PanelPage() {
  return <PanelResumen />;
}
