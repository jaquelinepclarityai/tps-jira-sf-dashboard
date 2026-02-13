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
  if (id.length !== 15) return id; // Return original if not 15 or 18

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

function getOpportunityID(row: Record<string, string>): string {
  // Strategy 1: Look for exact known ID columns
  const exactCandidates = [
    "Opportunity ID",
    "Opportunity Id",
    "OPPORTUNITY_ID",
    "Id",
    "ID",
    "Opp Id"
  ];

  let id = findColumn(row, exactCandidates, true); // Strict Mode

  // Validate: Must look like an Opp ID (starts with 006)
  if (id && id.trim().length >= 15 && id.trim().startsWith("006")) {
    return to18CharId(id);
  }

  // Strategy 2: Brute Force Scan
  // If the named column failed, look at EVERY value in the row.
  // We return the first value that looks exactly like a Salesforce Opportunity ID.
  const allValues = Object.values(row);
  const foundId = allValues.find(val => {
    const v = val.trim();
    // Must start with 006 and be 15 or 18 chars
    return v.startsWith("006") && (v.length === 15 || v.length === 18);
  });

  if (foundId) {
    return to18CharId(foundId);
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

function mapToOpportunity(
  row: Record<string, string>,
  idx: number
): SalesforceOpportunity {

  const oppId = getOpportunityID(row);

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
      }).map(mapToOpportunity);
    };

    const dueDiligence = filterOpps("due diligence");
    const standingApart = filterOpps("standing apart");

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