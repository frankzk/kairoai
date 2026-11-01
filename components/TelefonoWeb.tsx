"use client";

import { useEffect, useState } from "react";
import ZadarmaWebphone from "@/components/ZadarmaWebphone";
import TelnyxPhone from "@/components/TelnyxPhone";
import { proveedorTelefoniaCliente, type ProveedorTelefonia } from "@/lib/telefonia-cliente";

// El telefono web de la pagina: Zadarma o Telnyx segun TELEFONIA en el
// servidor. Solo se monta uno: con los dos, la asesora quedaria registrada en
// dos centralitas a la vez.
export default function TelefonoWeb() {
  const [proveedor, setProveedor] = useState<ProveedorTelefonia | null>(null);
  useEffect(() => {
    let vivo = true;
    void proveedorTelefoniaCliente().then((p) => vivo && setProveedor(p));
    return () => {
      vivo = false;
    };
  }, []);
  if (proveedor === "telnyx") return <TelnyxPhone />;
  if (proveedor === "zadarma") return <ZadarmaWebphone />;
  return null;
}
