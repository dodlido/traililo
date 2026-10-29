// Trailbook data model. Plain types only, so it runs in Node and in the future React app.
// Dates are ISO strings (YYYY-MM-DD). Distances in km, elevation in metres, durations in minutes.

export type Country = 'AR' | 'CL';

export type LinkType = 'alltrails' | 'mapsme' | 'getyourguide' | 'airbnb' | 'booking' | 'other';

/** A place on the map. Everything is town-level or estimated until you refine it. */
export interface Point {
  lat: number;
  lon: number;
  approx?: boolean;
}

/** A reference to something outside the app. The sheet names the source but has no URL yet. */
export interface Link {
  type: LinkType;
  label: string;
  url?: string;
}

export type BookingSource = 'airbnb' | 'getyourguide' | 'unspecified';

export interface BookingInfo {
  bookedBy?: string; 
  source: BookingSource;
  confirmationCode?: string; // to be filled in later
}

export type TransportMode = 'flight' | 'bus' | 'drive' | 'ferry' | 'taxi';

export interface Leg {
  mode: TransportMode;
  from?: string;
  to?: string;
  durationMin?: number;
  distanceKm?: number;
  note?: string;
  fromPoint?: Point;
  toPoint?: Point;
}

interface EntryBase {
  id: string;
  title: string;
  /** Marked optional when the sheet says "if we want" or "if you have time". */
  optional?: boolean;
  notes: string[];
  /** Flags like "book in advance" or "no kayaking if windy". */
  warnings: string[];
  links: Link[];
  booking?: BookingInfo;
  /** Where on the map this happens, when known. Otherwise the day's point is used. */
  at?: Point;
  /** Filled in by the importer to close a gap in the sheet (not something you planned). */
  assumed?: boolean;
}

export interface CommuteEntry extends EntryBase {
  kind: 'commute';
  legs: Leg[];
}

export interface HikeOption {
  label: string;
  distanceKm?: number;
  shape?: 'out-and-back' | 'loop' | 'circuit' | 'one-way';
}

export interface HikeEntry extends EntryBase {
  kind: 'hike';
  distanceKm?: number;
  durationMin?: number;
  elevationGainM?: number;
  difficulty?: 'easy' | 'moderate' | 'moderate-hard' | 'hard';
  shape?: 'out-and-back' | 'loop' | 'circuit' | 'one-way';
  guided?: boolean;
  options?: HikeOption[];
}

export interface ExperienceEntry extends EntryBase {
  kind: 'experience';
  startTime?: string; // "08:00"
  endTime?: string;
  distanceKm?: number; // e.g. a bike tour
  durationMin?: number;
}

export interface NoteEntry extends EntryBase {
  kind: 'note';
}

export type Entry = CommuteEntry | HikeEntry | ExperienceEntry | NoteEntry;

export type StayType = 'hotel' | 'airbnb' | 'lodge' | 'refugio' | 'camp' | 'glamping' | 'other';

export interface Stay {
  id: string;
  name: string;
  location?: string;
  type: StayType;
  checkIn: string;
  checkOut: string; // the morning after the last listed night
  nights: number;
  booking?: BookingInfo;
  notes: string[];
  /** Address and similar details. Never shown in the shared read-only view. */
  privateNotes: string[];
  /** True when the sheet gives no lodging name, only a place. */
  nameIsPlaceholder?: boolean;
  /** The name was invented to fill a gap; the place still has to be booked. */
  assumed?: boolean;
  point?: Point;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  /** Pinned to the day with a warning flag, for example "book in advance". */
  warning?: boolean;
  /** Contains a phone number or address. Hidden from the shared view. */
  private?: boolean;
}

export interface Day {
  date: string;
  /** Normalised region name. */
  region: string;
  country?: Country;
  stayId?: string;
  /** Where the day ends up (the stay, or the region's main town). */
  point?: Point;
  entries: Entry[];
  todos: Todo[];
}

export interface TripTotals {
  days: number;
  nights: number;
  hikes: number;
  optionalHikes: number;
  /** Planned hikes with no distance in the sheet; they are left out of the distance total. */
  hikesMissingDistance: number;
  hikeDistanceKm: number;
  hikeElevationGainM: number;
  knownTravelMin: number;
  flights: number;
  ferries: number;
  countries: number;
  stays: number;
  openTodos: number;
}

export interface Trip {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  days: Day[];
  stays: Stay[];
  totals: TripTotals;
}

/** Things the importer was unsure about, for you to confirm. */
export interface ImportNote {
  date?: string;
  severity: 'fixed' | 'confirm';
  message: string;
}

export interface ImportReport {
  source: string;
  rowsRead: number;
  year: number;
  notes: ImportNote[];
}
