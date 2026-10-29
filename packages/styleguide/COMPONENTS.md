# Styleguide components

Every component in `src/components/ui/` and when to use it. Pick from this list
before you build UI, and import from `@styleguide`. For variants and props, read
the component's source. For examples, read its story in `src/stories/`.

Generated from the `@summary` JSDoc tag on each component. Do not edit by hand:
change the tag, then run `npm run docs:components -w packages/styleguide`.

- **Accordion** (`accordion.tsx`): Use for a stack of sections the user expands one or more of, like a list of opponents. For a single show-more toggle, use Collapsible.
- **AiIcon** (`ai-icon.tsx`): Use to mark AI features, like the AI chat bar or a generate-with-AI action. For every other icon, use the approved Icons set.
- **Alert** (`alert.tsx`): Use for a message that stays on the page, like a failed load or an account notice. Field errors go by the field; passing confirmations use Toaster.
- **AlertDialog** (`alert-dialog.tsx`): Use to confirm an action that can't be undone, like a delete. For anything with input, use Dialog.
- **AspectRatio** (`aspect-ratio.tsx`): Use to keep an image, video or map at a fixed shape, like 16:9, as its width changes.
- **Avatar** (`avatar.tsx`): Use for a person's photo in a small circle or square, falling back to their initials or an icon.
- **Badge** (`badge.tsx`): Use for a short tag or count on an item. For an item's status use StatusText, for the Pro plan ProBadge, and for merge tags TokenPill.
- **BarChart** (`bar-chart.tsx`): Use for comparing a few categories as colored bars with a legend. For a compact list with a label and value beside each bar, use BarList.
- **BarList** (`bar-list.tsx`): Use for a list of labeled values, each with a thin bar, like poll answers. For parts of one whole, use DonutChart.
- **Breadcrumb** (`breadcrumb.tsx`): Use only to hand-build a breadcrumb trail from its parts. For a normal trail of parent pages, use BreadcrumbNav.
- **BreadcrumbNav** (`breadcrumb-nav.tsx`): Use for a clickable trail of parent pages above a nested page. It folds middle crumbs into a menu when narrow. For a title bar, use PageHeader.
- **Button** (`button.tsx`): Use for any action with a text label, like saving or sending. For an icon-only action, use IconButton; for an on/off choice, use ToggleGroup.
- **Calendar** (`calendar.tsx`): Use for picking a date or date range from a month grid, shown inline or opened from a Popover beside a date field.
- **CalendarButton** (`calendar-button.tsx`): Use only for the day and arrow buttons inside Calendar; the package does not export it. For buttons in app code, use Button or IconButton.
- **Card** (`card.tsx`): Use for a bordered panel you lay out yourself. For a title, text and buttons, use ContentCard; for picking an outreach channel, ChannelCard.
- **ChannelCard** (`channel-card.tsx`): Use for a clickable tile that picks an outreach channel, with an icon, a name and a price line. For a panel that isn't a choice, use Card.
- **Checkbox** (`checkbox.tsx`): Use for a yes or no choice saved when the form is submitted, or for picking several items. For a setting that applies right away, use Switch.
- **Collapsible** (`collapsible.tsx`): Use to show or hide one optional block of detail in place, like sources. For a stack of expandable sections, use Accordion.
- **Combobox** (`combobox.tsx`): Use to pick one option from a long list by searching, like a district or issue. For five or fewer, use RadioGroup or ToggleGroup.
- **Command** (`command.tsx`): Use for an inline search box with a keyboard-navigable list of results, like contact search. To pick one value in a form, use Combobox.
- **ConfettiBurst** (`confetti-burst.tsx`): Use to celebrate the moment a user finishes something that matters, like launching outreach or completing a purchase. Not for decoration or routine saves.
- **ContentCard** (`content-card.tsx`): Use for a card with a title, short description, optional content and up to two buttons. For a free-form layout, use Card.
- **DataTable** (`data-table.tsx`): Use for a table the user can sort, filter, hide columns in and page through in the browser. For a simple or server-paged table, use Table.
- **Dialog** (`dialog.tsx`): Use on desktop for a short, focused input. To confirm an irreversible action, use AlertDialog. A flow or anything with its own actions is a page.
- **DonutChart** (`donut-chart.tsx`): Use for how one whole splits into a few parts, with a legend of values. PieChart is the same without the hole. For ranked items, use BarList.
- **Drawer** (`drawer.tsx`): Use on mobile for a quick input, a few actions or short info that slides up from the bottom. Never put a flow in one; make it a page.
- **DropdownMenu** (`dropdown-menu.tsx`): Use for a menu of actions behind a button, like a row's more menu. To pick a value in a form, use Select or Combobox.
- **EmptyState** (`empty-state.tsx`): Use when a list, table or panel has nothing to show, saying what's missing and the one thing to do next. Don't hand-roll a muted Card sentence.
- **FilterPillGroup** (`filter-pill.tsx`): Use for a row of rounded pills that filter a list or pick one short answer. For a segmented control, use ToggleGroup; for card options, use RadioCardItem.
- **Form** (`form.tsx`): Use for forms built with react-hook-form, so each field shows its label, help text and error right beside it. Never show a form error in a toast.
- **GoodPartyOrgLogo** (`good-party-org-logo.tsx`): Use for the GoodParty.org heart alone, in tight spots like a chat avatar or mobile top bar. For the name beside the heart, use GoodPartyOrgLogoWordmark.
- **GoodPartyOrgLogoWordmark** (`good-party-org-logo-wordmark.tsx`): Use for the full GoodParty.org name beside the heart, as the brand header on pages like sign-in and welcome. For the heart alone, use GoodPartyOrgLogo.
- **HoverCard** (`hover-card.tsx`): Use for a richer preview, like a source, when the pointer rests on a link or chip. For a short label, use Tooltip.
- **IconButton** (`icon-button.tsx`): Use for a round, icon-only action in tight spots, like edit, more or close. For an action with a text label, use Button.
- **Icons** (`icons.tsx`): Use for every icon: this is the approved set. Import icons from here, never straight from lucide-react, and add a missing icon here first.
- **Input** (`input.tsx`): Use for one line of text, like a name, email or search. For several lines, use Textarea; with an attached action button, use InputWithButton.
- **InputOTP** (`input-otp.tsx`): Use for entering a one-time code or PIN, one box per character. For any other short text, use Input.
- **InputWithButton** (`input-with-button.tsx`): Use for a single field with its own action button, like a ZIP code lookup. For a field inside a larger form, use Input.
- **Label** (`label.tsx`): Use for the visible name of a form field, linked to it with htmlFor. For a checkbox or switch with its label, use CheckboxLabel or SwitchLabel.
- **Overline** (`overline.tsx`): Use rarely, for a tiny uppercase label. Rule 19 in learned.md says no overlines above headings or card titles; let the title lead.
- **PageHeader** (`page-header.tsx`): Use for a sticky bar with the page title, plus an optional sub-bar for a back arrow and actions. For a trail of parent pages, use BreadcrumbNav.
- **Pagination** (`pagination.tsx`): Use for page links under a list or Table that shows one page at a time. DataTable has its own paging, so don't add this to it.
- **Popover** (`popover.tsx`): Use for a small menu or hint tied to one element. Never a form; use Dialog. For a list of actions, use DropdownMenu.
- **ProBadge** (`pro-badge.tsx`): Use to mark a feature or action as part of the paid Pro plan. For any other tag or count, use Badge.
- **Progress** (`progress.tsx`): Use for a bar showing how far along a known task or set of steps is. For a wait of unknown length use Spinner; for loading content, Skeleton.
- **RadioCardItem** (`radio-group.tsx`): Use for picking one of a few options shown as cards with a title and short description. Place inside a RadioGroup; for plain options, use RadioGroupItemLabel.
- **RadioGroup** (`radio-group.tsx`): Use for picking one of up to about five visible options. For more options, use Combobox; never a Select for two or three.
- **ScrollArea** (`scroll-area.tsx`): Use for a fixed-height box whose content scrolls on its own, like a long list in a panel. Pages and DrawerBody already scroll; don't wrap them.
- **Select** (`select.tsx`): Use to pick one value from a short fixed list in a form. For five or fewer options, use RadioGroup or ToggleGroup; to search many, use Combobox.
- **Separator** (`separator.tsx`): Use for a thin horizontal or vertical line between groups of content. To set a whole block apart, use Card, which has its own border.
- **Sheet** (`sheet.tsx`): Use for a quick look at one item, like a contact, while the list behind it stays in view. For short input from the bottom, use Drawer.
- **SidebarProvider** (`sidebar.tsx`): Use to build an app shell with a collapsible side nav beside the page content. Inside the dashboard, use DashboardLayout instead.
- **Skeleton** (`skeleton.tsx`): Use for gray placeholder shapes that hold the layout while content loads. For a wait with no layout to preview, use Spinner.
- **Slider** (`slider.tsx`): Use for picking a value or range by dragging along a scale, when a rough value is fine. For an exact number, use Input.
- **SourceCitation** (`source-citation.tsx`): Use to cite the source behind a factual claim, as a small chip beside it that opens the source details. Every factual claim needs one.
- **Spinner** (`spinner.tsx`): Use for any wait of unknown length, like a fetch or a page loading. For placeholders shaped like the content, use Skeleton; for known progress, Progress.
- **StatusText** (`status-text.tsx`): Use for an item's status as colored text with an icon, like a state in a table row. For a tag or count, use Badge.
- **Stepper** (`stepper.tsx`): Use to show where the user is in a multi-step flow: bars for short, uniform steps, the vertical variant when each step needs a label.
- **Switch** (`switch.tsx`): Use for an on or off setting that takes effect right away. For a choice saved with a form submit, use Checkbox.
- **Table** (`table.tsx`): Use for a table where you control the rows, sorting and paging, such as server-paged data. For built-in sort, filter and paging, use DataTable.
- **Tabs** (`tabs.tsx`): Use to switch between a few peer views in one place, one at a time. For filter pills or toggled choices, use ToggleGroup; for ordered steps, use Stepper.
- **Textarea** (`textarea.tsx`): Use for free text that can run several lines, like a note or a reply. For a message with merge tags or locked lines, use TokenField.
- **Toaster** (`sonner.tsx`): Use for a brief, low-stakes confirmation that fades away. Never for form errors or the end of a flow; show errors by the field and a success view.
- **Toggle** (`toggle.tsx`): Use for one button that stays pressed or not, like a toolbar format button. For a set of choices, use ToggleGroup; for a setting, use Switch.
- **ToggleGroup** (`toggle-group.tsx`): Use for a segmented control or a row of toggle buttons, one or many selected. For pill-shaped filters, use FilterPillGroup. Never Button with aria-pressed.
- **TokenField** (`token-field.tsx`): Use for writing an outreach message with merge tags, like first name, and locked lines, like disclaimers. For plain multi-line text, use Textarea.
- **TokenPill** (`token-pill.tsx`): Use for showing a merge tag, like First name, inside preview or review text. For an editable message, use TokenField; for a status label, use Badge.
- **Tooltip** (`tooltip.tsx`): Use for a short label on hover or focus, like naming an icon-only button. For anything clickable or longer, use Popover.
