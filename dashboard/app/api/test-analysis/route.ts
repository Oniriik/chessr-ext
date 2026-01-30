import { NextRequest, NextResponse } from "next/server";
import WebSocket from "ws";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
  try {
    const { fen } = await request.json();

    if (!fen) {
      return NextResponse.json(
        { error: "FEN position required" },
        { status: 400 },
      );
    }

    // Get Supabase session for authentication
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(
        { error: "Not authenticated. Please refresh the page and ensure you're logged in." },
        { status: 401 }
      );
    }

    console.log("[Test Analysis] Authenticated as:", session.user.email);

    const serverUrl = process.env.NEXT_PUBLIC_CHESS_SERVER_URL || "ws://localhost:3001";

    // Create WebSocket connection
    const ws = new WebSocket(serverUrl);

    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Request timeout (10s)"));
      }, 10000);

      let authenticated = false;

      ws.on("open", () => {
        console.log("[Test Analysis] Connected to chess server");
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log("[Test Analysis] Received:", message.type);

          if (message.type === "ready" && !authenticated) {
            // Send authentication first
            const authMessage = {
              type: "auth",
              token: session.access_token,
              version: "1.0.0",
            };
            console.log("[Test Analysis] Sending auth");
            ws.send(JSON.stringify(authMessage));
          } else if (message.type === "auth_success") {
            authenticated = true;
            // Now send analysis request
            const analysisRequest = {
              type: "analyze",
              fen,
              searchMode: "depth",
              depth: 15,
              moveTime: 1000,
              elo: 2000,
              mode: "balanced",
              multiPV: 3,
            };

            console.log("[Test Analysis] Sending analysis request");
            ws.send(JSON.stringify(analysisRequest));
          } else if (message.type === "result") {
            clearTimeout(timeout);
            ws.close();
            resolve(message);
          } else if (message.type === "error" || message.type === "auth_failed") {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(message.message || "Analysis error"));
          }
        } catch (err) {
          console.error("[Test Analysis] Message parse error:", err);
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on("close", () => {
        clearTimeout(timeout);
      });
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error("[Test Analysis] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
