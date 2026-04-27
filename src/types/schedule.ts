export interface ScheduleEntry {
  date: string; // ISO date string (YYYY-MM-DD)
  dayOfWeek: string;
  confirmationStatus: "confirmed" | "pending" | "unconfirmed";
  teakNight: boolean;
  activity: string;
  location: string;
  coPilot: string;
  flightInfo: string;
  departure: {
    airport: string;
    fbo: string;
    time: string;
  };
  arrival: {
    airport: string;
    fbo: string;
    time: string;
  };
  internationalPax: string;
  groundTransport: string;
  lodging: string;
  comments: string;
  rowId: string;
}

export type DetailLevel = "none" | "single" | "dual_day" | "dual";

export interface Assignment {
  id: string;
  date: string;
  rowId: string | null;
  epoId: string;
  assignedBy: string;
  createdAt: string;
}

export interface DateSetting {
  id: string;
  date: string;
  detailLevel: DetailLevel;
  updatedBy: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: "epo" | "management";
  createdAt: string;
}

export interface DashboardEntry extends ScheduleEntry {
  detailLevel: DetailLevel;
  assignedEpos: Pick<Profile, "id" | "fullName" | "email">[];
  isPast?: boolean;
  isThisWeek?: boolean;
  isNextWeek?: boolean;
  pickupLeg?: TravelLeg;
  dropoffLeg?: TravelLeg;
  transitions: Transition[];
}

export interface TravelLeg {
  date: string; // ISO YYYY-MM-DD
  action: "Pick up" | "Drop off";
  location: string;
  time: string;
  companion: string;
  companionPrePositionFlight: string;
  teakFlight: string;
  companionReturnFlight: string;
}

export type Principal = "greg" | "krista";

export interface Transition {
  person: Principal;
  title: string;     // event summary with leading "TT:" stripped + trimmed
  startsAt: string;  // ISO 8601 with offset, e.g. "2026-04-30T09:30:00-07:00"
  tz: string;        // event's IANA timezone, e.g. "America/Los_Angeles"
  eventId: string;   // Google Calendar event id (instance id for recurring) — React key
}
