import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname),
  compress: false, // Disable gzip — local Electron app doesn't need compression, and it buffers SSE streams
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['better-sqlite3', '@larksuiteoapi/node-sdk'],
  webpack: (config) => {
    // On Windows, directories like "Application Data" are NTFS junction points
    // (symlinks). Webpack's enhanced-resolve follows them and hits EPERM when
    // trying to scan protected system directories. Setting symlinks: false
    // prevents webpack from following any symlinks during module resolution,
    // which fixes the build on GitHub Actions Windows runners.
    config.resolve.symlinks = false
    return config
  },
}

export default nextConfig
