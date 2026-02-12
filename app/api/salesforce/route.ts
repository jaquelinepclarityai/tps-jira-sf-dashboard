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
  // Handle European format: "1.234.567,89" -> "1234567.89"
  // Handle US format: "1,234,567.89" -> "1234567.89"
  let cleaned = value.replace(/[^0-9.,-]/g, "");
  // If last separator is a comma followed by 1-2 digits (European decimal), convert
  const europeanMatch = cleaned.match(/^([0-9.]*),(\d{1,2})$/);
  if (europeanMatch) {
    cleaned = europeanMatch[1].replace(/\./g, "") + "." + europeanMatch[2];
  } else {
    // US format or no decimals: remove commas
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
  const oppId = findColumn(row, "Opportunity ID", "OPPORTUNITY_ID", "Q1");
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
    if (mappedDD.length > 0) {
      console.log("[v0] Sample DD opp:", JSON.stringify({ id: mappedDD[0].id, url: mappedDD[0].url, accountName: mappedDD[0].accountName }));
    }
    if (mappedSA.length > 0) {
      console.log("[v0] Sample SA opp:", JSON.stringify({ id: mappedSA[0].id, url: mappedSA[0].url, accountName: mappedSA[0].accountName }));
    }

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
