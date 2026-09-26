import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue(), vueDevTools()],
  build: {
    emptyOutDir: false,
  },
  //正式版与测试版发布在不同路径下(见 .github/workflows/deploy.yml 与 docs/面向开发者/开发规范.md §三)
  //测试版是正式版站点的子目录,base必须与子目录完全一致(少写一级资源就会全404、页面白屏)
  base: mode == 'beta' ? '/transfinite-layers/beta/' : '/transfinite-layers/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
