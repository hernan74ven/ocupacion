import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    // This exposes the environment variable to the client-side code.
    // Vite automatically loads variables from .env files into process.env for local development,
    // and Vercel provides its environment variables in process.env during the build.
    'process.env.API_KEY': JSON.stringify(process.env.GEMINI_API_KEY)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});