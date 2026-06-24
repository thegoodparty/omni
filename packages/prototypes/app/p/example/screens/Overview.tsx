import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
} from '@goodparty_org/styleguide'

const STATS = [
  { label: 'Registered voters', value: '12,480' },
  { label: 'Doors knocked', value: '3,214' },
  { label: 'Volunteers', value: '47' },
  { label: 'Days to election', value: '62' },
]

const RECENT_ISSUES = [
  { title: 'Pothole on Main St', category: 'Infrastructure', priority: 'high' },
  {
    title: 'Park lighting outage',
    category: 'Public Safety',
    priority: 'medium',
  },
  { title: 'Library hours cut', category: 'Services', priority: 'low' },
]

const PRIORITY_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  high: 'default',
  medium: 'secondary',
  low: 'outline',
}

export const Overview = () => (
  <div className="p-6 space-y-6">
    <div>
      <h2 className="text-xl font-semibold">Campaign Overview</h2>
      <p className="text-muted-foreground text-sm mt-1">
        Riverside City Council, District 4
      </p>
    </div>

    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {STATS.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-muted-foreground text-xs mt-1">{stat.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Top community issues</CardTitle>
        <CardDescription>
          Issues flagged by constituents this week
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {RECENT_ISSUES.map((issue) => (
          <div
            key={issue.title}
            className="flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-medium">{issue.title}</p>
              <p className="text-muted-foreground text-xs">{issue.category}</p>
            </div>
            <Badge variant={PRIORITY_VARIANT[issue.priority]}>
              {issue.priority}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>

    <div className="flex gap-3">
      <Button>Start canvassing</Button>
      <Button variant="outline">View full report</Button>
    </div>
  </div>
)
