"use client";

import { ExternalLink } from "lucide-react";
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
import type { SalesforceOpportunity } from "@/lib/types";

function getAccessMethodColor(method: string) {
  const lower = (method || "").toLowerCase();
  if (lower.includes("api"))
    return "bg-primary/15 text-primary border-primary/20";
  // FIXED: Now checks for both "data feed" and "datafeed" to match backend logic
  if (lower.includes("data feed") || lower.includes("datafeed"))
    return "bg-success/15 text-success border-success/20";
  return "bg-muted text-muted-foreground border-border";
}

function formatCurrency(amount: number | null) {
  if (amount === null || amount === undefined) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface SalesforceTableProps {
  opportunities: SalesforceOpportunity[];
  isLoading: boolean;
  error: string | null;
  configured: boolean;
}

export function SalesforceTable({
  opportunities,
  isLoading,
  error,
  configured,
}: SalesforceTableProps) {
  if (!configured) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          Could not access the Google Sheet. Please check the sheet is shared and accessible.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={`sf-skel-${i}`} className="h-12 w-full" />
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

  if (opportunities.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          No opportunities found matching the criteria.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {/* CHANGED: Label to 'Opportunity' since that is what is linked */}
            <TableHead className="text-muted-foreground">Opportunity</TableHead>
            <TableHead className="text-muted-foreground">Access Method</TableHead>
            <TableHead className="text-muted-foreground">Stage</TableHead>
            <TableHead className="text-muted-foreground text-right">Opp ARR</TableHead>
            <TableHead className="text-muted-foreground">Owner</TableHead>
            <TableHead className="text-muted-foreground sr-only">Link</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.map((opp) => (
            <TableRow key={opp.id} className="border-border">
              <TableCell>
                {opp.url ? (
                  <a
                    href={opp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
                    // CHANGED: Tooltip now shows Account Name for context
                    title={`Account: ${opp.accountName}`}
                  >
                    {/* CHANGED: Display Opportunity Name instead of Account Name */}
                    {opp.name || opp.accountName || "Untitled Opportunity"}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </a>
                ) : (
                  <span className="text-sm font-medium text-foreground">
                    {opp.name || opp.accountName || "--"}
                  </span>
                )}
                {/* Optional: Show Account Name smaller below if desired */}
                {opp.accountName && opp.name && (
                  <div className="text-xs text-muted-foreground mt-0.5">{opp.accountName}</div>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={getAccessMethodColor(opp.accessMethod)}
                >
                  {opp.accessMethod || "--"}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {opp.stageName || "--"}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-sm text-foreground">
                  {formatCurrency(opp.amount)}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {opp.ownerName || "--"}
                </span>
              </TableCell>
              <TableCell>
                {opp.url && (
                  <a
                    href={opp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors sr-only"
                    aria-label={`Open ${opp.name} in Salesforce`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}