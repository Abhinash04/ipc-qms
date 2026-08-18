import { Link } from 'react-router-dom';
import { SearchIcon, InboxIcon } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from '@/components/ui/pagination';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { buildPath } from '@/constants/routePaths';

export function QueryTable({ title, purpose, breadcrumbItems, detailPath, filter, actions, emptyMessage }) {
  const allQueries = useWorkflowStore((state) => state.queries);
  const queries = filter ? allQueries.filter(filter) : allQueries;
  return (
    <div>
      <Breadcrumb items={breadcrumbItems} />
      <PageHeader title={title} purpose={purpose} actions={actions} />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input placeholder="Search queries…" className="pl-8" disabled />
          </div>
          <Select disabled defaultValue="ALL">
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All priorities</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {queries.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="No queries"
            description={emptyMessage || 'Nothing matches this view yet.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow hoverable={false}>
                <TableHead>Query ID</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queries.map((query) => (
                <TableRow key={query.queryId}>
                  <TableCell>
                    <Link
                      to={detailPath ? buildPath(detailPath, { queryId: query.queryId }) : '#'}
                      className="font-medium text-ring hover:underline"
                    >
                      {query.queryId}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{query.subject}</TableCell>
                  <TableCell>
                    <StatusBadge type="priority" value={query.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge type="workflow" value={query.workflowState} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {query.currentAssigneeId ? findUserById(query.currentAssigneeId)?.name : 'Unassigned'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>
            Showing {queries.length} of {queries.length}
          </span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  1
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </Card>
    </div>
  );
}
