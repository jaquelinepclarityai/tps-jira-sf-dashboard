import { NextResponse } from "next/server";
import type { SalesforceOpportunity } from "@/lib/types";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";
const SHEET_GID = "94718738";

// ──────────────────────────────────────────────
// 15-to-18 Character Converter
// ──────────────────────────────────────────────
function to18CharId(id: string): string {
  if (!id) return "";
  id = id.trim();
  if (id.length === 18) return id;
  if (id.length !== 15) return id;

  let suffix = "";
  for (let i = 0; i < 3; i++) {
    let flags = 0;
    for (let j = 0; j < 5; j++) {
      const char = id.charAt(i * 5 + j);
      if (char >= "A" && char <= "Z") {
        flags += 1 << j;
      }
    }
    suffix += "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345".charAt(flags);
  }
  return id + suffix;
}

// ──────────────────────────────────────────────
// ROBUST CSV PARSER
// ──────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  const cleanText = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if (char === "\n" && !insideQuotes) {
      currentRow.push(currentVal.trim());
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    rows.push(currentRow);
  }

  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map((values) => {
    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) rowObj[header] = values[idx] || "";
    });
    return rowObj;
  });
}

// ──────────────────────────────────────────────
// Fetchers
// ──────────────────────────────────────────────
async function fetchViaServiceAccount(): Promise<Record<string, string>[] | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey || !rawKey.includes("BEGIN PRIVATE KEY")) return null;

  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email,
      key: rawKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${TAB_NAME}'`,
    });
    return rowsToRecords(res.data.values as string[][]);
  } catch (e) {
    console.error("Service Account Error:", e);
    return null;
  }
}

async function fetchViaCSV(): Promise<Record<string, string>[] | null> {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
  ];

  for (const csvUrl of urls) {
    try {
      const res = await fetch(csvUrl, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        if (!text.trim().startsWith("<")) {
          const rows = parseCSV(text);
          if (rows.length > 0) return rows;
        }
      }
    } catch (e) { console.error("CSV fetch failed", e); }
  }
  return null;
}

function rowsToRecords(raw: string[][]): Record<string, string>[] {
  if (!raw || raw.length < 2) return [];
  const headers = raw[0];
  return raw.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });
    return row;
  });
}

// ──────────────────────────────────────────────
// Column Finders
// ──────────────────────────────────────────────
function findColumn(
  row: Record<string, string>,
  candidates: string[],
  strict = false
): string {
  const rowKeys = Object.keys(row);

  // 1. Exact Match
  for (const candidate of candidates) {
    const exactKey = rowKeys.find(
      (k) => k.toLowerCase().trim() === candidate.toLowerCase().trim()
    );
    if (exactKey) return row[exactKey];
  }

  // 2. Partial Match (Only if strict mode is OFF)
  if (!strict) {
    for (const candidate of candidates) {
      const partialKey = rowKeys.find(
        (k) => k.toLowerCase().trim().includes(candidate.toLowerCase().trim())
      );
      if (partialKey) return row[partialKey];
    }
  }
  return "";
}

// ──────────────────────────────────────────────
// IMPROVED: Validate Salesforce Opportunity ID
// ──────────────────────────────────────────────
function isValidOpportunityId(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();

  // Must start with 006 (Opportunity prefix in Salesforce)
  if (!trimmed.startsWith("006")) return false;

  // Must be exactly 15 or 18 characters
  if (trimmed.length !== 15 && trimmed.length !== 18) return false;

  // Must contain only alphanumeric characters
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) return false;

  return true;
}

function getOpportunityID(row: Record<string, string>): string {
  // Strategy 1: Look for exact known ID columns
  const exactCandidates = [
    "Opportunity ID",
    "Opportunity Id",
    "OpportunityId",
    "OPPORTUNITY_ID",
    "Opp ID",
    "Opp Id",
    "OppId",
    "Id",
    "ID",
  ];

  // Try exact column matches first
  for (const candidate of exactCandidates) {
    const id = findColumn(row, [candidate], true);
    if (id && isValidOpportunityId(id)) {
      return to18CharId(id.trim());
    }
  }

  // Strategy 2: Scan all column names that contain "id" or "opp"
  const rowKeys = Object.keys(row);
  const idLikeKeys = rowKeys.filter(key => {
    const lower = key.toLowerCase();
    return (lower.includes("id") || lower.includes("opp")) &&
      !lower.includes("account") &&
      !lower.includes("owner");
  });

  for (const key of idLikeKeys) {
    const value = row[key];
    if (value && isValidOpportunityId(value)) {
      return to18CharId(value.trim());
    }
  }

  // Strategy 3: Brute force scan all values
  const allEntries = Object.entries(row);
  for (const [key, value] of allEntries) {
    if (value && isValidOpportunityId(value)) {
      console.log(`Found Opp ID in column "${key}":`, value);
      return to18CharId(value.trim());
    }
  }

  console.warn("No valid Opportunity ID found in row:", Object.keys(row));
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

function mapToOpportunity(
  row: Record<string, string>,
  idx: number
): SalesforceOpportunity {

  const oppId = getOpportunityID(row);

  // Debug logging for Due Diligence opportunities without IDs
  if (!oppId) {
    const oppName = findColumn(row, ["Opportunity Name", "Name", "Opportunity"]);
    console.warn(`Missing Opp ID for: ${oppName || `row-${idx}`}`);
    console.warn("Available columns:", Object.keys(row));
  }

  return {
    id: oppId || `row-${idx}`,
    name: findColumn(row, ["Opportunity Name", "Name", "Opportunity"]),
    stageName: findColumn(row, ["Stage", "StageName", "Stage Name"]),
    accessMethod: findColumn(row, ["Access Method (Opp)", "Access_Method_Opp__c", "Access Method"]),
    amount: parseAmount(findColumn(row, ["Opp ARR (Master) (converted)", "Amount"])),
    closeDate: findColumn(row, ["Close Date", "CloseDate", "Close"]),
    accountName: findColumn(row, ["Account Name", "Account", "AccountName"]),
    ownerName: findColumn(row, ["Opportunity Owner", "Owner", "Owner Name"]),
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

    // 1. Service Account
    rows = await fetchViaServiceAccount();
    if (rows) source = "service-account";

    // 2. CSV Fallback
    if (!rows) {
      rows = await fetchViaCSV();
      if (rows) source = "csv";
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No data", configured: false }, { status: 200 });
    }

    // Filtering Logic
    const hasAccessMethod = rows.some(r => findColumn(r, ["Access Method", "Access_Method_L__c"]));

    const filterOpps = (stageKeyword: string) => {
      return rows!.filter(row => {
        const stage = findColumn(row, ["Stage", "StageName"]).toLowerCase();
        const matchesStage = stage.includes(stageKeyword);

        if (!hasAccessMethod) return matchesStage;

        const method = findColumn(row, ["Access Method", "Access_Method_L__c"]).toLowerCase();
        const isApiOrFeed = method.includes("api") || method.includes("data feed") || method.includes("datafeed");

        return matchesStage && isApiOrFeed;
      }).map((row, idx) => mapToOpportunity(row, idx));
    };

    const dueDiligence = filterOpps("due diligence");
    const standingApart = filterOpps("standing apart");

    // Debug: Log opportunities without valid IDs
    const ddMissingIds = dueDiligence.filter(opp => !opp.url || opp.id.startsWith('row-'));
    const saMissingIds = standingApart.filter(opp => !opp.url || opp.id.startsWith('row-'));

    if (ddMissingIds.length > 0) {
      console.warn(`Due Diligence: ${ddMissingIds.length} opportunities missing IDs`);
    }
    if (saMissingIds.length > 0) {
      console.warn(`Standing Apart: ${saMissingIds.length} opportunities missing IDs`);
    }

    return NextResponse.json({
      dueDiligence,
      standingApart,
      totalDueDiligence: dueDiligence.length,
      totalStandingApart: standingApart.length,
      configured: true,
      source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error), configured: true, source: "error" },
      { status: 200 }
    );
  }
}