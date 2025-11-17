import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
    plugins: [
        wasm(),
        vue(),
        tailwindcss(),
        Icons({
            compiler: 'vue3',
            autoInstall: false,
        }),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    build: {
        target: 'esnext',
    },
    worker: {
        format: 'es',
        plugins: () => [wasm()],
    },
})
