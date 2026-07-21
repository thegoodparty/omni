import { Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
} from 'chart.js'
import type { ChartData, ChartOptions } from 'chart.js'

// Isolated so it can be lazily imported: this is the only door-knocking module
// that pulls chart.js into the client bundle. Keeping it separate lets the
// surrounding panel (heading + legend table) render in the route's first load
// while chart.js downloads on demand.
ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale)

interface InteractionsSummaryPieChartProps {
  data: ChartData<'doughnut'>
  options: ChartOptions<'doughnut'>
}

const InteractionsSummaryPieChart = ({
  data,
  options,
}: InteractionsSummaryPieChartProps): React.JSX.Element => (
  <Doughnut data={data} options={options} />
)

export default InteractionsSummaryPieChart
