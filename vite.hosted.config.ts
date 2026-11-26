import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({envDir:false,plugins:[react()],build:{outDir:"dist-hosted",rollupOptions:{input:"hosted.html"}}});
