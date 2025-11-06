// This file defines Next.js configuration for the Sparkier regression dashboard UI.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Railway will provide PORT via environment variable
  // Next.js automatically uses process.env.PORT if available
};

export default nextConfig;
