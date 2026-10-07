/**
 * The Chief of Staff chat client interface. The scope-generic interface now
 * lives in the shared agent-chat client; this alias keeps existing Chief of
 * Staff imports (`ChiefOfStaffChatClient`) stable.
 */

export type { AgentChatClient as ChiefOfStaffChatClient } from '../../shared/agent-chat/chatClient'
