export interface ScheduleEntry {
  date: string; // ISO date string (YYYY-MM-DD)
  dayOfWeek: string;
  confirmationStatus: "confirmed" | "pending" | "unconfirmed";
  teakNight: boolean;
  activity: string;
  location: string;
  transitions: string;
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
}
