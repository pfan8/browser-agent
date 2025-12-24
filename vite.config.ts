import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          // startup() will: 1) kill old Electron process, 2) start new one
          // This ensures only ONE Electron instance runs at a time
          args.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // External packages that should be loaded at runtime, not bundled
              external: [
                'electron',
                'playwright', 
                '@anthropic-ai/sdk',
                '@langchain/langgraph',
                '@langchain/anthropic',
                '@langchain/core',
                'zod',
                // Workspace packages - let node resolve them
                '@chat-agent/browser-adapter',
                '@chat-agent/agent-core'
              ]
            }
          },
          // Exclude directories that change at runtime from triggering rebuilds
          server: {
            watch: {
              ignored: ['**/logs/**', '**/recordings/**', '**/test-results/**', '**/node_modules/**']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          // Preload changes: just reload the renderer window
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          },
          server: {
            watch: {
              ignored: ['**/logs/**', '**/recordings/**', '**/test-results/**', '**/node_modules/**']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron'),
      '@dsl': path.resolve(__dirname, './dsl')
    }
  },
  build: {
    outDir: 'dist'
  },
  // Global watch ignore - prevent runtime-generated files from triggering rebuilds
  server: {
    watch: {
      ignored: [
        '**/logs/**', 
        '**/recordings/**', 
        '**/test-results/**', 
        '**/release/**',
        '**/dist/**',
        '**/dist-electron/**'
      ]
    }
  }
})

