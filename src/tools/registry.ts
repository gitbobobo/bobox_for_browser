import type { WxtStorageItem } from 'wxt/utils/storage';
import { xAutoplayEnabled } from './x-autoplay/settings';

export type ToolId = 'x-autoplay';

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
];
