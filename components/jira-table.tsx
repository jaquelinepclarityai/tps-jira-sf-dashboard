"use client";

import { ExternalLink, AlertTriangle, Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { JiraTicket } from "@/lib/types";

function getStatusColor(status: string) {
  const lower = status.toLowerCase();
  if (["done", "closed", "resolved"].includes(lower))
    return "bg-success/15 text-success border-success/20";
  if (["in progress", "in review", "in development"].includes(lower))
    return "bg-primary/15 text-primary border-primary/20";
  if (["to do", "open", "new", "backlog"].includes(lower))
    return "bg-muted text-muted-foreground border-border";
  if (["blocked", "on hold"].includes(lower))
    return "bg-destructive/15 text-destructive border-destructive/20";
  return "bg-muted text-muted-foreground border-border";
}

function getPriorityColor(priority: string) {
  const lower = priority.toLowerCase();
  if (["highest", "critical", "blocker"].includes(lower))
    return "bg-destructive/15 text-destructive border-destructive/20";
  if (["high"].includes(lower))
    return "bg-warning/15 text-warning border-warning/20";
  if (["medium"].includes(lower))
    return "bg-primary/15 text-primary border-primary/20";
  return "bg-muted text-muted-foreground border-border";
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type DueUrgency = "overdue" | "today" | "tomorrow" | "upcoming" | "none";

function getDueUrgency(dueDateStr: string | null): DueUrgency {
  if (!dueDateStr) return "none";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const due = new Date(dueDateStr + "T00:00:00");

  if (due < today) return "overdue";
  if (due >= today && due < tomorrow) return "today";
  if (due >= tomorrow && due < dayAfterTomorrow) return "tomorrow";
  return "upcoming";
}

function getDueStyles(urgency: DueUrgency) {
  switch (urgency) {
    case "overdue":
      return {
        cell: "bg-destructive/10",
        text: "text-destructive font-semibold",
        badge: "bg-destructive/15 text-destructive border-destructive/30",
        label: "Overdue",
      };
    case "today":
      return {
        cell: "bg-warning/10",
        text: "text-warning font-semibold",
        badge: "bg-warning/15 text-warning border-warning/30",
        label: "Due Today",
      };
    case "tomorrow":
      return {
        cell: "bg-warning/5",
        text: "text-warning",
        badge: "bg-warning/10 text-warning border-warning/20",
        label: "Due Tomorrow",
      };
    case "upcoming":
      return {
        cell: "",
        text: "text-muted-foreground",
        badge: "",
        label: "",
      };
    case "none":
      return {
        cell: "",
        text: "text-muted-foreground",
        badge: "",
        label: "",
      };
  }
}

interface JiraTableProps {
  tickets: JiraTicket[];
  isLoading: boolean;
  error: string | null;
  configured: boolean;
}

export function JiraTable({
  tickets,
  isLoading,
  error,
  configured,
}: JiraTableProps) {
  if (!configured) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          Jira is not configured. Add the following environment variables:
        </p>
        <div className="mt-4 flex flex-col items-center gap-1 font-mono text-xs text-muted-foreground">
          <span>JIRA_BASE_URL</span>
          <span>JIRA_EMAIL</span>
          <span>JIRA_API_TOKEN</span>
          <span>JIRA_FILTER_ID</span>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={`jira-skel-${i}`} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No tickets found in this filter.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">Key</TableHead>
            <TableHead className="text-muted-foreground">Summary</TableHead>
            <TableHead className="text-muted-foreground">Type</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Owner</TableHead>
            <TableHead className="text-muted-foreground">Assignee</TableHead>
            <TableHead className="text-muted-foreground">Due Date</TableHead>
            <TableHead className="text-muted-foreground">Created</TableHead>
            <TableHead className="text-muted-foreground sr-only">Link</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => {
            const urgency = getDueUrgency(ticket.dueDate);
            const dueStyles = getDueStyles(urgency);

            return (
              <TableRow key={ticket.id} className="border-border">
                <TableCell>
                  <a
                    href={ticket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {ticket.key}
                  </a>
                </TableCell>
                <TableCell className="max-w-[300px]">
                  <span className="truncate block text-foreground" title={ticket.summary}>
                    {ticket.summary}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {ticket.type}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={getStatusColor(ticket.status)}
                  >
                    {ticket.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {ticket.owner || "Unassigned"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {ticket.assignee || "Unassigned"}
                  </span>
                </TableCell>
                <TableCell className={dueStyles.cell}>
                  {ticket.dueDate ? (
                    <div className="flex items-center gap-1.5">
                      {(urgency === "overdue" || urgency === "today") && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-current" />
                      )}
                      {urgency === "tomorrow" && (
                        <Clock className="h-3.5 w-3.5 shrink-0 text-current" />
                      )}
                      <div className="flex flex-col">
                        <span className={`text-xs font-mono ${dueStyles.text}`}>
                          {formatDate(ticket.dueDate)}
                        </span>
                        {dueStyles.label && (
                          <Badge
                            variant="outline"
                            className={`mt-0.5 text-[10px] px-1.5 py-0 leading-4 w-fit ${dueStyles.badge}`}
                          >
                            {dueStyles.label}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No due date</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatDate(ticket.created)}
                  </span>
                </TableCell>
                <TableCell>
                  <a
                    href={ticket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    aria-label={`Open ${ticket.key} in Jira`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
