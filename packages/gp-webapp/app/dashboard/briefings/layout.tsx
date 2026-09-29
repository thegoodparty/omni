import { openSansBriefings } from '../../fonts'

const BriefingsSegmentLayout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div
    className={openSansBriefings.variable}
    style={{ fontFamily: 'var(--font-briefings)' }}
  >
    {children}
  </div>
)

export default BriefingsSegmentLayout
