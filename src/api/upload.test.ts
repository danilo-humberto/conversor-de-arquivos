import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { upload } from "./upload.js";
import { errorHandler } from "./error-handler.js";

test("upload sem mídia retorna HTTP 400 sem executar a rota", async () => {
  const app = express();
  let routeCalled = false;
  app.post("/upload", upload.single("file"), (_request, response) => {
    routeCalled = true;
    response.sendStatus(202);
  });
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const form = new FormData();
    form.append("file", new Blob(["text"], { type: "text/plain" }), "test.txt");
    const response = await fetch(`http://127.0.0.1:${address.port}/upload`, { method: "POST", body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json() as { message: string }).message, /Only audio and video/);
    assert.equal(routeCalled, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
