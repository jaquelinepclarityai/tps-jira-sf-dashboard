import { NextResponse } from "next/server";
import type { SalesforceOpportunity } from "@/lib/types";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const SHEET_GID = "94718738";
const TAB_NAME = "SF Opps info";

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

export async function GET() {
  try {
    const urls = [
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB_NAME)}`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
    ];

    let response: Response | null = null;
    let lastError = "";

    for (const csvUrl of urls) {
      try {
        const res = await fetch(csvUrl, {
          next: { revalidate: 0 },
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (res.ok) {
          response = res;
          break;
        }
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = String(err);
      }
    }

    if (!response) {
      return NextResponse.json(
        {
          error: `Failed to fetch Google Sheet. Make sure the sheet is shared as "Anyone with the link can view". (${lastError})`,
          dueDiligence: [],
          standingApart: [],
          totalDueDiligence: 0,
          totalStandingApart: 0,
          configured: false,
        },
        { status: 200 }
      );
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

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

    return NextResponse.json({
      dueDiligence: dueDiligence.map(mapToOpportunity),
      standingApart: standingApart.map(mapToOpportunity),
      totalDueDiligence: dueDiligence.length,
      totalStandingApart: standingApart.length,
      configured: true,
    });
  } catch (error) {
    console.error("GSheets fetch error:", error);
    return NextResponse.json(
      {
        error: `Failed to fetch Google Sheet data: ${String(error)}`,
        dueDiligence: [],
        standingApart: [],
        totalDueDiligence: 0,
        totalStandingApart: 0,
        configured: true,
      },
      { status: 200 }
    );
  }
}
