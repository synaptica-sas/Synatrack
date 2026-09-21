import { defineConfig } from "vitest/config";

// Las pruebas viven únicamente en `src/`. Acotar el `include` evita que vitest
// recolecte también las copias compiladas en `dist/` tras un `npm run build`
// (lo que duplicaba el conteo de pruebas: 306 en vez de 153).
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
