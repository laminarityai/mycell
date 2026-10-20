import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateTagForm, TagNameControls, TagUsersControls } from "./lib/tag-controls";
import type { Tag, TagSummary } from "./types";

type TagUser = { id: string; name: string };

/** The admin tags screen: create tags, rename and delete them, and choose who has each. */
export function TagsManager({ tags, users }: { tags: TagSummary[]; users: TagUser[] }) {
  return (
    <div className="flex flex-col gap-4">
      <CreateTagForm />
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Who has it</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((tag) => (
              <TableRow key={tag.id} className="align-top">
                <TableCell>
                  <TagNameControls tagId={tag.id} name={tag.name} />
                </TableCell>
                <TableCell>{tag.userIds.length}</TableCell>
                <TableCell>
                  <TagUsersControls
                    tagId={tag.id}
                    holders={users.filter((user) => tag.userIds.includes(user.id))}
                    others={users.filter((user) => !tag.userIds.includes(user.id))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** The signed-in user's own tags. */
export function MyTags({ tags }: { tags: Tag[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Your tags</h2>
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">You don&apos;t have any tags yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag.id} variant="secondary">
              {tag.name}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}
