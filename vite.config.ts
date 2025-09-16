import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Carga las variables de entorno del proceso actual (el entorno de Vercel)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      // Expone la clave de API al código del lado del cliente de forma segura
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});