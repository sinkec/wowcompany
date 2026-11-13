import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Tauri pričakuje fiksna vrata in ne sme brisati izpisa Rust prevajalnika.
export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	clearScreen: false,
	server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
	envPrefix: ['VITE_', 'TAURI_ENV_*'],
	build: { target: 'es2022', outDir: 'dist', emptyOutDir: true }
});
