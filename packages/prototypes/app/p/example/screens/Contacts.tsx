import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@goodparty_org/styleguide'

const CONTACTS = [
  {
    name: 'Maria Garcia',
    precinct: '04-A',
    status: 'supporter',
    lastContact: '2026-06-20',
  },
  {
    name: 'James Okafor',
    precinct: '04-B',
    status: 'undecided',
    lastContact: '2026-06-18',
  },
  {
    name: 'Priya Nair',
    precinct: '04-A',
    status: 'supporter',
    lastContact: '2026-06-17',
  },
  {
    name: 'Tom Buckley',
    precinct: '04-C',
    status: 'opposed',
    lastContact: '2026-06-15',
  },
  {
    name: 'Sandra Lee',
    precinct: '04-B',
    status: 'undecided',
    lastContact: '2026-06-12',
  },
]

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  supporter: 'default',
  undecided: 'secondary',
  opposed: 'outline',
}

export const Contacts = () => (
  <div className="p-6 space-y-6">
    <div>
      <h2 className="text-xl font-semibold">Contacts</h2>
      <p className="text-muted-foreground text-sm mt-1">
        Tracked constituents in District 4
      </p>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>All contacts</CardTitle>
        <CardDescription>
          5 contacts — sorted by last contact date
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Precinct</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last contact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CONTACTS.map((contact) => (
              <TableRow key={contact.name}>
                <TableCell className="font-medium">{contact.name}</TableCell>
                <TableCell>{contact.precinct}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[contact.status]}>
                    {contact.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {contact.lastContact}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
)
