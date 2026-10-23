import { SwaggerModule } from "@nestjs/swagger";
import { buildOpenApi, createApp } from "./bootstrap.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = await createApp(env);
if (env.NODE_ENV !== "production") {
  SwaggerModule.setup("api/docs", app, () => buildOpenApi(app));
}
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
