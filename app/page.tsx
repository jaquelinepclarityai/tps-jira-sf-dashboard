"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/dashboard-header";
import { StatsCards } from "@/components/stats-cards";
import { JiraTable } from "@/components/jira-table";
import { SalesforceTable } from "@/components/salesforce-table";
import { ConfigStatus } from "@/components/config-status";

import type { JiraTicket, SalesforceOpportunity } from "@/lib/types";

interface JiraResponse {
  tickets: JiraTicket[];
  total: number;
  configured: boolean;
  error?: string;
}

interface SalesforceResponse {
  dueDiligence: SalesforceOpportunity[];
  standingApart: SalesforceOpportunity[];
  totalDueDiligence: number;
  totalStandingApart: number;
  configured: boolean;
  error?: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function Dashboard() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const {
    data: jiraData,
    error: jiraError,
    isLoading: jiraLoading,
    mutate: mutateJira,
  } = useSWR<JiraResponse>("/api/jira", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 5 * 60 * 1000,
    onSuccess: () => setLastUpdated(new Date()),
  });

  const {
    data: sfData,
    error: sfError,
    isLoading: sfLoading,
    mutate: mutateSf,
  } = useSWR<SalesforceResponse>("/api/salesforce", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 5 * 60 * 1000,
    onSuccess: () => setLastUpdated(new Date()),
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([mutateJira(), mutateSf()]);
    setLastUpdated(new Date());
    setIsRefreshing(false);
  }, [mutateJira, mutateSf]);

  const jiraTickets = jiraData?.tickets || [];
  const sfDueDiligence = sfData?.dueDiligence || [];
  const sfStandingApart = sfData?.standingApart || [];
  const jiraConfigured = jiraData?.configured ?? true;
  const sfConfigured = sfData?.configured ?? true;

  // Debug: log raw API responses
  console.log("[v0] sfData raw response:", JSON.stringify(sfData, null, 2)?.substring(0, 1000));
  console.log("[v0] sfError:", sfError);
  console.log("[v0] sfLoading:", sfLoading);

  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/api/debug-sheets")
      .then((r) => r.json())
      .then((d) => setDebugInfo(d))
      .catch((e) => setDebugInfo({ fetchError: String(e) }));
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          {/* Temporary debug panel */}
          <details className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-4">
            <summary className="cursor-pointer text-sm font-medium text-yellow-600">
              Debug: Google Sheets Connection Diagnostics
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded bg-background p-3 text-xs font-mono text-foreground">
              {debugInfo ? JSON.stringify(debugInfo, null, 2) : "Loading diagnostics..."}
            </pre>
            <div className="mt-3 rounded bg-background p-3 text-xs font-mono text-foreground">
              <p className="font-semibold">SF API Response Summary:</p>
              <pre className="mt-1 max-h-40 overflow-auto">
                {sfData ? JSON.stringify({ error: sfData.error, configured: sfData.configured, source: (sfData as Record<string, unknown>).source, ddCount: sfData.dueDiligence?.length, saCount: sfData.standingApart?.length }, null, 2) : sfLoading ? "Loading..." : "No data"}
              </pre>
              {sfError && <p className="mt-1 text-red-500">SWR Error: {String(sfError)}</p>}
            </div>
            {(sfData as Record<string, unknown>)?.debug && (
              <div className="mt-3 rounded border border-red-400/40 bg-red-500/5 p-3 text-xs font-mono text-foreground">
                <p className="font-semibold text-red-500">FILTER DEBUG (filters matched 0 rows - showing actual sheet values):</p>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify((sfData as Record<string, unknown>).debug, null, 2)}
                </pre>
              </div>
            )}
          </details>
          <DashboardHeader
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing || jiraLoading || sfLoading}
            lastUpdated={lastUpdated}
          />

          <ConfigStatus
            jiraConfigured={jiraConfigured}
            sfConfigured={sfConfigured}
          />

          <StatsCards
            jiraTickets={jiraTickets}
            sfDueDiligence={sfDueDiligence}
            sfStandingApart={sfStandingApart}
            jiraConfigured={jiraConfigured}
            sfConfigured={sfConfigured}
          />

          <Tabs defaultValue="jira" className="w-full">
            <TabsList className="bg-secondary">
              <TabsTrigger
                value="jira"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                Jira Tickets
                {jiraTickets.length > 0 && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    {jiraTickets.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="due-diligence"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                Due Diligence
                {sfDueDiligence.length > 0 && (
                  <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                    {sfDueDiligence.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="standing-apart"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                Standing Apart
                {sfStandingApart.length > 0 && (
                  <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                    {sfStandingApart.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="jira">
              <div className="mt-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-medium text-foreground">
                    Jira Filter Results
                  </h2>
                  {jiraData?.total !== undefined && jiraConfigured && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {jiraData.total} total
                    </span>
                  )}
                </div>
                <JiraTable
                  tickets={jiraTickets}
                  isLoading={jiraLoading}
                  error={
                    jiraError
                      ? "Failed to connect to Jira"
                      : jiraData?.error || null
                  }
                  configured={jiraConfigured}
                />
              </div>
            </TabsContent>

            <TabsContent value="due-diligence">
              <div className="mt-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-medium text-foreground">
                    Due Diligence Opportunities
                  </h2>
                  {sfConfigured && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {sfDueDiligence.length} total
                    </span>
                  )}
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Opportunities with Access Method (L): API or Data Feed in Due Diligence phase
                </p>
                <SalesforceTable
                  opportunities={sfDueDiligence}
                  isLoading={sfLoading}
                  error={
                    sfError
                      ? "Failed to load data"
                      : sfData?.error || null
                  }
                  configured={sfConfigured}
                />
              </div>
            </TabsContent>

            <TabsContent value="standing-apart">
              <div className="mt-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-medium text-foreground">
                    Standing Apart Opportunities
                  </h2>
                  {sfConfigured && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {sfStandingApart.length} total
                    </span>
                  )}
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Opportunities with Access Method (L): API or Data Feed in Standing Apart phase
                </p>
                <SalesforceTable
                  opportunities={sfStandingApart}
                  isLoading={sfLoading}
                  error={
                    sfError
                      ? "Failed to load data"
                      : sfData?.error || null
                  }
                  configured={sfConfigured}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}
