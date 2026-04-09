import { fetchSchedule } from "@/lib/google-sheets";
import { NextResponse } from "next/server";

export const revalidate = 60; // Cache for 60 seconds

export async function GET() {
  try {
    const schedule = await fetchSchedule();
    return NextResponse.json(schedule);
  } catch (error) {
    console.error("Failed to fetch schedule:", error);
    return NextResponse.json(
      { error: "Failed to fetch schedule data" },
      { status: 500 }
    );
  }
}
