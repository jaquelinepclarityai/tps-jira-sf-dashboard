import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { SalesforceOpportunity } from "@/lib/types";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";

// ──────────────────────────────────────────────
// Google Sheets API (authenticated, reliable)
// ──────────────────────────────────────────────
async function fetchViaAPI(): Promise<string[][] | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !rawKey) {
    console.log(
      "[v0] Google service account not configured – email:",
      !!email,
      "key:",
      !!rawKey
    );
    return null;
  }

  // Vercel stores multi-line env vars with escaped newlines
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TAB_NAME}'`,
  });

  return (res.data.values as string[][]) || null;
}

// ──────────────────────────────────────────────
// CSV fallback (unauthenticated, can be throttled)
// ──────────────────────────────────────────────
const SHEET_GID = "94718738";

function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      if (insideQuotes && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });
    return row;
  });
}

async function fetchViaCSV(): Promise<Record<string, string>[] | null> {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB_NAME)}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
  ];

  for (const csvUrl of urls) {
    try {
      const res = await fetch(csvUrl, {
        next: { revalidate: 0 },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,text/plain,*/*",
        },
      });
      if (res.ok) {
        const text = await res.text();
        // Google sometimes returns an HTML login/CAPTCHA page instead of CSV
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          console.log("[v0] CSV fallback returned HTML instead of CSV from:", csvUrl);
          continue;
        }
        const rows = parseCSV(text);
        if (rows.length > 0) return rows;
      } else {
        console.log("[v0] CSV fallback HTTP error:", res.status, "from:", csvUrl);
      }
    } catch (err) {
      console.log("[v0] CSV fallback fetch error:", err);
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function rowsToRecords(raw: string[][]): Record<string, string>[] {
  if (raw.length < 2) return [];
  const headers = raw[0];
  return raw.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });
    return row;
  });
}

function findColumn(
  row: Record<string, string>,
  ...candidates: string[]
): string {
  for (const candidate of candidates) {
    const key = Object.keys(row).find(
      (k) => k.toLowerCase().trim() === candidate.toLowerCase().trim()
    );
    if (key && row[key]) return row[key];
  }
  return "";
}

function parseAmount(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function hasApiOrDatafeed(row: Record<string, string>) {
  const accessMethodL = findColumn(
    row,
    "Access Method (L)",
    "Access_Method_L__c",
    "Access Method L"
  ).toLowerCase();
  return (
    accessMethodL.includes("api") ||
    accessMethodL.includes("data feed") ||
    accessMethodL.includes("datafeed")
  );
}

function mapToOpportunity(
  row: Record<string, string>,
  idx: number
): SalesforceOpportunity {
  return {
    id: findColumn(row, "Opportunity ID", "Id", "ID") || `row-${idx}`,
    name: findColumn(row, "Opportunity Name", "Name", "Opportunity"),
    stageName: findColumn(row, "Stage", "StageName", "Stage Name"),
    accessMethod: findColumn(
      row,
      "Access Method (L)",
      "Access_Method_L__c",
      "Access Method L"
    ),
    amount: parseAmount(
      findColumn(row, "Amount", "Opp Amount", "Total Amount")
    ),
    closeDate: findColumn(row, "Close Date", "CloseDate", "Close"),
    accountName: findColumn(
      row,
      "Account Name",
      "Account",
      "AccountName"
    ),
    ownerName: findColumn(
      row,
      "Opportunity Owner",
      "Owner",
      "Owner Name",
      "OwnerName"
    ),
    probability: parseAmount(
      findColumn(row, "Probability", "Probability (%)", "Win %")
    ),
    createdDate: findColumn(row, "Created Date", "CreatedDate", "Created"),
    lastModifiedDate: findColumn(
      row,
      "Last Modified Date",
      "LastModifiedDate",
      "Last Modified",
      "Modified Date"
    ),
    url: findColumn(row, "Opportunity ID", "Id", "ID")
      ? `https://clarityai.lightning.force.com/${findColumn(row, "Opportunity ID", "Id", "ID")}`
      : "",
  };
}

// ──────────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────────
export async function GET() {
  try {
    let rows: Record<string, string>[] | null = null;
    let source = "";

    // 1. Try authenticated Google Sheets API first (reliable)
    try {
      const apiData = await fetchViaAPI();
      if (apiData && apiData.length > 1) {
        rows = rowsToRecords(apiData);
        source = "api";
        console.log(`[v0] Google Sheets API: fetched ${rows.length} rows`);
      }
    } catch (apiErr) {
      console.error("[v0] Google Sheets API error:", apiErr);
    }

    // 2. Fall back to public CSV export
    if (!rows || rows.length === 0) {
      console.log("[v0] Falling back to CSV export...");
      rows = await fetchViaCSV();
      source = "csv";
      if (rows) {
        console.log(`[v0] CSV fallback: fetched ${rows.length} rows`);
      }
    }

    // 3. Neither method worked
    if (!rows || rows.length === 0) {
      const hasServiceAccount =
        !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

      return NextResponse.json(
        {
          error: hasServiceAccount
            ? "Google Sheets API returned no data. Make sure the service account has access to the sheet."
            : 'No data available. Add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY environment variables for reliable access, or ensure the sheet is shared as "Anyone with the link can view".',
          dueDiligence: [],
          standingApart: [],
          totalDueDiligence: 0,
          totalStandingApart: 0,
          configured: false,
          source: "none",
        },
        { status: 200 }
      );
    }

    const dueDiligence = rows.filter((row) => {
      const stage = findColumn(
        row,
        "Stage",
        "StageName",
        "Stage Name"
      ).toLowerCase();
      return stage.includes("due diligence") && hasApiOrDatafeed(row);
    });

    const standingApart = rows.filter((row) => {
      const stage = findColumn(
        row,
        "Stage",
        "StageName",
        "Stage Name"
      ).toLowerCase();
      return stage.includes("standing apart") && hasApiOrDatafeed(row);
    });

    return NextResponse.json({
      dueDiligence: dueDiligence.map(mapToOpportunity),
      standingApart: standingApart.map(mapToOpportunity),
      totalDueDiligence: dueDiligence.length,
      totalStandingApart: standingApart.length,
      configured: true,
      source,
    });
  } catch (error) {
    console.error("[v0] Salesforce/GSheets fetch error:", error);
    return NextResponse.json(
      {
        error: `Failed to fetch data: ${String(error)}`,
        dueDiligence: [],
        standingApart: [],
        totalDueDiligence: 0,
        totalStandingApart: 0,
        configured: true,
        source: "error",
      },
      { status: 200 }
    );
  }
}
