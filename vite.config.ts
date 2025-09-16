import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    // This makes the environment variable available to the client-side code
    'process.env.API_KEY': JSON.stringify(process.env.GEMINI_API_KEY)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});