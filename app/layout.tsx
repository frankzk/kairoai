import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import SessionGuard from "@/components/SessionGuard";
import CronHealthBanner from "@/components/CronHealthBanner";
import MenuLateral from "@/components/MenuLateral";

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
    <html lang="es" className="dark">
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
