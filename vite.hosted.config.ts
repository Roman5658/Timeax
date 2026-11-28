import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({envDir:false,plugins:[react()],resolve:{alias:[{find:/^\.\.\/i18n$/,replacement:fileURLToPath(new URL("./src/hosted/hosted-i18n.ts",import.meta.url))}]},build:{outDir:"dist-hosted",rollupOptions:{input:"hosted.html"}}});
