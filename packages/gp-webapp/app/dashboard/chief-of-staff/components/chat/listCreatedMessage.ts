// What a list created from its chat card says to the model.
//
// The button's write goes browser -> API, so without this turn the
// conversation never learns the list exists and the next answer treats it as
// an offer still open. Real English rather than a sentinel, for the reason
// `boundarySavedMessage` gives: it is sent hidden, but it persists as a user
// turn and reads as one on a reload. The id is what lets the model read the
// list back with `crud_saved_filters` action 'get'.
//
// CoS eval case B06's second prompt is this string. Change one and change the
// other.
export const listCreatedMessage = ({
  listId,
  name,
}: {
  listId: number
  name: string
}): string => `I created the list "${name}" (list ${listId}) from the card.`
