import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";
import pkg from "./package.json";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Every runtime dependency and peer stays an import in dist, so the consumer's
// bundler resolves one shared copy. Inlining three baked a second Three.js
// into dist, which a host app that also uses three then loads twice
// ("Multiple instances of Three.js").
const externalPackages = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];
const isExternal = (id: string) =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src"],
      outDir: "dist/types",
      rollupTypes: false,
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        react: resolve(__dirname, "src/react.ts"),
      },
      name: "MapLibreGL3DTiles",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "mjs" : "cjs";
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external: isExternal,
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "maplibre-gl": "maplibregl",
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css")
            return "maplibre-gl-3d-tiles.css";
          return assetInfo.name || "";
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
    minify: false,
  },
});
