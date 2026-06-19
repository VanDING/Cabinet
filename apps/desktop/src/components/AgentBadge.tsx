import { useRef, useState, type MouseEvent } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, mx: 50, my: 50, active: false });

  const matched = getAgentIcon(name, model);

  const handleMove = (e: MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setTilt({
      x: (y - 0.5) * -20,
      y: (x - 0.5) * 20,
      mx: x * 100,
      my: y * 100,
      active: true,
    });
  };

  const handleLeave = () => {
    setTilt({ x: 0, y: 0, mx: 50, my: 50, active: false });
  };

  const tags = expertise.slice(0, 3);
  const extra = expertise.length - 3;

  const avatarNode = matched ? (
    <div
      className="mb-2.5 flex h-[52px] w-[52px] items-center justify-center rounded-full"
      style={{
        background: matched.gradient,
        boxShadow: '0 0 0 2px var(--border-color), 0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      {matched.icon(26)}
    </div>
  ) : (
    <div
      className="bg-surface-muted mb-2.5 flex h-[52px] w-[52px] items-center justify-center rounded-full text-base font-semibold"
      style={{ boxShadow: '0 0 0 2px var(--border-color), 0 4px 20px rgba(0,0,0,0.3)' }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <div
      ref={ref}
      className="cursor-pointer"
      style={{ perspective: '600px' }}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div
        style={{
          transform: tilt.active ? `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` : undefined,
          transition: tilt.active ? 'none' : 'transform 0.4s ease',
        }}
      >
        <Card padding="none" hoverable>
          <div
            className="flex flex-col items-center px-4 pt-6 pb-3 text-center"
            style={{ aspectRatio: '0.72' }}
          >
            {avatarNode}
            <div className="text-content-primary mb-0 text-[15px] font-semibold">{name}</div>

            <div className="min-h-3 flex-1" />

            <div className="flex w-full flex-col items-center gap-1">
              {model && <div className="text-content-secondary text-[11px]">{model}</div>}

              <div
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[1px] text-[10px] ${
                  status === 'active'
                    ? 'bg-intent-success-muted text-intent-success'
                    : status === 'idle'
                      ? 'bg-intent-warning-muted text-intent-warning'
                      : 'bg-surface-muted text-content-tertiary'
                }`}
              >
                <span
                  className={`h-[5px] w-[5px] rounded-full ${statusConfig[status]?.dot ?? 'bg-content-tertiary'}`}
                />
                {statusConfig[status]?.label ?? status}
                {source && <span> · {sourceLabels[source] ?? source}</span>}
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1">
                  {tags.map((exp) => (
                    <Tag key={exp} variant="info">
                      {exp}
                    </Tag>
                  ))}
                  {extra > 0 && <Tag variant="default">+{extra}</Tag>}
                </div>
              )}

              <div className="border-border mt-1 flex w-full items-center gap-1 border-t pt-[8px]">
                {onConfigure && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfigure();
                    }}
                    className="bg-accent text-accent-foreground hover:bg-accent-hover flex-1 rounded-[6px] border-none py-[4px] text-[10px] font-medium transition-colors"
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
                    className="text-content-secondary hover:bg-surface-muted flex-1 rounded-[6px] border border-[var(--border-color)] bg-transparent py-[4px] text-[10px] font-medium transition-colors"
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
                    className="text-content-tertiary hover:text-intent-danger flex-[0_0_30px] rounded-[6px] border-none bg-transparent py-[4px] text-[10px] transition-colors"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
