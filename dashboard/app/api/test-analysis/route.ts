import { NextRequest, NextResponse } from "next/server";
import WebSocket from "ws";

export async function POST(request: NextRequest) {
  try {
    const { fen } = await request.json();

    if (!fen) {
      return NextResponse.json(
        { error: "FEN position required" },
        { status: 400 },
      );
    }

    const serverUrl = process.env.CHESS_SERVER_URL || "wss://engine.chessr.io";

    // Create WebSocket connection
    const ws = new WebSocket(serverUrl);

    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Request timeout (10s)"));
      }, 10000);

      ws.on("open", () => {
        console.log("[Test Analysis] Connected to chess server");
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log("[Test Analysis] Received:", message.type);

          if (message.type === "ready") {
            // Send analysis request
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
          } else if (message.type === "error") {
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
