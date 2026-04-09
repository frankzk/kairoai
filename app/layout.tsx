import type { Metadata } from "next";
import "./globals.css";

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
      <body style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
