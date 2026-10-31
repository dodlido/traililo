// Trailbook data model. Plain types only, so it runs in Node and in the future React app.
// Dates are ISO strings (YYYY-MM-DD). Distances in km, elevation in metres, durations in minutes.

/** Two-letter country code, for example AR or CL. */
export type Country = string;

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

export type BookingSource = 'airbnb' | 'getyourguide' | 'booking' | 'unspecified';

export interface BookingInfo {
  bookedBy?: string; // a first name
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
  /** The road the drive follows, as [lon, lat] pairs, found when the start and end were set. */
  path?: [number, number][];
  /** A ferry line was looked for and none was found, so it stays a straight line. */
  pathTried?: boolean;
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
  /** Notes only the owner sees. Never part of the friends' version. */
  privateNotes?: string[];
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
  /** Points you put in by hand, in walking order. */
  waypoints?: { name: string; point: Point }[];
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

/** A restaurant ('meal') or a night out like a bar or a show ('hang'). The booking (who, confirmation code) is on the entry itself. */
export interface MealEntry extends EntryBase {
  kind: 'meal' | 'hang';
  time?: string; // "20:30"
  partySize?: number;
}

export type Entry = CommuteEntry | HikeEntry | ExperienceEntry | NoteEntry | MealEntry;

export type StayType = 'hotel' | 'airbnb' | 'camp' | 'glamping' | 'other';

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
  /** Your own words and pictures from the day, written during or after the trip. */
  journal?: Journal;
}

export interface Journal {
  text: string;
  /** Storage paths of uploaded pictures. */
  photos: string[];
  /** Private unless you choose to show friends. */
  shared?: boolean;
}

export interface PackItem {
  id: string;
  text: string;
  group: string;
  done: boolean;
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

export type PoiCat = 'view' | 'lake' | 'waterfall' | 'water' | 'thermal' | 'bike' | 'transport' | 'car' | 'town' | 'sight';

/** An extra place worth knowing about on the map: a viewpoint, a stop, a dock. Not a planned activity. */
export interface Poi {
  id: string;
  name: string;
  cat: PoiCat;
  point: Point;
  /** Which part of the trip it belongs to, for example "Seven Lakes Route". */
  group: string;
  /** The day it belongs to. Without one it is shown on the map but not tied to a day. */
  date?: string;
  note?: string;
  url?: string;
  /** A short mark on the pin, for example the lake number. */
  badge?: string;
}

/** A drawn route that the straight line between two nights cannot describe. */
export interface RouteLine {
  id: string;
  name: string;
  date: string;
  mode: 'drive' | 'ferry' | 'trek' | 'scenic';
  points: Point[];
  /** Replaces the plain line between that day's two overnight places. */
  replace?: boolean;
  /** The points you chose, in order. `points` is what gets drawn, which may follow a road or ferry line between them. */
  stops?: { name: string; point: Point }[];
  /** The road or ferry line has been looked up (or looked for), so it is not asked for again. */
  routed?: boolean;
}

export interface Trip {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  days: Day[];
  stays: Stay[];
  /** Your own photos by place name: the storage path of each. */
  photos?: Record<string, string>;
  pois?: Poi[];
  lines?: RouteLine[];
  /** What to bring. Only the owner sees it. */
  packing?: PackItem[];
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
