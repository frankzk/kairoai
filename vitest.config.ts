import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mapea el alias "@/..." (definido en tsconfig) para que vitest resuelva los
// imports de runtime hacia la raiz del proyecto, igual que Next/tsc.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: rootDir }],
  },
});
