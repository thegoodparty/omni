import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../components/ui/command'

const meta: Meta<typeof Command> = {
  title: 'Components/Command',
  component: Command,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Filterable list panel with keyboard navigation built on `cmdk`. Typically composed inside a `Popover` via the `Combobox` component, but can also be used standalone (e.g. command palettes). See `Combobox` for the trigger + popover wrapper.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof Command>

export const Static: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-72 rounded-md border border-base-border shadow-md">
      <Command>
        <CommandInput placeholder="Search offices..." />
        <CommandList>
          <CommandGroup heading="Local">
            <CommandItem>Mayor</CommandItem>
            <CommandItem>City Council</CommandItem>
            <CommandItem>School Board</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="State">
            <CommandItem>State Senate</CommandItem>
            <CommandItem>State House</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Federal">
            <CommandItem>US House</CommandItem>
            <CommandItem>US Senate</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
}

export const WithEmpty: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-72 rounded-md border border-base-border shadow-md">
      <Command>
        <CommandInput placeholder="Search offices..." defaultValue="xyz" />
        <CommandList>
          <CommandEmpty>No office found.</CommandEmpty>
          <CommandGroup heading="Local">
            <CommandItem>Mayor</CommandItem>
            <CommandItem>City Council</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
}
