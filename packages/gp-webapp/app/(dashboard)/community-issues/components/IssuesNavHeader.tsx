import DashboardNavHeader from '../../shared/DashboardNavHeader'

// Community Issues' flag + title header. Rendered inside the page body (the page
// passes wrapperClassName="!p-0" so it sits flush against the layout edges),
// delegating to the shared DashboardNavHeader used by the other Serve tabs.
const IssuesNavHeader = (): React.JSX.Element => (
  <DashboardNavHeader icon="flag" label="Community Issues" />
)

export default IssuesNavHeader
