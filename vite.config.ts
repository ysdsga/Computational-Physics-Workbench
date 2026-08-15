import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: './',
  server: {
    proxy: {
      '/api': process.env.WORKBENCH_PROXY_URL ?? 'http://127.0.0.1:3001',
    },
  },
})
