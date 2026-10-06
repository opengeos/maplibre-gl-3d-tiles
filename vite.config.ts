import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";
import pkg from "./package.json";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The ES build keeps every runtime dependency and peer as an import, so the
// consumer's bundler resolves one shared copy. Inlining three baked a second
// Three.js into dist, which a host app that also uses three then loads twice
// ("Multiple instances of Three.js").
const externalPackages = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];
const isExternal = (id: string) =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

// The CommonJS build (`vite build --mode cjs`) stays self-contained as before:
// 3d-tiles-renderer and three's examples/jsm modules are ESM-only, so leaving
// them as require() calls would break the `require` entry at load time.
const CJS_EXTERNAL = ["react", "react-dom", "maplibre-gl"];

export default defineConfig(({ mode }) => {
  const cjs = mode === "cjs";
  return {
    plugins: [
      react(),
      ...(cjs
        ? []
        : [
            dts({
              include: ["src"],
              outDir: "dist/types",
              rollupTypes: false,
            }),
          ]),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    build: {
      // The ES build runs first and owns the clean; the CJS build adds to dist.
      emptyOutDir: !cjs,
      lib: {
        entry: {
          index: resolve(__dirname, "src/index.ts"),
          react: resolve(__dirname, "src/react.ts"),
        },
        name: "MapLibreGL3DTiles",
        formats: [cjs ? "cjs" : "es"],
        fileName: (format, entryName) => {
          const ext = format === "es" ? "mjs" : "cjs";
          return `${entryName}.${ext}`;
        },
      },
      rollupOptions: {
        external: cjs ? CJS_EXTERNAL : isExternal,
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
  };
});
