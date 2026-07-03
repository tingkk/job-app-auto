import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated'(_wxt, manifest) {
      if (Array.isArray(manifest.content_scripts) && !manifest.content_scripts.length) {
        delete manifest.content_scripts;
      }
    }
  },
  vite: () => ({
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }),
  manifest: {
    name: 'Job Application Autofill',
    description:
      'Local-first autofill for job application forms using your profile, CV, and optional AI provider.',
    version: '0.1.2',
    permissions: ['storage', 'scripting', 'unlimitedStorage', 'activeTab'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    minimum_chrome_version: '114',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png'
    },
    action: {
      default_title: 'Job Application Autofill',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png'
      }
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true
    }
  }
});
