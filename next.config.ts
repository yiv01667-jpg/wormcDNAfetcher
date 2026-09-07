import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const pagesBasePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // Keep the existing vinext development/build path unchanged. GitHub Actions
  // enables static export only for the Pages build.
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? pagesBasePath : "",
  assetPrefix: isGitHubPages ? pagesBasePath : undefined,
  trailingSlash: isGitHubPages,
  images: { unoptimized: true },
};

export default nextConfig;
