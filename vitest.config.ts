import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resuelve el alias "@/..." de tsconfig.json ("@/*": ["./*"]) para que los tests
// puedan importar el codigo real de lib/ que usa imports absolutos. Solo afecta a
// vitest; el build de Next resuelve los paths por su cuenta.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig usa "jsx": "preserve" (lo compila Next). Para que un test pueda
  // renderizar un componente .tsx en el servidor, vitest lo transforma aquí.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: path.join(root, "$1") }],
  },
});
