import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@goodparty_org/styleguide'

type PlaceholderProps = {
  title: string
  blurb: string
}

export const Placeholder = ({ title, blurb }: PlaceholderProps) => (
  <div className="p-6">
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{blurb}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Prototype content for {title} lives here.
        </p>
      </CardContent>
    </Card>
  </div>
)
