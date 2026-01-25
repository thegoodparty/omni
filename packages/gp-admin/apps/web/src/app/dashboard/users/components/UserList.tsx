import Link from 'next/link'
import { Table, Text } from '@radix-ui/themes'
import { User } from '../types'

interface UserListProps {
  users: User[]
}

export function UserList({ users }: UserListProps) {
  if (users.length === 0) {
    return (
      <Text color="gray" size="3">
        No users found matching your search criteria.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Phone</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {users.map((user) => (
          <Table.Row key={user.id}>
            <Table.Cell>{user.id}</Table.Cell>
            <Table.Cell>
              <Link
                href={`/dashboard/users/${user.id}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {user.firstName} {user.lastName}
              </Link>
            </Table.Cell>
            <Table.Cell>{user.email}</Table.Cell>
            <Table.Cell>{user.phone ?? '—'}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
