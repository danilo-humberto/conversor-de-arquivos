import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ status: "OK" }));

    return;
  }

  res.writeHead(404, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
