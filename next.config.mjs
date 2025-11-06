// This file defines Next.js configuration for the Sparkier regression dashboard UI.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Railway will provide PORT via environment variable
  // Next.js automatically uses process.env.PORT if available
  
  // Skip build-time data collection for API routes that require runtime environment variables
  experimental: {
    // This helps prevent build-time execution of API routes
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
