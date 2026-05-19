import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: ["polls.dezhidki-hermes.party"],
  },
  build: {
    copyPublicDir: true,
    outDir: "./dist",
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "vote.html") return "vote.html";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
