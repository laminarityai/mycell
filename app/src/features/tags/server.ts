// The tags feature: admin-made labels on users that decide, from M5 on, which workflows each
// member can see.
export { assignTag, listTagIdsByUser, unassignTag } from "./lib/assignments";
export {
  createTag,
  deleteTag,
  findTagsByName,
  listMyTags,
  listTags,
  renameTag,
  tagNamesById,
} from "./lib/tags";
// Announced when someone may have lost sight of workflows, or a tag's name changed; the workflows
// feature's jobs clean up and follow on them.
export { tagAssignmentRemoved, tagDeleted, tagRenamed } from "./lib/events";
