import type { WxtStorageItem } from 'wxt/utils/storage';
import { xAutoplayEnabled } from './x-autoplay/settings';
import { githubPrImagePreviewEnabled } from './github-pr-image-preview/settings';

export type ToolId = 'x-autoplay' | 'github-pr-image-preview';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  sites: readonly string[];
  enabled: WxtStorageItem<boolean, Record<string, never>>;
}

export const tools: readonly ToolDefinition[] = [
  {
    id: 'x-autoplay',
    name: 'X 视频不自动播放',
    description: '视频和 GIF 不再自动加载和播放，点一下才开始，省流量。',
    sites: ['x.com'],
    enabled: xAutoplayEnabled,
  },
  {
    id: 'github-pr-image-preview',
    name: 'GitHub PR 图片预览',
    description: '点击 PR 描述中的图片，在当前页面查看大图。',
    sites: ['github.com'],
    enabled: githubPrImagePreviewEnabled,
  },
];
