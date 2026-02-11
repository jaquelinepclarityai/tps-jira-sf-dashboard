import { NextResponse } from "next/server";
import type { SalesforceOpportunity } from "@/lib/types";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";
const SHEET_GID = "94718738";

// ──────────────────────────────────────────────
// Google Sheets API via API Key (simple, reliable)
// ──────────────────────────────────────────────
async function fetchViaAPIKey(): Promise<string[][] | null> {
  const apiKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!apiKey) return null;

  // If this looks like a PEM private key rather than an API key, skip
  if (apiKey.includes("BEGIN PRIVATE KEY") || apiKey.length > 100) return null;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}?key=${apiKey}`;
  console.log("[v0] Fetching via API Key...");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[v0] API Key fetch error:", res.status, errText.substring(0, 300));
    return null;
  }

  const data = await res.json();
  console.log("[v0] API Key fetch: got", data.values?.length ?? 0, "rows");
  if (data.values && data.values.length > 0) {
    console.log("[v0] API Key headers:", JSON.stringify(data.values[0]));
  }
  return (data.values as string[][]) || null;
}

// ──────────────────────────────────────────────
// Google Sheets API via Service Account JWT
// ──────────────────────────────────────────────
async function fetchViaServiceAccount(): Promise<string[][] | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !rawKey) return null;
  // Only use this path if the key looks like a PEM private key
  if (!rawKey.includes("BEGIN PRIVATE KEY") && rawKey.length < 100) return null;

  const { google } = await import("googleapis");
  const privateKey = rawKey.replace(/\\n/g, "\n");

  console.log("[v0] Authenticating with service account:", email);
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

  console.log("[v0] Service account fetch:", res.data.values?.length ?? 0, "rows");
  return (res.data.values as string[][]) || null;
}

// ──────────────────────────────────────────────
// CSV fallback (unauthenticated, can be throttled)
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

async function fetchViaCSV(): Promise<Record<string, string>[] | null> {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB_NAME)}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
  ];

  for (const csvUrl of urls) {
    try {
      const res = await fetch(csvUrl, {
        cache: "no-store",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,text/plain,*/*",
        },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          console.log("[v0] CSV fallback returned HTML from:", csvUrl);
          continue;
        }
        const rows = parseCSV(text);
        if (rows.length > 0) {
          console.log("[v0] CSV fallback: got", rows.length, "rows from:", csvUrl);
          console.log("[v0] CSV headers:", Object.keys(rows[0]).join(" | "));
          return rows;
        }
      }
    } catch (err) {
      console.log("[v0] CSV fallback error:", err);
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
    // Try exact match (case-insensitive)
    const exactKey = Object.keys(row).find(
      (k) => k.toLowerCase().trim() === candidate.toLowerCase().trim()
    );
    if (exactKey && row[exactKey]) return row[exactKey];
  }
  // Try partial/contains match as last resort
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
      "Access_Method"
    ),
    amount: parseAmount(
      findColumn(row, "Amount", "Opp Amount", "Total Amount")
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

    console.log("[v0] === Starting Google Sheets fetch ===");

    // 1. Try API Key (simple key like AIza...)
    try {
      const apiKeyData = await fetchViaAPIKey();
      if (apiKeyData && apiKeyData.length > 1) {
        rows = rowsToRecords(apiKeyData);
        source = "api-key";
        console.log("[v0] API Key method: got", rows.length, "data rows");
      }
    } catch (err) {
      console.error("[v0] API Key method error:", err);
    }

    // 2. Try Service Account JWT
    if (!rows || rows.length === 0) {
      try {
        const saData = await fetchViaServiceAccount();
        if (saData && saData.length > 1) {
          rows = rowsToRecords(saData);
          source = "service-account";
          console.log("[v0] Service account method: got", rows.length, "data rows");
        }
      } catch (err) {
        console.error("[v0] Service account method error:", err);
      }
    }

    // 3. Fall back to CSV
    if (!rows || rows.length === 0) {
      console.log("[v0] Falling back to CSV export...");
      rows = await fetchViaCSV();
      source = "csv";
      if (rows) {
        console.log("[v0] CSV fallback: got", rows.length, "rows");
      }
    }

    // 4. Nothing worked
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No data available from Google Sheets. Check that the API key or service account has access.",
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

    // Debug: log ALL column headers and unique stages/access methods
    if (rows.length > 0) {
      console.log("[v0] All column headers:", JSON.stringify(Object.keys(rows[0])));
      console.log("[v0] First data row:", JSON.stringify(rows[0]).substring(0, 500));
    }

    const uniqueStages = new Set<string>();
    const uniqueAccessMethods = new Set<string>();
    rows.forEach((row) => {
      const stage = findColumn(row, "Stage", "StageName", "Stage Name");
      const access = findColumn(
        row,
        "Access Method (L)",
        "Access_Method_L__c",
        "Access Method L",
        "Access Method",
        "Access_Method"
      );
      if (stage) uniqueStages.add(stage);
      if (access) uniqueAccessMethods.add(access);
    });
    console.log("[v0] Total rows:", rows.length);
    console.log("[v0] Unique stages:", JSON.stringify([...uniqueStages]));
    console.log("[v0] Unique access methods:", JSON.stringify([...uniqueAccessMethods]));

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

    console.log("[v0] Due Diligence matches:", dueDiligence.length);
    console.log("[v0] Standing Apart matches:", standingApart.length);

    // If both are 0 but we have rows, also show unfiltered count for debug
    if (dueDiligence.length === 0 && standingApart.length === 0 && rows.length > 0) {
      console.log("[v0] WARNING: Filters matched 0 rows out of", rows.length, "total rows.");
      console.log("[v0] This likely means column names or stage/access values don't match expectations.");
      
      // Return ALL rows as debug data so user can see what's there
      const allOpportunities = rows.map(mapToOpportunity);
      return NextResponse.json({
        dueDiligence: allOpportunities,
        standingApart: [],
        totalDueDiligence: allOpportunities.length,
        totalStandingApart: 0,
        configured: true,
        source,
        debug: {
          note: "Filters matched 0 rows. Showing all rows unfiltered for debugging.",
          totalRawRows: rows.length,
          columnHeaders: rows.length > 0 ? Object.keys(rows[0]) : [],
          uniqueStages: [...uniqueStages],
          uniqueAccessMethods: [...uniqueAccessMethods],
        },
      });
    }

    return NextResponse.json({
      dueDiligence: dueDiligence.map(mapToOpportunity),
      standingApart: standingApart.map(mapToOpportunity),
      totalDueDiligence: dueDiligence.length,
      totalStandingApart: standingApart.length,
      configured: true,
      source,
    });
  } catch (error) {
    console.error("[v0] Google Sheets fetch error:", error);
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
