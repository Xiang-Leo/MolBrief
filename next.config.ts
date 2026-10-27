import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["node:sqlite"],
  outputFileTracingIncludes: {"/*": ["./drizzle/*.sql"]},
};
export default nextConfig;
