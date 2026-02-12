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
// ROBUST CSV PARSER (Handles newlines in cells)
// ──────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  // Clean up BOM and standardizes line endings
  const cleanText = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote ("") inside a quoted string
        currentVal += '"';
        i++; // skip next char
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      // End of cell
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if (char === "\n" && !insideQuotes) {
      // End of row
      currentRow.push(currentVal.trim());
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }

  // Push the final row if exists
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    rows.push(currentRow);
  }

  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map((values) => {
    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      // Use header as key, avoid empty keys
      if (header) rowObj[header] = values[idx] || "";
    });
    return rowObj;
  });
}

async function fetchSingleCSV(csvUrl: string): Promise<Record<string, string>[] | null> {
  const res = await fetch(csvUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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

  for (const csvUrl of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rows = await fetchSingleCSV(csvUrl);
        if (rows) return rows;
      } catch {
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

/**
 * FIXED: Strictly matches columns. 
 * Prevents "Source Opportunity ID" from matching "Opportunity ID".
 * Prioritizes Exact Match > Starts With.
 */
function findColumn(
  row: Record<string, string>,
  ...candidates: string[]
): string {
  const rowKeys = Object.keys(row);

  // 1. Exact match (Priority)
  for (const candidate of candidates) {
    const exactKey = rowKeys.find(
      (k) => k.toLowerCase().trim() === candidate.toLowerCase().trim()
    );
    if (exactKey && row[exactKey]) return row[exactKey];
  }

  // 2. Starts With (Safe partial match)
  // e.g. "Opportunity ID (18 char)" STARTS WITH "Opportunity ID" -> Match
  // e.g. "Source Opportunity ID" DOES NOT start with "Opportunity ID" -> No Match
  for (const candidate of candidates) {
    const partialKey = rowKeys.find(
      (k) => k.toLowerCase().trim().startsWith(candidate.toLowerCase().trim())
    );
    if (partialKey && row[partialKey]) return row[partialKey];
  }

  return "";
}

function parseAmount(value: string): number | null {
  if (!value) return null;
  let cleaned = value.replace(/[^0-9.,-]/g, "");
  const europeanMatch = cleaned.match(/^([0-9.]*),(\d{1,2})$/);
  if (europeanMatch) {
    cleaned = europeanMatch[1].replace(/\./g, "") + "." + europeanMatch[2];
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function hasApiOrDatafeed(row: Record<string, string>) {
  const accessMethod = findColumn(
    row,
    "Access Method (Opp)",
    "Access_Method_Opp__c",
    "Access Method",
    "Access_Method",
    "Access Method (L)",
    "Access_Method_L__c"
  ).toLowerCase();
  return (
    accessMethod.includes("api") ||
    accessMethod.includes("data feed") ||
    accessMethod.includes("datafeed")
  );
}

function mapToOpportunity(
  row: Record<string, string>,
  idx: number
): SalesforceOpportunity {
  // Ordered by priority. Removed generic "Id" to avoid matching "Account Id"
  const oppId = findColumn(row, "Opportunity ID", "OPPORTUNITY_ID", "Opp Id", "Q1");

  return {
    id: oppId || `row-${idx}`,
    name: findColumn(row, "Opportunity Name", "Name", "Opportunity"),
    stageName: findColumn(row, "Stage", "StageName", "Stage Name"),
    accessMethod: findColumn(
      row,
      "Access Method (Opp)",
      "Access_Method_Opp__c",
      "Access Method",
      "Access_Method"
    ),
    amount: parseAmount(
      findColumn(row, "Opp ARR (Master) (converted)", "Amount", "Opp Amount")
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
    probability: null,
    createdDate: "",
    lastModifiedDate: "",
    url: oppId
      ? `https://clarityai.lightning.force.com/lightning/r/Opportunity/${oppId}/view`
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

    const mappedDD = dueDiligence.map(mapToOpportunity);
    const mappedSA = standingApart.map(mapToOpportunity);

    return NextResponse.json({
      dueDiligence: mappedDD,
      standingApart: mappedSA,
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