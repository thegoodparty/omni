// What a boundary drawn from the transcript says to the model.
//
// Drawing is a write the browser makes straight to the API, so without this
// the conversation gains no turn and the next message arrives in a context
// identical to the one before the holder drew — which is why the assistant
// used to answer "I can't read the geographic boundary from my side" about a
// list that was already the shape they drew.
//
// Real English rather than a machine sentinel, for the same reason the
// Campaign Manager's ballot kickoff is: it is sent hidden so no bubble
// appears live, but it is a persisted user turn, and on a reload it reads as
// a question the holder asked. The id is carried because it is the only
// thing that makes the follow-up deterministic — `crud_saved_filters` with
// action 'get' is where the post-boundary count comes from, and it takes an
// id.
export const boundarySavedMessage = ({
  listId,
  name,
  cleared,
}: {
  listId: number
  name: string
  cleared: boolean
}): string =>
  cleared
    ? `I cleared the area I had drawn on my list "${name}" (list ${listId}). Where does that leave the list?`
    : `I drew an area on the map and saved it to my list "${name}" (list ${listId}). Where does that leave the list?`
