"use client";

import { useEffect, useState } from "react";
import ZadarmaPhone from "@/components/ZadarmaPhone";
import TelnyxPhone from "@/components/TelnyxPhone";
import { useSelectedStore } from "@/lib/use-selected-store";
import { configTelefoniaCliente, onUsarProveedor, type ProveedorTelefonia } from "@/lib/telefonia-cliente";

// El telefono web de la pagina: el proveedor principal de la tienda elegida
// (Configuracion › Telefonia). Solo se monta uno: con los dos, la asesora
// quedaria registrada en dos centralitas a la vez. Si el boton "Llamar" pide
// el de respaldo (el principal no conecto), se cambia hasta recargar la pagina
// o cambiar de tienda.
export default function TelefonoWeb() {
  const [store] = useSelectedStore();
  const [proveedor, setProveedor] = useState<ProveedorTelefonia | null>(null);
  useEffect(() => {
    let vivo = true;
    setProveedor(null);
    void configTelefoniaCliente(store).then((c) => vivo && setProveedor(c.principal));
    return () => {
      vivo = false;
    };
  }, [store]);
  useEffect(() => onUsarProveedor(setProveedor), []);
  if (proveedor === "telnyx") return <TelnyxPhone />;
  // key: al cambiar de tienda, teléfono nuevo con la extensión de esa tienda.
  if (proveedor === "zadarma") return <ZadarmaPhone key={store} store={store} />;
  return null;
}
