// Your Supabase project. Both values are meant to be public: what protects the data is the login, the
// two-step code and the row-level rules in supabase/schema.sql, not the secrecy of these two.
const DEFAULT_URL = 'https://johvaqnbrlfxwvwhqbln.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvaHZhcW5icmxmeHd2d2hxYmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMTE3MzgsImV4cCI6MjEwODg4NzczOH0.wFb3M7jdKuK6-HsLelRpV8NI8QVE6Xijipoagt_cXsI';
export const SUPABASE_URL = __SB_URL__ || DEFAULT_URL;
export const SUPABASE_ANON_KEY = __SB_KEY__ || DEFAULT_KEY;
export const configured = !SUPABASE_URL.includes('YOUR-PROJECT');
