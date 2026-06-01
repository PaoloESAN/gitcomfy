import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [tailwindcss() as any, svelte() as any],
    resolve: {
      alias: {
        $lib: path.resolve(__dirname, 'src/renderer/src/lib'),
      }
    }
  }
})
