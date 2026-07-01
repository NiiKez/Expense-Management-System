import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Role } from '@/types'
import type { OrgFlowNode } from './layout'

// No shared initials helper in the codebase — mirror the local copy used in
// Settings/Topbar (first two whitespace-separated initials, uppercased).
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const roleVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  [Role.ADMIN]: 'default',
  [Role.MANAGER]: 'secondary',
  [Role.EMPLOYEE]: 'outline',
}

// A custom React Flow node, typed on the concrete OrgFlowNode so `data` is
// checked against OrgNodeData here. The one remaining variance friction (nodeTypes
// wants the default NodeProps) is absorbed by a single cast at registration.
function OrgNodeComponent({ data }: NodeProps<OrgFlowNode>) {
  const { node, directReportCount, isRoot, isSelf } = data
  const subtitle = [node.jobTitle, node.department].filter(Boolean).join(' · ')

  return (
    <div
      data-testid={`org-node-${node.id}`}
      className={cn(
        'flex w-[240px] cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/60',
        isSelf && 'ring-2 ring-primary',
        isRoot && !isSelf && 'ring-1 ring-primary/40',
        !node.isActive && 'opacity-60',
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Avatar>
        <AvatarFallback>{initials(node.displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        {/* title attrs reveal the full text on hover — the fixed card width often
            truncates longer names / "Job Title · Department" subtitles. */}
        <p className="truncate text-sm font-medium text-foreground" title={node.displayName}>
          {node.displayName}
        </p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={roleVariant[node.role] ?? 'outline'} className="text-[10px]">
            {node.role}
          </Badge>
          {directReportCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {directReportCount} report{directReportCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

export default memo(OrgNodeComponent)
