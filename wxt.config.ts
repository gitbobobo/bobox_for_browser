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
    description:
      'Bobox 浏览器工具箱。X 视频和 GIF 点击才加载，GitHub PR 图片在当前页面预览，视频悬浮窗小窗置顶播放。',
    permissions: ['storage'],
    // content_scripts world:"MAIN" requires Chrome 111+
    minimum_chrome_version: '111',
  },
});
