import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Bobox',
    description: 'Bobox 浏览器工具箱。x.com 视频和 GIF 不再自动加载播放，点击才开始，节省流量。',
    permissions: ['storage'],
    // content_scripts world:"MAIN" requires Chrome 111+
    minimum_chrome_version: '111',
  },
});
