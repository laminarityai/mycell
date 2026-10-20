/** A tag, as a member sees their own. */
export type Tag = {
  id: string;
  name: string;
};

/** A tag as the tags screen lists it, with the users who have it. */
export type TagSummary = {
  id: string;
  name: string;
  userIds: string[];
};
