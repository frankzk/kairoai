import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Espeja el path alias de tsconfig ("@/*" -> "./*") para que los tests puedan
// importar módulos que usan imports "@/..." (p. ej. lib/finance-orders.ts).
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
});
