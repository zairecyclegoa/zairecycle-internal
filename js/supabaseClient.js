// js/supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.3/+esm";

// Replace with your actual project URL and anon key
export const supabase = createClient(
  "https://kzoeygxxyqwxlmhncggv.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6b2V5Z3h4eXF3eGxtaG5jZ2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5ODcwMzIsImV4cCI6MjA3NzU2MzAzMn0.9E0c9dtaeeVFEm89qTDDUBQlpUzqqHNo8P7N66_PCP8"
);
