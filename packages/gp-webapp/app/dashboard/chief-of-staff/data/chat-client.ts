/**
 * The Chief of Staff chat client interface. The scope-generic interface now
 * lives in the shared manager-chat client; this alias keeps existing Chief of
 * Staff imports (`ChiefOfStaffChatClient`) stable.
 */

export type { ManagerChatClient as ChiefOfStaffChatClient } from '../../shared/manager-chat/chatClient'
