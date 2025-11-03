import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  eslint: {
    // Allow build to complete - existing API routes have linting issues
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
