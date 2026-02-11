"use client";

import { Ticket, TrendingUp, AlertCircle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { JiraTicket, SalesforceOpportunity } from "@/lib/types";

interface StatsCardsProps {
  jiraTickets: JiraTicket[];
  sfDueDiligence: SalesforceOpportunity[];
  sfStandingApart: SalesforceOpportunity[];
  jiraConfigured: boolean;
  sfConfigured: boolean;
}

export function StatsCards({
  jiraTickets,
  sfDueDiligence,
  sfStandingApart,
  jiraConfigured,
  sfConfigured,
}: StatsCardsProps) {
  const jiraOpen = jiraTickets.filter(
    (t) => !["Done", "Closed", "Resolved"].includes(t.status)
  ).length;

  const jiraHighPriority = jiraTickets.filter((t) =>
    ["Highest", "High", "Critical", "Blocker"].includes(t.priority)
  ).length;

  const ddAmount = sfDueDiligence.reduce(
    (sum, opp) => sum + (opp.amount || 0),
    0
  );

  const saAmount = sfStandingApart.reduce(
    (sum, opp) => sum + (opp.amount || 0),
    0
  );

  function formatValue(amount: number): string {
    if (amount === 0) return "$0";
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    return `$${(amount / 1000).toFixed(0)}K`;
  }

  const stats = [
    {
      label: "Jira Tickets",
      value: jiraConfigured ? jiraTickets.length.toString() : "--",
      sublabel: jiraConfigured
        ? `${jiraOpen} open`
        : "Not configured",
      icon: Ticket,
      color: "text-primary",
    },
    {
      label: "High Priority",
      value: jiraConfigured ? jiraHighPriority.toString() : "--",
      sublabel: jiraConfigured ? "Needs attention" : "Not configured",
      icon: AlertCircle,
      color: jiraHighPriority > 0 ? "text-destructive" : "text-success",
    },
    {
      label: "Due Diligence",
      value: sfConfigured ? sfDueDiligence.length.toString() : "--",
      sublabel: sfConfigured
        ? `${formatValue(ddAmount)} pipeline`
        : "Not configured",
      icon: TrendingUp,
      color: "text-success",
    },
    {
      label: "Standing Apart",
      value: sfConfigured ? sfStandingApart.length.toString() : "--",
      sublabel: sfConfigured
        ? `${formatValue(saAmount)} pipeline`
        : "Not configured",
      icon: Clock,
      color: "text-warning",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-3xl font-semibold text-foreground">
                  {stat.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stat.sublabel}
                </p>
              </div>
              <stat.icon className={`h-8 w-8 ${stat.color} opacity-60`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
