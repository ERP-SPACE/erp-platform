import { react } from "@erp/config/eslint";

export default [...react, { ignores: ["src/routeTree.gen.ts", "playwright-report/**", "test-results/**"] }];
