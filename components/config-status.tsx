"use client";

import { CheckCircle2, XCircle } from "lucide-react";

interface ConfigStatusProps {
  jiraConfigured: boolean;
  sfConfigured: boolean;
}

export function ConfigStatus({
  jiraConfigured,
  sfConfigured,
}: ConfigStatusProps) {
  if (jiraConfigured && sfConfigured) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground font-medium">Integrations:</span>
      <span className="flex items-center gap-1.5">
        {jiraConfigured ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="text-foreground">Jira</span>
      </span>
      <span className="flex items-center gap-1.5">
        {sfConfigured ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="text-foreground">Salesforce (Google Sheets)</span>
      </span>
    </div>
  );
}
