import { createContext } from 'react'

// Actions a node card can trigger on the chart that owns it. Passed by context
// rather than through node `data` so toggling never changes a node's data
// identity (which would re-render every card). The no-op default lets a card
// render standalone.
export interface OrgChartActions {
  toggleCollapse: (id: number) => void
}

export const OrgChartActionsContext = createContext<OrgChartActions>({
  toggleCollapse: () => {},
})
