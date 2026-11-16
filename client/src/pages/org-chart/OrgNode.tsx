import { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Building2, ChevronDown, ChevronUp } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Role } from '@/types'
import { OrgChartActionsContext } from './context'
import type { OrgFlowNode } from './layout'
import { roleStyle } from './roles'

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

// A custom React Flow node, typed on the concrete OrgFlowNode so `data` is
// checked against OrgNodeData here. The one remaining variance friction (nodeTypes
// wants the default NodeProps) is absorbed by a single cast at registration.
function OrgNodeComponent({ data }: NodeProps<OrgFlowNode>) {
  const { node, directReportCount, isCollapsed, hiddenCount, isRoot, isSelf } = data
  const { toggleCollapse } = useContext(OrgChartActionsContext)
  const style = roleStyle[node.role] ?? roleStyle[Role.EMPLOYEE]
  const reports = `${directReportCount} report${directReportCount === 1 ? '' : 's'}`

  return (
    // Fixed size (matches NODE_WIDTH × NODE_HEIGHT in the layout) so every card
    // in a row is level, with or without a job title.
    <div
      data-testid={`org-node-${node.id}`}
      data-role={node.role}
      data-root={isRoot || undefined}
      className={cn(
        'org-card relative flex h-[92px] w-[272px] cursor-pointer items-center gap-3 rounded-xl border border-border bg-card pr-3 pl-3.5 shadow-sm',
        'transition-[border-color,box-shadow,transform] duration-200 ease-out-quart hover:-translate-y-px hover:border-primary/50 hover:shadow-md',
        isSelf && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        !node.isActive && 'opacity-60',
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />

      <Avatar className="size-11">
        <AvatarFallback className={cn('text-sm font-semibold', style.avatar)}>
          {initials(node.displayName)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* title attrs reveal the full text on hover when the fixed card
              width truncates a long name / title / department. */}
          <p className="truncate text-sm leading-5 font-semibold text-foreground" title={node.displayName}>
            {node.displayName}
          </p>
          {isSelf && (
            <span className="shrink-0 rounded bg-primary px-1 text-[9px] leading-4 font-semibold tracking-wide text-primary-foreground uppercase">
              You
            </span>
          )}
        </div>
        {node.jobTitle && (
          <p className="truncate text-xs leading-4 text-muted-foreground" title={node.jobTitle}>
            {node.jobTitle}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] leading-4">
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px font-medium',
              style.badge,
            )}
          >
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            {style.label}
          </span>
          {node.department && (
            <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
              <Building2 aria-hidden className="size-3 shrink-0" />
              <span className="truncate" title={node.department}>
                {node.department}
              </span>
            </span>
          )}
        </div>
      </div>

      {directReportCount > 0 && (
        // Sits on the bottom edge where the connector leaves. `nodrag nopan`
        // keeps React Flow from treating a press here as a canvas gesture, and
        // stopping propagation keeps the click from opening the detail modal.
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Show' : 'Hide'} ${reports}`}
          title={
            isCollapsed
              ? `Show ${reports} (${hiddenCount} ${hiddenCount === 1 ? 'person' : 'people'} hidden)`
              : `Hide ${reports}`
          }
          onClick={(e) => {
            e.stopPropagation()
            toggleCollapse(node.id)
          }}
          className={cn(
            'nodrag nopan absolute -bottom-3 left-1/2 z-10 inline-flex h-6 -translate-x-1/2 cursor-pointer items-center gap-0.5 rounded-full border pr-1 pl-2 text-[11px] font-semibold tabular-nums shadow-xs outline-none',
            'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60',
            isCollapsed
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
          )}
        >
          {isCollapsed ? `+${hiddenCount}` : directReportCount}
          {isCollapsed ? (
            <ChevronDown aria-hidden className="size-3.5" />
          ) : (
            <ChevronUp aria-hidden className="size-3.5" />
          )}
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

export default memo(OrgNodeComponent)
