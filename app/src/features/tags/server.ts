// The tags feature: admin-made labels on users that decide, from M5 on, which workflows each
// member can see.
export { assignTag, listTagIdsByUser, unassignTag } from "./lib/assignments";
export { createTag, deleteTag, findTagsByName, listMyTags, listTags, renameTag } from "./lib/tags";
// Announced when someone may have lost sight of workflows; the workflows feature's jobs clean
// up on them.
export { tagAssignmentRemoved, tagDeleted } from "./lib/events";
