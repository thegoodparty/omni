import DashboardLayout from '../shared/DashboardLayout'
import AiChatPreviewClient from './AiChatPreviewClient'

export default function Page(): React.JSX.Element {
  return (
    <DashboardLayout pathname="/dashboard/ai-chat-preview" showAlert={false}>
      <AiChatPreviewClient />
    </DashboardLayout>
  )
}
