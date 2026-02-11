import { NextResponse } from "next/server";
import type { SalesforceOpportunity } from "@/lib/types";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";
const SHEET_GID = "94718738";

// ──────────────────────────────────────────────
// Google Sheets API via API Key
// ──────────────────────────────────────────────
async function fetchViaAPIKey(): Promise<string[][] | null> {
  const apiKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!apiKey) return null;
  if (apiKey.includes("BEGIN PRIVATE KEY") || apiKey.length > 100) return null;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}?key=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const data = await res.json();
  return (data.values as string[][]) || null;
}

// ──────────────────────────────────────────────
// Google Sheets API via Service Account JWT
// ──────────────────────────────────────────────
async function fetchViaServiceAccount(): Promise<string[][] | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  if (!rawKey.includes("BEGIN PRIVATE KEY") && rawKey.length < 100) return null;

  const { google } = await import("googleapis");
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
// CSV fallback with retry (unauthenticated)
// ──────────────────────────────────────────────
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

async function fetchSingleCSV(csvUrl: string): Promise<Record<string, string>[] | null> {
  const res = await fetch(csvUrl, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/csv,text/plain,*/*",
    },
  });
  if (!res.ok) return null;

  const text = await res.text();
  if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) return null;

  const rows = parseCSV(text);
  return rows.length > 0 ? rows : null;
}

async function fetchViaCSV(): Promise<Record<string, string>[] | null> {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB_NAME)}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
  ];

  // Try each URL with up to 2 retries per URL
  for (const csvUrl of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rows = await fetchSingleCSV(csvUrl);
        if (rows) return rows;
      } catch {
        // Wait before retry
        if (attempt < 1) await new Promise((r) => setTimeout(r, 1000));
      }
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
    const exactKey = Object.keys(row).find(
      (k) => k.toLowerCase().trim() === candidate.toLowerCase().trim()
    );
    if (exactKey && row[exactKey]) return row[exactKey];
  }
  for (const candidate of candidates) {
    const partialKey = Object.keys(row).find(
      (k) =>
        k.toLowerCase().trim().includes(candidate.toLowerCase().trim()) ||
        candidate.toLowerCase().trim().includes(k.toLowerCase().trim())
    );
    if (partialKey && row[partialKey]) return row[partialKey];
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
    "Access Method L",
    "Access Method",
    "Access_Method",
    "AccessMethod"
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
      "Access Method L",
      "Access Method",
      "Access_Method",
      "Product modules"
    ),
    amount: parseAmount(
      findColumn(row, "Opp ARR (Master) (converted)", "Amount", "Opp Amount", "Total Amount")
    ),
    closeDate: findColumn(row, "Close Date", "CloseDate", "Close"),
    accountName: findColumn(row, "Account Name", "Account", "AccountName"),
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
    createdDate: findColumn(row, "Contract Start Date", "Created Date", "CreatedDate", "Created"),
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

    // 1. Try API Key
    try {
      const apiKeyData = await fetchViaAPIKey();
      if (apiKeyData && apiKeyData.length > 1) {
        rows = rowsToRecords(apiKeyData);
        source = "api-key";
      }
    } catch {
      // API key method failed, try next
    }

    // 2. Try Service Account JWT
    if (!rows || rows.length === 0) {
      try {
        const saData = await fetchViaServiceAccount();
        if (saData && saData.length > 1) {
          rows = rowsToRecords(saData);
          source = "service-account";
        }
      } catch {
        // Service account method failed, try next
      }
    }

    // 3. Fall back to CSV with retry
    if (!rows || rows.length === 0) {
      rows = await fetchViaCSV();
      source = "csv";
    }

    // 4. Nothing worked
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        {
          error: "No data available from Google Sheets.",
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

    // Check if Access Method column exists in this sheet
    const hasAccessMethodColumn = rows.some((row) => {
      const access = findColumn(
        row,
        "Access Method (L)",
        "Access_Method_L__c",
        "Access Method L",
        "Access Method",
        "Access_Method"
      );
      return access !== "";
    });

    // Filter by stage (and access method if column exists)
    const dueDiligence = rows.filter((row) => {
      const stage = findColumn(row, "Stage", "StageName", "Stage Name").toLowerCase();
      const stageMatch = stage.includes("due diligence");
      if (!hasAccessMethodColumn) return stageMatch;
      return stageMatch && hasApiOrDatafeed(row);
    });

    const standingApart = rows.filter((row) => {
      const stage = findColumn(row, "Stage", "StageName", "Stage Name").toLowerCase();
      const stageMatch = stage.includes("standing apart");
      if (!hasAccessMethodColumn) return stageMatch;
      return stageMatch && hasApiOrDatafeed(row);
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
