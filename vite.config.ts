import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    crx({
      manifest: {
        manifest_version: 3,
        name: 'Pageside',
        version: '1.0.0',
        description: 'Draft tailored answers for application form questions using your personal vault',
        permissions: ['storage', 'activeTab', 'tabs', 'clipboardWrite', 'sidePanel', 'scripting', 'webNavigation', 'unlimitedStorage'],
        host_permissions: [
          'https://api.anthropic.com/*',
          'https://openrouter.ai/*',
          'https://api.openai.com/*',
          'https://api.x.ai/*',
          'https://api.groq.com/*',
        ],
        icons: {
          16: 'icons/icon16.png',
          32: 'icons/icon32.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png',
        },
        optional_host_permissions: ['<all_urls>'],
        web_accessible_resources: [{
          resources: ['assets/*'],
          matches: ['<all_urls>'],
        }],
        options_ui: {
          page: 'src/options/index.html',
          open_in_tab: true,
        },
        side_panel: {
          default_path: 'src/sidepanel/index.html',
        },
        commands: {
          'scan-page': {
            suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
            description: 'Scan page for form questions',
          },
          'answer-focused': {
            suggested_key: { default: 'Alt+Shift+A', mac: 'Alt+Shift+A' },
            description: 'Answer the focused question field',
          },
          'insert-last': {
            suggested_key: { default: 'Alt+Shift+I', mac: 'Alt+Shift+I' },
            description: 'Insert the last draft into its field',
          },
          'toggle-panel': {
            suggested_key: { default: 'Alt+Shift+O', mac: 'Alt+Shift+O' },
            description: 'Open the side panel',
          },
        },
        background: {
          service_worker: 'src/background/index.ts',
          type: 'module',
        },
        content_scripts: [{
          matches: ['https://pageside.invalid/*'],
          all_frames: true,
          match_about_blank: true,
          js: ['src/content/index.ts'],
          run_at: 'document_end',
        }],
        action: {
          default_title: 'Pageside',
          default_icon: {
            16: 'icons/icon16.png',
            32: 'icons/icon32.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png',
          },
        },
      },
    }),
  ],
});