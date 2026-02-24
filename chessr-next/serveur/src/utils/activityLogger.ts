/**
 * Activity Logger - Logs user activity to Supabase for admin dashboard metrics
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export type ActivityEventType = "suggestion" | "analysis";

/**
 * Log a user activity event to Supabase
 * - Inserts into user_activity table (for period-based stats)
 * - Increments global counter for suggestions (for Discord bot)
 */
export function logActivity(
  userId: string,
  eventType: ActivityEventType
): void {
  // 1. Insert into user_activity (for active users by period)
  supabase
    .from("user_activity")
    .insert({
      user_id: userId,
      event_type: eventType,
    })
    .then(({ error }) => {
      if (error) {
        console.error(
          `[Activity] Failed to log ${eventType}:`,
          error.message
        );
      }
    });

  // 2. Increment global counter for suggestions (for Discord bot)
  if (eventType === "suggestion") {
    supabase
      .rpc("increment_stat", { stat_key: "total_suggestions" })
      .then(({ error }) => {
        if (error) {
          console.error(
            "[Activity] Failed to increment counter:",
            error.message
          );
        }
      });
  }
}
