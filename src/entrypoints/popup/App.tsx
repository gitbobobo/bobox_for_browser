import { useId, type ComponentType } from 'react';
import { browser } from 'wxt/browser';
import { Switch } from '../../components/switch';
import { useStorageItem } from '../../hooks/use-storage-item';
import { tools, type ToolDefinition, type ToolId } from '../../tools/registry';

function XAutoplayIcon({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" className={className}>
      <defs>
        <mask id={id}>
          <rect width="24" height="24" fill="#fff" />
          <path d="M4 20 20 4" stroke="#000" strokeWidth="5" strokeLinecap="round" />
        </mask>
      </defs>
      <path
        d="M7.5 6.3v11.4a1 1 0 0 0 1.53.85l9.1-5.7a1 1 0 0 0 0-1.7l-9.1-5.7A1 1 0 0 0 7.5 6.3z"
        fill="currentColor"
        mask={`url(#${id})`}
      />
      <path d="M4 20 20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ImagePreviewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <path d="m4 17 5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function VideoFloatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <rect x="12.5" y="12.5" width="6" height="4.5" rx="1" fill="currentColor" />
    </svg>
  );
}

const toolIcons: Record<ToolId, ComponentType<{ className?: string }>> = {
  'x-autoplay': XAutoplayIcon,
  'github-pr-image-preview': ImagePreviewIcon,
  'video-float': VideoFloatIcon,
};

function ToolCard({ tool }: { tool: ToolDefinition }) {
  const [enabled, setEnabled] = useStorageItem(tool.enabled);
  const on = enabled === true;
  const Icon = toolIcons[tool.id];
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-bb-border bg-bb-surface p-3.5">
      <span
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] ${
          on ? 'bg-bb-brand-soft text-bb-brand-strong' : 'bg-bb-border text-bb-muted'
        }`}
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-snug">{tool.name}</div>
        <div className="mt-0.5 text-[12.5px] leading-[1.5] text-bb-muted">{tool.description}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tool.sites.map((site) => (
            <span
              key={site}
              className="font-mono-bb rounded-full border border-bb-border px-1.5 py-px text-[11px] leading-4 text-bb-muted"
            >
              {site}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-0.5 flex-none">
        <Switch
          checked={on}
          disabled={enabled === undefined}
          label={tool.name}
          onChange={setEnabled}
        />
      </div>
    </div>
  );
}

export default function App() {
  const version = browser.runtime.getManifest().version;
  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-2.5 p-4">
        <img src="/icon/128.png" alt="" className="h-7 w-7 rounded-lg" />
        <div className="flex-1 leading-tight">
          <div className="text-[15px] font-semibold">Bobox</div>
          <div className="text-[12px] text-bb-muted">浏览器工具箱</div>
        </div>
        <span className="font-mono-bb text-[11px] text-bb-muted">v{version}</span>
      </header>
      <main className="flex flex-col gap-2.5 px-4 pb-4">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </main>
    </div>
  );
}
