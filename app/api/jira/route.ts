import { NextResponse } from "next/server";
import type { JiraTicket } from "@/lib/types";

export async function GET() {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const filterId = process.env.JIRA_FILTER_ID;

  if (!baseUrl || !email || !apiToken || !filterId) {
    return NextResponse.json(
      {
        error: "Missing Jira configuration",
        tickets: [],
        configured: false,
      },
      { status: 200 }
    );
  }

  try {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

    const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql: `filter=${filterId}`,
        maxResults: 100,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "reporter",
          "creator",
          "created",
          "updated",
          "duedate",
          "customfield_10448",
          "issuetype",
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Jira API error:", response.status, errorText);
      return NextResponse.json(
        {
          error: `Jira API error: ${response.status}`,
          errorDetail: errorText.substring(0, 300),
          tickets: [],
          configured: true,
        },
        { status: 200 }
      );
    }

    const data = await response.json();

    const tickets: JiraTicket[] = (data.issues || []).map(
      (issue: {
        id: string;
        key: string;
        fields: {
          summary: string;
          status: { name: string };
          priority: { name: string } | null;
          assignee: { displayName: string } | null;
          reporter: { displayName: string } | null;
          creator: { displayName: string } | null;
          created: string;
          updated: string;
          duedate: string | null;
          customfield_10448: string | null;
          issuetype: { name: string };
        };
      }) => ({
        id: issue.id,
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || "Unknown",
        priority: issue.fields.priority?.name || "None",
        assignee: issue.fields.assignee?.displayName || null,
        reporter: issue.fields.reporter?.displayName || "Unknown",
        owner:
          issue.fields.owner?.displayName ||
          issue.fields.reporter?.displayName ||
          null,
        created: issue.fields.created,
        updated: issue.fields.updated,
        dueDate: issue.fields.customfield_10448 || issue.fields.duedate || null,
        type: issue.fields.issuetype?.name || "Task",
        url: `${baseUrl}/browse/${issue.key}`,
      })
    );

    return NextResponse.json({
      tickets,
      total: data.total || tickets.length,
      configured: true,
    });
  } catch (error) {
    console.error("Jira fetch error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch Jira tickets",
        errorDetail: String(error),
        tickets: [],
        configured: true,
      },
      { status: 200 }
    );
  }
}
