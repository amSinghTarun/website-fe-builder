import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  console.log("New Client Connected");

  ws.send(
    JSON.stringify({
      type: "Welcome",
      message: "Connected to server successfully.",
    }),
  );

  ws.on("message", (data) => {
    const messageString = data.toString();
    console.log(`Received: ${messageString}`);

    wss.clients.forEach((client) => {
      if (client.readyState == 1) {
        client.send(`Echo: ${messageString}`);
      }
    });
  });

  ws.on("close", () => {
    console.log("Client has disconnected");
  });
});
