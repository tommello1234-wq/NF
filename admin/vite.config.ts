import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Output direto pra raiz do repo (../dist) pra Vercel achar como
    // outputDirectory: "dist" — necessário porque a CLI antiga do Vercel
    // ignora outputDirectory: "admin/dist" e procura sempre "dist" na raiz.
    outDir: path.resolve(__dirname, '..', 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
})
