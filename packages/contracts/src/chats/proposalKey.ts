import { v5 as uuidv5 } from 'uuid'

/**
 * Namespace for outreach proposal keys. Changing it would orphan every card
 * already sitting in a conversation, so it never changes.
 */
const PROPOSAL_KEY_NAMESPACE = '7d3f1a62-9c4e-5b08-a1d7-2f6e8c40b915'

/**
 * The id an outreach will have if the official sends the proposal in front of
 * them. Derived rather than minted, because the message store persists tool
 * ARGS and not results: both the server and the browser have to arrive at the
 * same key from what is already in the conversation.
 *
 * Deterministic, stable across reloads, and never written by the model.
 */
export const mintProposalKey = (
  conversationId: string,
  toolCallId: string,
): string => uuidv5(`${conversationId}:${toolCallId}`, PROPOSAL_KEY_NAMESPACE)
