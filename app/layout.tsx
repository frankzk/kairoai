import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import SessionGuard from "@/components/SessionGuard";
import CronHealthBanner from "@/components/CronHealthBanner";
import MenuLateral from "@/components/MenuLateral";
import { SCRIPT_TEMA } from "@/lib/tema";

export const metadata: Metadata = {
  title: "Kairo AI — Voice Agents para E-commerce COD",
  description:
    "Plataforma de agentes de voz IA para confirmar pedidos COD, recuperar carritos y hacer upsell en LATAM.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Claro por defecto; el script pone "dark" antes de pintar si la persona
    // eligió el tono oscuro (por eso la clase del <html> puede no coincidir).
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        <SessionGuard />
        <MenuLateral>
          <CronHealthBanner />
          {children}
        </MenuLateral>
      </body>
    </html>
  );
}
