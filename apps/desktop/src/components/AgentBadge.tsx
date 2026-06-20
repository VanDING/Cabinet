import { Card, Tag } from '@cabinet/ui';
import { getAgentIcon } from './AgentIconSprite.js';

interface AgentBadgeProps {
  name: string;
  model?: string;
  kind: 'ai' | 'human';
  source?: string;
  status: 'active' | 'idle' | 'offline';
  expertise: string[];
  permissionLevel: string;
  onConfigure?: () => void;
  onTest?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
}

const statusConfig: Record<string, { dot: string; label: string }> = {
  active: { dot: 'bg-intent-success', label: 'active' },
  idle: { dot: 'bg-intent-warning', label: 'idle' },
  offline: { dot: 'bg-content-tertiary', label: 'offline' },
};

const sourceLabels: Record<string, string> = {
  builtin: '内置',
  custom: '自定义',
  external_cli: 'CLI',
  external_a2a: 'A2A',
};

export function AgentBadge({
  name,
  model,
  kind,
  source,
  status,
  expertise,
  permissionLevel,
  onConfigure,
  onTest,
  onDelete,
  onClick,
}: AgentBadgeProps) {
  const matched = getAgentIcon(name, model);

  const tags = expertise.slice(0, 3);
  const extra = expertise.length - 3;

  const avatarEl = matched ? (
    <div className="relative h-[110px] w-[110px] shrink-0">
      <div
        className="absolute top-0 left-0 z-[1] h-[84px] w-[84px] overflow-hidden rounded-full"
        style={{
          background: matched.gradient,
          boxShadow: '0 0 0 2px var(--border-color), 0 4px 14px rgba(0,0,0,0.2)',
        }}
      >
        <img src={matched.dataUri} alt="" width={84} height={84} className="block" />
      </div>
      {matched.watermarkSvg && (
        <div
          className="absolute right-[-12px] bottom-[-12px] z-0 flex h-[64px] w-[64px] items-center justify-center rounded-full"
          style={{
            border: `2px solid ${matched.brandColor}`,
            background: 'var(--surface-elevated)',
            color: matched.brandColor,
          }}
          dangerouslySetInnerHTML={{ __html: matched.watermarkSvg }}
        />
      )}
    </div>
  ) : (
    <div
      className="bg-surface-muted flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-full text-2xl font-semibold"
      style={{ boxShadow: '0 0 0 2px var(--border-color), 0 4px 14px rgba(0,0,0,0.2)' }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );

  const wmStyle = matched
    ? {
        maskImage: `url(${matched.watermark})`,
        WebkitMaskImage: `url(${matched.watermark})`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center 28%',
        WebkitMaskPosition: 'center 28%',
        maskSize: '68%',
        WebkitMaskSize: '68%',
      }
    : undefined;

  return (
    <div className="cursor-pointer" onClick={onClick}>
      <Card padding="none" hoverable>
        <div className="relative">
          {wmStyle && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ ...wmStyle, background: 'var(--content-primary)', opacity: 0.045 }}
            />
          )}
          <div className="flex items-center gap-6 px-6 py-5">
            {avatarEl}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span
                  className="truncate text-[22px] font-bold"
                  style={{ color: 'var(--content-primary)' }}
                >
                  {name}
                </span>
                {model && (
                  <span
                    className="shrink-0 text-[13px]"
                    style={{ color: 'var(--content-secondary)' }}
                  >
                    {model}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-[3px] text-[12px] ${
                    status === 'active'
                      ? 'bg-intent-success-muted text-intent-success'
                      : status === 'idle'
                        ? 'bg-intent-warning-muted text-intent-warning'
                        : 'bg-surface-muted text-content-tertiary'
                  }`}
                >
                  <span
                    className={`h-[8px] w-[8px] rounded-full ${statusConfig[status]?.dot ?? 'bg-content-tertiary'}`}
                  />
                  {statusConfig[status]?.label ?? status}
                  {source && <span> · {sourceLabels[source] ?? source}</span>}
                </span>
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((exp) => (
                    <Tag key={exp} variant="info">
                      {exp}
                    </Tag>
                  ))}
                  {extra > 0 && <Tag variant="default">+{extra}</Tag>}
                </div>
              )}

              {(onConfigure || onTest || onDelete) && (
                <div className="mt-1 flex items-center gap-2">
                  {onConfigure && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfigure();
                      }}
                      className="bg-accent text-accent-foreground hover:bg-accent-hover flex-1 rounded-[6px] border-none py-[5px] text-[12px] font-semibold transition-colors"
                    >
                      Configure
                    </button>
                  )}
                  {onTest && kind === 'ai' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTest();
                      }}
                      className="text-content-secondary hover:bg-surface-muted flex-1 rounded-[6px] border border-[var(--border-color)] bg-transparent py-[5px] text-[12px] font-semibold transition-colors"
                    >
                      Test
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                      className="text-content-tertiary hover:text-intent-danger flex-[0_0_36px] rounded-[6px] border-none bg-transparent py-[5px] text-[14px] transition-colors"
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
