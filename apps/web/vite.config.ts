import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// Tailnet names, for machines reaching the dev hub via `tailscale serve`.
		allowedHosts: ['.ts.net'],
		// `tailscale serve` also listens on :5173 (tailnet address only), so bind
		// loopback explicitly and never drift to another port.
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
		// In dev, Vite plays the role Caddy has in production: /api (HTTP and
		// WebSocket) goes to the API, so auth cookies stay on one origin.
		proxy: {
			'/api': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true, xfwd: true }
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			env: { dir: '../..' }
		})
	]
});
